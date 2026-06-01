import { useEffect } from 'react'
import pLimit from 'p-limit'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { useKeysStore } from '../store/keysStore'
import { scrapeTopReels, NoReelsError } from '../lib/reelScraper'
import { analyzeReel, synthesizeNiche, buildPerCreatorSummary } from '../lib/reelAnalyzer'

const geminiLimiter = pLimit(5)

export function useReelAnalysis() {
  const {
    creatorStates,
    synthesisStatus,
    synthesis,
    synthesisError,
    setCreatorState,
    setSynthesis,
    setSynthesisError,
    setSynthesisStatus,
    reset,
  } = useReelAnalysisStore()

  const { apifyKeys, geminiKey } = useKeysStore()

  // Synthesis trigger — fires once all creators reach a terminal state
  useEffect(() => {
    const states = Object.values(creatorStates)
    if (states.length === 0) return

    const TERMINAL = ['done', 'no-reels', 'failed'] as const
    const allTerminal = states.every(s => TERMINAL.includes(s.status as typeof TERMINAL[number]))
    if (!allTerminal) return
    if (synthesisStatus !== 'idle') return

    const doneSummaries = states
      .filter(s => s.status === 'done')
      .map(s => buildPerCreatorSummary(s.handle, s.analyses, s.reels))

    if (doneSummaries.length === 0) {
      setSynthesisError('All creators failed — no data to synthesize')
      return
    }

    setSynthesisStatus('running')
    synthesizeNiche(doneSummaries, geminiKey)
      .then(output => setSynthesis(output))
      .catch(err => setSynthesisError((err as Error).message))
  }, [creatorStates, synthesisStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runCreatorPipeline(handle: string) {
    try {
      const reels = await scrapeTopReels(handle, 10, apifyKeys)
      setCreatorState(handle, { reels, status: 'analyzing' })

      const analysisEntries = await Promise.all(
        reels.map(reel =>
          geminiLimiter(async () => {
            const analysis = await analyzeReel(reel, geminiKey)
            return [reel.shortCode, analysis] as const
          }),
        ),
      )

      const analyses = Object.fromEntries(analysisEntries)
      setCreatorState(handle, { analyses, status: 'done' })
    } catch (err) {
      // SECURITY (H11): never store raw err.message — for ApifyError it can contain
      // the response body; for network errors it's unhelpful noise. Map to a fixed string.
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

  const startAnalysis = async (handles: string[]) => {
    reset()
    handles.forEach(handle => {
      setCreatorState(handle, { handle, status: 'scraping', reels: [], analyses: {} })
    })
    await Promise.allSettled(handles.map(handle => runCreatorPipeline(handle)))
  }

  return {
    startAnalysis,
    creatorStates,
    synthesisStatus,
    synthesis,
    synthesisError,
    reset,
  }
}
