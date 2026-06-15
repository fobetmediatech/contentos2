import { useEffect } from 'react'
import pLimit from 'p-limit'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { useKeysStore } from '../store/keysStore'
import { scrapeTopReels, NoReelsError } from '../lib/reelScraper'
import { scrapeReelVideos } from '../lib/reelVideoClient'
import { getCachedDeep, setCachedDeep } from '../lib/deepReelCache'
import {
  analyzeReelsBatch,
  analyzeReelDeep,
  synthesizeNiche,
  buildPerCreatorSummary,
  computeBenchmarks,
  buildDeepPlaybook,
  buildDeepReportTable,
  synthesizeDeepReport,
} from '../lib/reelAnalyzer'
import type { DeepReelStatus } from '../store/reelAnalysisStore'

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

// Deep (multimodal) fn-call concurrency. Conservative: the Vercel function uses a
// SINGLE Gemini key (no server-side rotation), so this caps concurrent Gemini uploads.
const deepLimiter = pLimit(3)

/**
 * Preflight: the deep-analysis serverless function (/api/analyze-reel-video) is only served
 * when deployed or under `vercel dev` — plain `vite dev` returns 404 for it. We probe with a
 * minimal POST: a 404 means "not deployed". Any other status (400/401/405/200) means the
 * route exists, so we proceed. Network errors aren't treated as missing (let the real run
 * surface them). This lets us show ONE clear note instead of resetting the quick results and
 * marking every reel "failed".
 */
async function deepFnAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch('/api/analyze-reel-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    })
    return res.status !== 404
  } catch {
    return true
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
    deepReport,
    deepReportStatus,
    setActiveHandles,
    setCreatorState,
    setDeepReel,
    setSynthesis,
    setSynthesisError,
    setSynthesisStatus,
    setDeepReport,
    setDeepReportStatus,
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

  async function runCreatorPipeline(handle: string, signal: AbortSignal) {
    try {
      const reels = await scrapeTopReels(handle, 10, apifyKeys, signal)
      if (signal.aborted) return
      setCreatorState(handle, { reels, status: 'analyzing' })

      const analyses = await analyzeReelsBatch(reels, geminiKeys, signal)
      if (signal.aborted) return
      setCreatorState(handle, { analyses, status: 'done' })
    } catch (err) {
      if (signal.aborted) return
      // SECURITY (H11): never surface the raw error message — map by type only.
      if (err instanceof NoReelsError) {
        setCreatorState(handle, { status: 'no-reels', error: 'No recent Reels found.' })
      } else {
        setCreatorState(handle, {
          status: 'failed',
          error: 'Analysis failed — the account may be private, or try again.',
        })
      }
    }
  }

  /**
   * Run the full reel-analysis pipeline for a set of handles:
   * cancel-prior → reset → seed states → scrape+analyze all (parallel) → synthesize.
   */
  const startAnalysis = async (handles: string[], externalSignal?: AbortSignal) => {
    if (handles.length === 0) return

    // New run: cancel any in-flight run, reset state, seed fresh.
    sharedAbortRef.current?.abort()
    reset()
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

    await Promise.allSettled(handles.map((handle) => runCreatorPipeline(handle, controller.signal)))
    if (controller.signal.aborted) return

    // Synthesis — explicit, after every creator reached a terminal state.
    // Read fresh from the store to avoid a stale closure over creatorStates.
    const states = useReelAnalysisStore.getState().creatorStates
    const doneCreators = Object.values(states).filter((s) => s.status === 'done')
    const doneSummaries = doneCreators.map((s) => buildPerCreatorSummary(s.handle, s.analyses, s.reels))

    if (doneSummaries.length === 0) {
      setSynthesisError('All creators failed — no reel data to synthesize. Try more active creators.')
      return
    }

    // M5: benchmarks computed in code from the real reel metrics, not the LLM.
    const benchmarks = computeBenchmarks(doneCreators.flatMap((s) => s.reels))

    setSynthesisStatus('running')
    try {
      const output = await synthesizeNiche(doneSummaries, geminiKeys, benchmarks, controller.signal)
      if (controller.signal.aborted) return
      setSynthesis(output)
    } catch {
      if (controller.signal.aborted) return
      setSynthesisError('Could not synthesize niche patterns — try again.')
    }
  }

  // ---- Deep (multimodal) report pipeline — Phase-1 enrichment ----
  // Mirrors runCreatorPipeline but inserts the batch video step and analyses each
  // reel via the Vercel function. Leaves the quick startAnalysis path untouched.
  async function runCreatorDeepPipeline(handle: string, signal: AbortSignal) {
    try {
      // Reuse the reels the quick pass already scraped — keeps the hook grid intact and skips a
      // redundant Apify scrape. Only scrape when they're absent (deep report on a trimmed snapshot).
      const existing = useReelAnalysisStore.getState().creatorStates[handle]
      const reels =
        existing?.reels && existing.reels.length > 0
          ? existing.reels
          : await scrapeTopReels(handle, 10, apifyKeys, signal)
      if (signal.aborted) return

      // Seed every reel as pending so the UI shows the full set immediately. setCreatorState merges,
      // so the quick `analyses` survive (we don't pass them) — we only add reels + the deep maps.
      const seededStatus: Record<string, DeepReelStatus> = {}
      for (const r of reels) seededStatus[r.shortCode] = 'pending'
      setCreatorState(handle, { reels, status: 'analyzing', deepStatus: seededStatus, deepAnalyses: {} })

      // Cache check (R2 resume / R3 free re-runs): cached reels restore instantly;
      // only uncached reels go on to the (expensive) video scrape + Gemini.
      const uncached: typeof reels = []
      for (const reel of reels) {
        const cached = await getCachedDeep(reel.shortCode)
        if (cached) setDeepReel(handle, reel.shortCode, { status: 'done', analysis: cached })
        else uncached.push(reel)
      }
      if (signal.aborted) return

      if (uncached.length > 0) {
        // ONE batch Apify run resolves stable video URLs for the UNCACHED reels only.
        const videos = await scrapeReelVideos(uncached.map((r) => r.url), apifyKeys, signal)
        if (signal.aborted) return

        // Per reel: no video -> skipped; else deep-analyze via the function (capped concurrency).
        // R2: one reel failing/skipping never blocks the others — the run still completes.
        await Promise.all(
          uncached.map((reel) =>
            deepLimiter(async () => {
              if (signal.aborted) return
              const videoUrl = videos.get(reel.shortCode)
              if (!videoUrl) {
                setDeepReel(handle, reel.shortCode, { status: 'skipped' })
                return
              }
              setDeepReel(handle, reel.shortCode, { status: 'analyzing' })
              try {
                const analysis = await analyzeReelDeep(reel, videoUrl, signal)
                if (signal.aborted) return
                setDeepReel(handle, reel.shortCode, { status: 'done', analysis })
                void setCachedDeep(reel.shortCode, analysis) // best-effort: makes re-runs free
              } catch {
                if (signal.aborted) return
                setDeepReel(handle, reel.shortCode, { status: 'failed' })
              }
            }),
          ),
        )
      }
      if (signal.aborted) return
      setCreatorState(handle, { status: 'done' })
    } catch (err) {
      if (signal.aborted) return
      if (err instanceof NoReelsError) {
        setCreatorState(handle, { status: 'no-reels', error: 'No recent Reels found.' })
      } else {
        setCreatorState(handle, {
          status: 'failed',
          error: 'Analysis failed — the account may be private, or try again.',
        })
      }
    }
  }

  /**
   * Run the DEEP multimodal report pipeline for a set of handles:
   * cancel-prior -> reset -> seed -> per-creator (scrape list -> batch video ->
   * per-reel deep analysis). Progressive: the store updates per reel as each finishes.
   * Phase 1 stops here (no synthesis); Phase 2 adds the playbook + cross-profile report.
   */
  const startDeepReport = async (handles: string[]) => {
    if (handles.length === 0) return

    // Preflight with a THROWAWAY controller BEFORE touching the shared abortRef: if the
    // deep-analysis function isn't deployed (404 under plain `vite dev`), surface one note and
    // keep the quick results intact — without aborting an in-flight quick run or resetting.
    const probe = new AbortController()
    if (!(await deepFnAvailable(probe.signal))) {
      setDeepReportStatus('unavailable')
      return
    }

    sharedAbortRef.current?.abort()
    const controller = new AbortController()
    sharedAbortRef.current = controller
    if (controller.signal.aborted) return

    // ENRICH IN PLACE — do NOT reset(). reset() wiped the quick hook analysis AND nulled
    // reelConversationId, which hid the entire live block, so the deep run rendered to nothing
    // ("click Generate deep report and everything vanishes"). Keep the existing creators, their
    // scraped reels, the quick analyses, and the conversation binding intact; the deep video grid
    // layers on top as each reel finishes (runCreatorDeepPipeline reuses the already-scraped reels).
    setActiveHandles(handles)
    const seededStates = useReelAnalysisStore.getState().creatorStates
    handles.forEach((handle) => {
      // Only seed a creator that isn't already present (e.g. deep report fired from a trimmed
      // snapshot whose live state was cleared). Never clobber an existing creator's reels/analyses.
      if (!seededStates[handle]) {
        setCreatorState(handle, { handle, status: 'scraping', reels: [], analyses: {}, deepStatus: {}, deepAnalyses: {} })
      }
    })

    await Promise.allSettled(handles.map((handle) => runCreatorDeepPipeline(handle, controller.signal)))
    if (controller.signal.aborted) return

    // Cross-profile niche report (Phase 2): build per-creator playbooks from creators
    // that finished with deep data, then code-table + Gemini synthesis. Read fresh from
    // the store to avoid a stale closure over creatorStates.
    const states = useReelAnalysisStore.getState().creatorStates
    const playbooks = Object.values(states)
      .filter((s) => s.status === 'done' && s.deepAnalyses && Object.keys(s.deepAnalyses).length > 0)
      .map((s) => buildDeepPlaybook(s.handle, s.deepAnalyses ?? {}, s.reels))
    if (playbooks.length === 0) return

    setDeepReportStatus('running')
    try {
      const table = buildDeepReportTable(playbooks)
      const synthesis = await synthesizeDeepReport(playbooks, geminiKeys, controller.signal)
      if (controller.signal.aborted) return
      setDeepReport({ ...table, ...synthesis })
    } catch {
      if (controller.signal.aborted) return
      setDeepReportStatus('failed')
    }
  }

  return {
    startAnalysis,
    startDeepReport,
    deepReport,
    deepReportStatus,
    activeHandles,
    creatorStates,
    synthesisStatus,
    synthesis,
    synthesisError,
    reset,
  }
}
