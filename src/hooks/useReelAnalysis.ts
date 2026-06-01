import { useEffect, useRef } from 'react'
import pLimit from 'p-limit'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { useKeysStore } from '../store/keysStore'
import { scrapeTopReels, NoReelsError } from '../lib/reelScraper'
import { analyzeReel, synthesizeNiche, buildPerCreatorSummary, computeBenchmarks } from '../lib/reelAnalyzer'

// Cap Gemini concurrency across all creators in a run.
const geminiLimiter = pLimit(5)

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
    setCreatorState,
    setSynthesis,
    setSynthesisError,
    setSynthesisStatus,
    reset,
  } = useReelAnalysisStore()

  const { apifyKeys, geminiKey } = useKeysStore()

  // One controller per run, aborted on unmount.
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  async function runCreatorPipeline(handle: string, signal: AbortSignal) {
    try {
      const reels = await scrapeTopReels(handle, 10, apifyKeys, signal)
      if (signal.aborted) return
      setCreatorState(handle, { reels, status: 'analyzing' })

      const analysisEntries = await Promise.all(
        reels.map((reel) =>
          geminiLimiter(async () => {
            const analysis = await analyzeReel(reel, geminiKey, signal)
            return [reel.shortCode, analysis] as const
          }),
        ),
      )
      if (signal.aborted) return
      setCreatorState(handle, { analyses: Object.fromEntries(analysisEntries), status: 'done' })
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
  const startAnalysis = async (handles: string[]) => {
    if (handles.length === 0) return

    // New run: cancel any in-flight run, reset state, seed fresh.
    abortRef.current?.abort()
    reset()
    const controller = new AbortController()
    abortRef.current = controller

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
      const output = await synthesizeNiche(doneSummaries, geminiKey, benchmarks, controller.signal)
      if (controller.signal.aborted) return
      setSynthesis(output)
    } catch {
      if (controller.signal.aborted) return
      setSynthesisError('Could not synthesize niche patterns — try again.')
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
