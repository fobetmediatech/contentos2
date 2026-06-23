/**
 * Main analysis hook — orchestrates the full competitor discovery pipeline.
 *
 * Two-phase mutation architecture (split to support mid-run clarification pause):
 *
 *   Phase 1 — discoverMutation:
 *     Steps 1–4: Apify scraping (reference + rounds 2/3 + hashtag expansion)
 *     + generateClarificationQuestion() → sets status: 'clarifying'
 *
 *   Phase 2 — analyzeMutation (fires when user answers the clarification card):
 *     Step 5: Gemini ranking with clarification answer injected as USER REFINEMENT
 *
 * The Zustand store bridges the two phases via pendingDiscovery (profile data held
 * during the clarification pause) and clarificationAnswer (the user's selection).
 *
 * TanStack Query config for 120s long-running operations:
 *   staleTime: 10min  → don't refetch results on re-mount
 *   gcTime: 30min     → keep results in memory for 30 minutes
 *   retry: 0          → no automatic retries (120s op + retries = 6+ minutes)
 *   AbortController   → hard 150s timeout with clean cancellation
 */

import { useMutation } from '@tanstack/react-query'
import { useAnalysisStore, type AnalysisParams } from '../store/analysisStore'
import { useConversationsStore } from '../store/conversationsStore'
import { useKeysStore } from '../store/keysStore'
import { discoverCompetitors } from '../lib/apifyClient'
import { analyzeCompetitors, generateClarificationQuestion } from '../ai/gemini'
import { buildPipelineErrorMessage, sparseSeedMessage, ALL_DISMISSED_MESSAGE } from '../lib/errorMessages'
import { linkAbort } from '../lib/abortControl'
import { useCorpusStore } from '../store/corpusStore'
import { dropDismissedCandidates, selectPreferenceExemplars } from '../lib/corpus'
import { buildCorpusSignals } from '../ai/prompts'

const TIMEOUT_MS = 150_000
const MIN_COMPETITOR_RESULTS = 8
// Below this many on-pool picks after the strict niche pass, attempt a relaxed top-up to avoid
// very thin results. Conservative (< the 8 sparse threshold) so the precision-first ranking is
// only supplemented when the niche pool is genuinely thin — not routinely padded with broader picks.
const UNDERFILL_FLOOR = 6
const MAX_COMPETITOR_RESULTS = 10 // Top 5 + Trending 5

export function useCompetitorAnalysis() {
  const store = useAnalysisStore()
  const { startAnalysis, setStep, setResults, setError, reset, setClarification, setStepProgressDetail, setDidExpand, answerClarification: storeAnswerClarification } = store
  const { geminiKeys, apifyKeys, pickKey } = useKeysStore()

  // ── Phase 1: Discovery + clarification question generation ────────────────

  const discoverMutation = useMutation({
    mutationFn: async ({ params, externalSignal }: { params: AnalysisParams; externalSignal?: AbortSignal }) => {
      // linkAbort: internal 150s timeout + an optional external (agent-loop) signal.
      const abort = linkAbort(TIMEOUT_MS, externalSignal)

      try {
        // 2.1: capture the active conversation so results land there even if the user
        // switches conversations while the 150s scrape is running.
        const runConversationId = useConversationsStore.getState().activeId
        startAnalysis(params, runConversationId)

        // Step 1: Scraping reference accounts (steps 2–4 inside discoverCompetitors)
        setStep(1)
        const { inputProfiles, candidateProfiles } = await discoverCompetitors(
          params.handles,
          apifyKeys,
          abort.signal,
          params.depth,
        )

        // Fail fast on an empty candidate pool. An invalid/too-sparse reference handle yields zero
        // candidates; running clarification + ranking on nothing just dead-ends ~2 minutes later
        // with a confusing "no verified competitors". A clear, actionable message here lets the
        // user fix the handle immediately. (wasSuperseded is checked first in catch → silent steer.)
        if (candidateProfiles.length === 0) {
          throw new Error(sparseSeedMessage(params.handles, inputProfiles.length > 0))
        }

        // 3a (Phase 3): drop creators the user has dismissed so they never resurface. Live
        // verdicts come from the corpus store. Re-check AFTER filtering with a DISTINCT message —
        // an all-dismissed pool means "clear some dismissals", not "handle not found".
        const candidates = dropDismissedCandidates(candidateProfiles, useCorpusStore.getState().creators)
        if (candidates.length === 0) {
          throw new Error(ALL_DISMISSED_MESSAGE)
        }

        const isSparse = candidates.length < MIN_COMPETITOR_RESULTS
        setStepProgressDetail(
          isSparse
            ? `Found only ${candidates.length} profiles — this niche may be sparse on Instagram`
            : `Found ${candidates.length} candidate accounts`
        )
        if (isSparse) setDidExpand(true)
        setStep(4)

        // Generate the clarification question from the first 20 candidates.
        // Never throws — returns a safe fallback question on any error.
        const referenceProfile = inputProfiles[0]
        const clarificationQuestion = referenceProfile
          ? await generateClarificationQuestion(
              geminiKeys,
              referenceProfile,
              candidates,
              params.nicheContext,
              abort.signal,
            )
          : { question: 'Which direction best fits your client?', options: ['Exact niche match', 'Broader category'] }

        // Transition to clarifying state — UI shows <ClarificationCard>
        setClarification({ inputProfiles, candidateProfiles: candidates, clarificationQuestion })

        return { inputProfiles, candidateProfiles: candidates }

      } catch (err) {
        // Superseded by the agent loop (latest-wins steer) — silent, not a failure.
        if (abort.wasSuperseded()) return undefined
        console.error('[analysis:discover] failed:', err)
        const message = buildPipelineErrorMessage(err, abort.signal, pickKey, 'Analysis timed out after 150 seconds. Try with fewer handles or check your Apify key.')
        setError(message)
        throw new Error(message, { cause: err })
      } finally {
        abort.cleanup()
      }
    },
    retry: 0,
    gcTime: 30 * 60 * 1000,
  })

  // ── Phase 2: Ranking with clarification answer injected ───────────────────

  const analyzeMutation = useMutation({
    mutationFn: async ({ answer, nicheContext, externalSignal }: { answer: string; nicheContext: string; externalSignal?: AbortSignal }) => {
      // No client-side key guard: keys live server-side now (keysStore.geminiKeys is always []),
      // so `!geminiKeys.length` was ALWAYS true and threw "Gemini API key is not configured" the
      // moment ranking fired. The /api/gemini proxy enforces config + surfaces it as a pipeline error.

      // Read pendingDiscovery synchronously from store at call time — avoids stale closure.
      const discovery = useAnalysisStore.getState().pendingDiscovery
      if (!discovery) throw new Error('No discovery data available — please restart the analysis.')

      const abort = linkAbort(TIMEOUT_MS, externalSignal)

      try {
        setStep(5)
        const { inputProfiles, candidateProfiles } = discovery
        const knownHandles = new Set(candidateProfiles.map((p) => p.username.toLowerCase()))

        const corpusCreators = useCorpusStore.getState().creators
        // 3b (Phase 3): bias ranking toward the strategist's saved traits, away from dismissed.
        const preferenceExemplars = selectPreferenceExemplars(Object.values(corpusCreators), nicheContext)
        // 4.4: annotate candidate lines with corpus recognition signal ([KNOWN: seen Nx in 'niche']).
        const corpusSignals = buildCorpusSignals(candidateProfiles.map((p) => p.username), corpusCreators)
        const corpusArg = Object.keys(corpusSignals).length > 0 ? corpusSignals : undefined

        // Hallucination filter: a returned handle must exist in the scraped pool. Strip a leading
        // @ before matching — Gemini occasionally returns "@handle" despite the "no @" instruction.
        const normHandle = (u: string) => u.replace(/^@/, '').toLowerCase()
        const inPool = (c: { username: string }) => knownHandles.has(normHandle(c.username))

        // Step 5: AI rationale — nicheContext + clarification answer + preference + corpus signals
        const output = await analyzeCompetitors(
          geminiKeys,
          inputProfiles,
          candidateProfiles,
          abort.signal,
          nicheContext || undefined,
          answer || undefined,
          preferenceExemplars,
          corpusArg,
        )
        const competitors = output.competitors.filter(inPool)

        // Underfill top-up (recall safety net): if the strict niche pass yielded few on-pool picks,
        // re-rank with the NARROWING filter relaxed (drop nicheContext + answer) but KEEP the
        // preference + corpus quality signals, then MERGE in only NEW unique on-pool picks to fill
        // the gap. Strict on-niche picks are kept first and never displaced — the relaxed pass only
        // supplements when the niche pool is genuinely thin. Also covers the old zero-result case.
        const hadNarrowingFilter = (nicheContext || '').trim().length > 0 || (answer || '').trim().length > 0
        if (competitors.length < UNDERFILL_FLOOR && hadNarrowingFilter) {
          console.warn(`[analysis] only ${competitors.length} on-pool picks after strict pass — relaxed top-up`)
          const relaxed = await analyzeCompetitors(
            geminiKeys,
            inputProfiles,
            candidateProfiles,
            abort.signal,
            undefined,
            undefined,
            preferenceExemplars,
            corpusArg,
          )
          const seen = new Set(competitors.map((c) => normHandle(c.username)))
          for (const c of relaxed.competitors) {
            if (competitors.length >= MAX_COMPETITOR_RESULTS) break
            if (inPool(c) && !seen.has(normHandle(c.username))) {
              competitors.push(c)
              seen.add(normHandle(c.username))
            }
          }
        }

        if (competitors.length === 0) {
          throw new Error(
            'No verified competitors found — Gemini returned accounts that weren\'t in the scraped set. Try again or use different reference handles.',
          )
        }

        const finalOutput = { ...output, competitors }
        setResults(finalOutput, inputProfiles, candidateProfiles.length, candidateProfiles)
        return finalOutput

      } catch (err) {
        if (abort.wasSuperseded()) return undefined
        console.error('[analysis:analyze] failed:', err)
        const message = buildPipelineErrorMessage(err, abort.signal, () => null, 'Analysis timed out after 150 seconds. Try with fewer handles or check your Apify key.')
        setError(message)
        throw new Error(message, { cause: err })
      } finally {
        abort.cleanup()
      }
    },
    retry: 0,
    gcTime: 30 * 60 * 1000,
  })

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Kick off Phase 1 (discovery + question generation). */
  const analyze = (params: AnalysisParams, externalSignal?: AbortSignal) => {
    discoverMutation.mutate({ params, externalSignal })
  }

  /**
   * Called when user selects an option in <ClarificationCard>.
   * Stores the answer and immediately fires Phase 2 (ranking).
   * Pass an empty string to proceed without refinement ("Looks right, proceed as-is").
   */
  const answerClarification = (answer: string, externalSignal?: AbortSignal) => {
    // 2.2: check params BEFORE mutating status — storeAnswerClarification sets status:'running',
    // so calling it when params is null (e.g. conversation switched mid-run) creates a permanent
    // fake spinner that can never resolve.
    const currentParams = useAnalysisStore.getState().params
    if (!currentParams) return
    storeAnswerClarification(answer)
    analyzeMutation.mutate({ answer, nicheContext: currentParams.nicheContext, externalSignal })
  }

  return {
    analyze,
    answerClarification,
    isPending: discoverMutation.isPending || analyzeMutation.isPending,
    isError: discoverMutation.isError || analyzeMutation.isError,
    reset,
  }
}
