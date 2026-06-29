import { useEffect } from 'react'
import pLimit from 'p-limit'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { useConversationsStore } from '../store/conversationsStore'
import { useKeysStore } from '../store/keysStore'
import { scrapeTopReels, NoReelsError } from '../lib/reelScraper'
import { friendlyError } from '../lib/errorMessages'
import { scrapeReelVideos } from '../lib/reelVideoClient'
import { getCachedSingleReel, setCachedSingleReel } from '../lib/singleReelCache'
import { devWarn } from '../lib/devLog'
import { analyzeReelHookmap, singleReelFnAvailable } from '../lib/reelHookmap'
import { synthesizeCreatorHooks } from '../lib/reelAnalyzer'
import type { ReelCaseStatus } from '../store/reelAnalysisStore'

// 2.3: module-scope controller shared across ALL mounted instances of useReelAnalysis
// (ChatPage + useAgentConversation both mount this hook; per-instance refs meant one
// instance's abort couldn't cancel the other's in-flight run).
const sharedAbortRef: { current: AbortController | null } = { current: null }

// Count of currently-mounted hook instances. The shared run is aborted on unmount only
// when the LAST instance unmounts (true navigation away from every surface that renders
// the run) — NOT when any single instance unmounts. Without this, a transient unmount of
// one mount point (e.g. a route transition that briefly drops the agent-loop consumer
// while ChatPage keeps rendering) would cancel a run the other instance is still showing.
let mountCount = 0

// HookMap (single-reel case-study) fn-call concurrency. Conservative: the Vercel function uses a
// SINGLE Gemini key (no server-side rotation), so this caps concurrent Gemini uploads.
const hookmapLimiter = pLimit(3)

/**
 * Per-creator HookMap pipeline (module-scope so it never closes over hook state): scrape top
 * reels → cache-first deep analysis → store case studies. Runs for EVERY analyzed handle (a
 * single profile, or each competitor selected from a result). The per-creator hook summary is
 * synthesized by startAnalysis after this completes.
 */
async function runCreatorHookmapPipeline(
  handle: string, apifyKeys: string[], signal: AbortSignal,
) {
  const store = useReelAnalysisStore.getState()
  try {
    const reels = await scrapeTopReels(handle, 10, apifyKeys, signal)
    if (signal.aborted) return
    const seeded: Record<string, ReelCaseStatus> = {}
    for (const r of reels) seeded[r.shortCode] = 'pending'
    store.setCreatorState(handle, { reels, status: 'analyzing', caseStudyStatus: seeded, caseStudies: {} })

    // cache-first; only uncached reels need a video URL + a network analysis
    const uncached: typeof reels = []
    for (const r of reels) {
      const cached = await getCachedSingleReel(r.shortCode)
      if (cached) store.setReelCaseStudy(handle, r.shortCode, { status: 'done', result: cached })
      else uncached.push(r)
    }
    if (signal.aborted) return

    if (uncached.length > 0) {
      const videos = await scrapeReelVideos(uncached.map((r) => r.url), apifyKeys, signal)
      if (signal.aborted) return
      await Promise.all(uncached.map((reel) => hookmapLimiter(async () => {
        if (signal.aborted) return
        const videoUrl = videos.get(reel.shortCode)
        if (!videoUrl) { store.setReelCaseStudy(handle, reel.shortCode, { status: 'skipped' }); return }
        store.setReelCaseStudy(handle, reel.shortCode, { status: 'analyzing' })
        const result = await analyzeReelHookmap(handle, reel, videoUrl, signal)
        if (signal.aborted) return
        if (!result) { store.setReelCaseStudy(handle, reel.shortCode, { status: 'failed' }); return }
        store.setReelCaseStudy(handle, reel.shortCode, { status: 'done', result })
        void setCachedSingleReel(reel.shortCode, result)
      })))
    }
    if (signal.aborted) return
    store.setCreatorState(handle, { status: 'done' })
  } catch (err) {
    if (signal.aborted) return
    if (err instanceof NoReelsError) store.setCreatorState(handle, { status: 'no-reels', error: 'No recent Reels found.' })
    else {
      // DEV diagnostic: the user-facing string is intentionally generic. Surface the REAL reason —
      // for an ApifyError this prints the code (QUOTA_EXCEEDED = all keys out of credit, RUN_FAILED =
      // Instagram blocked the scrape, POLL_TIMEOUT = scrape exceeded the deadline, etc.).
      const e = err as { name?: string; code?: string; status?: number; message?: string }
      devWarn(`[hookmap] analysis failed for @${handle}:`, e?.code ?? e?.name, `status=${e?.status ?? '?'}`, e?.message, err)
      store.setCreatorState(handle, { status: 'failed', error: friendlyError(err, 'Analysis failed — the account may be private, or try again.') })
    }
  }
}

/**
 * useReelAnalysis — orchestrates per-creator reel scraping + hook analysis, then
 * cross-creator synthesis, as ONE awaited sequence inside startAnalysis().
 *
 * Synthesis is triggered EXPLICITLY at the end of startAnalysis, NOT via a
 * creatorStates-watching useEffect. That single change buys a lot:
 *   - the hook can be mounted in multiple places (ChatPage for rendering AND
 *     useConversation for NL-routed triggering) without synthesis double-firing
 *     (was audit H4/H5 — two orchestrators sharing one store + effect)
 *   - the whole run shares one AbortController, aborted on unmount, so navigating
 *     away cancels in-flight Apify polling + Gemini calls instead of leaving
 *     zombies that write into a reset store (was H3 — the only flow with no abort)
 *
 * The single source of truth for "which handles are in the run" is the store's
 * activeHandles (set here), so any surface can render the run independently.
 */
export function useReelAnalysis() {
  const {
    activeHandles,
    creatorStates,
    synthesisStatus,
    synthesis,
    synthesisError,
    setActiveHandles,
    setReelConversationId,
    setCreatorState,
    setHookSummary,
    setSynthesisError,
    setSynthesisStatus,
    reset,
  } = useReelAnalysisStore()

  const { apifyKeys, geminiKeys } = useKeysStore()

  // Cleanup: abort the in-flight run only when the LAST mounted instance unmounts
  // (navigation away from every surface that renders the run). If decrement leaves another
  // instance mounted, the run keeps going — a single instance unmounting must not cancel a
  // run the other is still showing. New-run supersede is handled in startAnalysis, which
  // aborts the prior controller regardless of which instance triggers it.
  useEffect(() => {
    mountCount++
    return () => {
      mountCount--
      if (mountCount <= 0) sharedAbortRef.current?.abort()
    }
  }, [])

  /**
   * Run the deep HookMap reel analysis for a set of handles (a single profile, or several
   * competitors selected from a result):
   * cancel-prior → reset → seed → per-creator HookMap pipeline (parallel) → per-creator summary.
   */
  const startAnalysis = async (handles: string[], externalSignal?: AbortSignal) => {
    if (handles.length === 0) return

    // New run: cancel any in-flight run, reset state, seed fresh.
    sharedAbortRef.current?.abort()
    reset()
    // reset() nulls reelConversationId, so re-bind this run to the active conversation HERE.
    // ChatPage gates the live reel block on `reelConversationId === activeConversationId`; if the
    // binding is null the whole block — progress, results, AND per-creator error states — renders
    // blank. Setting it after reset (not before, where the caller did and reset wiped it) mirrors
    // how the competitor/discovery startX() capture runConversationId at run start.
    setReelConversationId(useConversationsStore.getState().activeId)
    const controller = new AbortController()
    sharedAbortRef.current = controller

    // Let the agent loop (T8) supersede this run via an external signal. Reel already
    // returns silently on abort (per-creator `if (signal.aborted) return`), so forwarding
    // the external abort onto this run's controller is all that's needed — no error painted.
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort()
      else externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    setActiveHandles(handles)
    handles.forEach((handle) =>
      setCreatorState(handle, { handle, status: 'scraping', reels: [], analyses: {} }),
    )

    // The deep HookMap analyzer is the only reel-analysis path now: it runs PER CREATOR for
    // every selected handle (one profile, or several competitors picked from a result). Heads-up
    // on cost — each creator is ~10 video analyses, so a large multi-select is slow/expensive.
    if (!(await singleReelFnAvailable(controller.signal))) {
      // Drive the seeded creators terminal so InlineReelResults doesn't show perpetual spinners.
      handles.forEach((handle) =>
        setCreatorState(handle, { status: 'failed', error: "Reel analysis isn't available in this environment." }),
      )
      setSynthesisError("Reel analysis isn't available in this environment.")
      return
    }

    // Drive synthesisStatus running→done so the run arms+fires the ChatPage corpus-harvest effect,
    // gets snapshotted into history, and persists across reload (the effect arms on 'running').
    setSynthesisStatus('running')
    try {
      await Promise.allSettled(handles.map((handle) => runCreatorHookmapPipeline(handle, apifyKeys, controller.signal)))
      if (controller.signal.aborted) return

      // Per-creator hook summary for each creator that produced case studies (read fresh from store).
      const states = useReelAnalysisStore.getState().creatorStates
      await Promise.allSettled(
        handles.map(async (handle) => {
          const c = states[handle]
          if (!c?.caseStudies || Object.keys(c.caseStudies).length === 0) return
          const summary = await synthesizeCreatorHooks(handle, c.caseStudies, c.reels, geminiKeys, controller.signal)
          if (!controller.signal.aborted && summary) setHookSummary(handle, summary)
        }),
      )
      if (controller.signal.aborted) return
      // Terminal even if some/all creators ended 'no-reels'/'failed' — their per-creator states
      // render the errors; the run itself reached a terminal state.
      setSynthesisStatus('done')
    } finally {
      // If the run was interrupted (aborted while still 'running' — agent-loop supersede via the
      // external signal, or the last hook instance unmounting), clear the stale state. Otherwise it
      // freezes at synthesisStatus 'running' with activeHandles set, which keeps ChatPage's
      // `isReelRunning` true forever and disables competitor selection until a FULL reload (only a
      // reload re-runs the persist `merge` guard that discards interrupted runs). The
      // `sharedAbortRef.current === controller` guard means we only reset OUR run: a newer run that
      // superseded us has already pointed sharedAbortRef at its own controller (after abort()+reset()),
      // so this guard is false and we never wipe the fresh run. A clean finish set 'done' above, so
      // the status check is false there too.
      if (
        controller.signal.aborted &&
        sharedAbortRef.current === controller &&
        useReelAnalysisStore.getState().synthesisStatus === 'running'
      ) {
        reset()
      }
    }
  }

  return {
    startAnalysis,
    activeHandles,
    creatorStates,
    synthesisStatus,
    synthesis,
    synthesisError,
    reset,
  }
}
