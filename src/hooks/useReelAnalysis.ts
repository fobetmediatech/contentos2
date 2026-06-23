import { useEffect } from 'react'
import pLimit from 'p-limit'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { useConversationsStore } from '../store/conversationsStore'
import { useKeysStore } from '../store/keysStore'
import { scrapeTopReels, NoReelsError } from '../lib/reelScraper'
import { scrapeReelVideos } from '../lib/reelVideoClient'
import { transcribeReels } from '../lib/reelTranscriber'
import { harvestReelContent } from '../lib/corpusHarvest'
import { useCorpusStore } from '../store/corpusStore'
import { getCachedSingleReel, setCachedSingleReel } from '../lib/singleReelCache'
import { analyzeReelHookmap, singleReelFnAvailable } from '../lib/reelHookmap'
import {
  analyzeReelsBatch,
  synthesizeNiche,
  buildPerCreatorSummary,
  computeBenchmarks,
  synthesizeCreatorHooks,
} from '../lib/reelAnalyzer'
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
 * Background pass (module-scope so it never closes over hook state): transcribe every
 * done-creator's reels via the single-reel analyzer, write the transcripts into the store,
 * then re-harvest the corpus content so the gallery copy carries transcripts (upsert by reel
 * id is idempotent — the ChatPage synthesis-done harvest already saved the reels + thumbnails;
 * this adds the transcripts once they exist). Skipped silently when the analyzer isn't deployed
 * (plain `vite dev`) and aborts cleanly when the run is superseded.
 */
async function enrichTranscripts(apifyKeys: string[], signal: AbortSignal) {
  if (!(await singleReelFnAvailable(signal))) return
  if (signal.aborted) return

  const states = useReelAnalysisStore.getState().creatorStates
  const done = Object.values(states).filter((s) => s.status === 'done' && s.reels.length > 0)
  let any = false
  for (const s of done) {
    if (signal.aborted) return
    const transcripts = await transcribeReels(s.handle, s.reels, apifyKeys, signal)
    if (signal.aborted) return
    if (Object.keys(transcripts).length > 0) {
      useReelAnalysisStore.getState().setCreatorState(s.handle, { transcripts })
      any = true
    }
  }
  if (signal.aborted || !any) return

  // Re-harvest with transcripts now attached (idempotent upsert by reel id).
  const fresh = useReelAnalysisStore.getState().creatorStates
  void useCorpusStore.getState().rememberContent(harvestReelContent(fresh, Date.now())).catch(() => {})
}

/**
 * Single-handle HookMap pipeline (module-scope so it never closes over hook state):
 * scrape top reels → cache-first analysis → store case studies. For single @handle runs only.
 * Phase 2.3 will wire synthesizeCreatorHooks here (currently does nothing; just returns).
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
    else store.setCreatorState(handle, { status: 'failed', error: 'Analysis failed — the account may be private, or try again.' })
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
    setSynthesis,
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

    if (handles.length === 1) {
      if (!(await singleReelFnAvailable(controller.signal))) {
        setSynthesisError("Deep reel analysis isn't available in this environment.")
        return
      }
      await runCreatorHookmapPipeline(handles[0], apifyKeys, controller.signal)
      if (controller.signal.aborted) return
      const creator = useReelAnalysisStore.getState().creatorStates[handles[0]]
      if (creator?.caseStudies && Object.keys(creator.caseStudies).length > 0) {
        const summary = await synthesizeCreatorHooks(handles[0], creator.caseStudies, creator.reels, geminiKeys, controller.signal)
        if (controller.signal.aborted) return
        if (summary) setHookSummary(handles[0], summary)
      }
      // Corpus harvest (transcript+thumbnail) still fires via ChatPage synthesis effect / existing path.
      return
    }

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

    // Transcript enrichment — non-blocking (NOT awaited): the visible hook results are already
    // rendered above, so driving each reel through the single-reel analyzer happens in the
    // background and only enriches the stored corpus/gallery copy. Best-effort + cached.
    void enrichTranscripts(apifyKeys, controller.signal)
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
