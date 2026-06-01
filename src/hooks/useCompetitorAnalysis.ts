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
import { useKeysStore } from '../store/keysStore'
import { discoverCompetitors } from '../lib/apifyClient'
import { analyzeCompetitors, generateClarificationQuestion } from '../ai/gemini'
import { markKeyCooldown } from '../lib/keyRotator'
import { ApifyError } from '../lib/apifyClient'
import { GeminiError } from '../ai/gemini'

const TIMEOUT_MS = 150_000
const MIN_COMPETITOR_RESULTS = 8

export function useCompetitorAnalysis() {
  const store = useAnalysisStore()
  const { startAnalysis, setStep, setResults, setError, reset, setClarification, setStepProgressDetail, setDidExpand, answerClarification: storeAnswerClarification } = store
  const { geminiKey, pickKey } = useKeysStore()

  // ── Phase 1: Discovery + clarification question generation ────────────────

  const discoverMutation = useMutation({
    mutationFn: async (params: AnalysisParams) => {
      const apifyKey = pickKey()
      if (!apifyKey) throw new Error('No Apify keys available. All keys are in cooldown.')
      if (!geminiKey?.trim()) throw new Error('Gemini API key is not configured.')

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        startAnalysis(params)

        // Step 1: Scraping reference accounts (steps 2–4 inside discoverCompetitors)
        setStep(1)
        const { inputProfiles, candidateProfiles } = await discoverCompetitors(
          params.handles,
          apifyKey,
          controller.signal,
          params.depth,
        )

        if (candidateProfiles.length > 0) {
          const isSparse = candidateProfiles.length < MIN_COMPETITOR_RESULTS
          setStepProgressDetail(
            isSparse
              ? `Found only ${candidateProfiles.length} profiles — this niche may be sparse on Instagram`
              : `Found ${candidateProfiles.length} candidate accounts`
          )
          if (isSparse) setDidExpand(true)
        }
        setStep(4)

        // Generate the clarification question from the first 20 candidates.
        // Never throws — returns a safe fallback question on any error.
        const referenceProfile = inputProfiles[0]
        const clarificationQuestion = referenceProfile
          ? await generateClarificationQuestion(
              geminiKey,
              referenceProfile,
              candidateProfiles,
              params.nicheContext,
              controller.signal,
            )
          : { question: 'Which direction best fits your client?', options: ['Exact niche match', 'Broader category'] }

        // Transition to clarifying state — UI shows <ClarificationCard>
        setClarification({ inputProfiles, candidateProfiles, clarificationQuestion })

        return { inputProfiles, candidateProfiles }

      } catch (err) {
        console.error('[analysis:discover] failed:', err)
        const message = buildErrorMessage(err, controller, apifyKey, pickKey)
        setError(message)
        throw new Error(message, { cause: err })
      } finally {
        clearTimeout(timeout)
      }
    },
    retry: 0,
    gcTime: 30 * 60 * 1000,
  })

  // ── Phase 2: Ranking with clarification answer injected ───────────────────

  const analyzeMutation = useMutation({
    mutationFn: async ({ answer, nicheContext }: { answer: string; nicheContext: string }) => {
      if (!geminiKey?.trim()) throw new Error('Gemini API key is not configured.')

      // Read pendingDiscovery synchronously from store at call time — avoids stale closure.
      const discovery = useAnalysisStore.getState().pendingDiscovery
      if (!discovery) throw new Error('No discovery data available — please restart the analysis.')

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        setStep(5)
        const { inputProfiles, candidateProfiles } = discovery
        const knownHandles = new Set(candidateProfiles.map((p) => p.username.toLowerCase()))

        // Step 5: AI rationale — pass both nicheContext and clarification answer
        let output = await analyzeCompetitors(
          geminiKey,
          inputProfiles,
          candidateProfiles,
          controller.signal,
          nicheContext || undefined,
          answer || undefined,
        )

        // Zero-result guard: if filter signals were set and Gemini returned nothing,
        // retry without them so the user sees at least some results with a warning.
        const hasFilterSignal = (nicheContext || '').trim().length > 0 || (answer || '').trim().length > 0
        if (output.competitors.length === 0 && hasFilterSignal) {
          console.warn('[analysis] zero competitors with filter signals — retrying without them')
          output = await analyzeCompetitors(
            geminiKey,
            inputProfiles,
            candidateProfiles,
            controller.signal,
          )
        }

        // Apply hallucination filter (post-retry, so both paths are filtered)
        const filteredCompetitors = output.competitors.filter((c) => knownHandles.has(c.username.toLowerCase()))
        output = { ...output, competitors: filteredCompetitors }

        if (output.competitors.length === 0) {
          throw new Error(
            'No verified competitors found — Gemini returned accounts that weren\'t in the scraped set. Try again or use different reference handles.',
          )
        }

        setResults(output, inputProfiles, candidateProfiles.length)
        return output

      } catch (err) {
        console.error('[analysis:analyze] failed:', err)
        const message = buildErrorMessage(err, controller, null, () => null)
        setError(message)
        throw new Error(message, { cause: err })
      } finally {
        clearTimeout(timeout)
      }
    },
    retry: 0,
    gcTime: 30 * 60 * 1000,
  })

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Kick off Phase 1 (discovery + question generation). */
  const analyze = (params: AnalysisParams) => {
    discoverMutation.mutate(params)
  }

  /**
   * Called when user selects an option in <ClarificationCard>.
   * Stores the answer and immediately fires Phase 2 (ranking).
   * Pass an empty string to proceed without refinement ("Looks right, proceed as-is").
   */
  const answerClarification = (answer: string) => {
    storeAnswerClarification(answer)
    const currentParams = useAnalysisStore.getState().params
    if (!currentParams) return
    analyzeMutation.mutate({ answer, nicheContext: currentParams.nicheContext })
  }

  return {
    analyze,
    answerClarification,
    isPending: discoverMutation.isPending || analyzeMutation.isPending,
    isError: discoverMutation.isError || analyzeMutation.isError,
    reset,
  }
}

// ── Error message builder ──────────────────────────────────────────────────

// SECURITY (C2/H11): fixed, friendly messages keyed by error code. Raw error.message
// is never shown to the user — Apify bodies can echo request internals/handles.
const APIFY_FRIENDLY: Record<string, string> = {
  RUN_START_FAILED: 'Scraping failed to start — try again or check your Apify key.',
  POLL_FAILED: 'Lost connection to Apify while scraping — try again.',
  RUN_FAILED: 'The scrape failed on Apify — try again with different handles.',
  RUN_TIMEOUT: 'Scraping took too long on Apify — try again with fewer handles.',
  RUN_ABORTED: 'The scrape was stopped — try again.',
  POLL_TIMEOUT: 'Scraping took too long — try again with fewer handles.',
  DATASET_FETCH_FAILED: "Couldn't fetch results from Apify — try again.",
  ABORTED: 'Scraping was cancelled.',
}

const GEMINI_FRIENDLY: Record<string, string> = {
  AUTH_ERROR: 'Gemini API key is invalid or missing — update it in Settings.',
  RATE_LIMITED: 'Gemini rate limit hit — wait a few seconds and try again.',
  SAFETY_BLOCK: 'The AI declined this request — try different inputs.',
  INVALID_PROMPT: 'AI analysis failed on the input — try again.',
  PARSE_ERROR: 'The AI returned an unexpected response — try again.',
  INTERNAL_ERROR: 'Gemini had an internal error — try again in a moment.',
  UNAVAILABLE: 'Gemini is temporarily unavailable — try again shortly.',
  UNKNOWN: 'AI analysis failed — try again.',
}

function buildErrorMessage(
  err: unknown,
  controller: AbortController,
  apifyKey: string | null,
  pickKey: () => string | null,
): string {
  if (controller.signal.aborted) {
    return 'Analysis timed out after 150 seconds. Try with fewer handles or check your Apify key.'
  }
  if (err instanceof ApifyError) {
    if (err.code === 'RATE_LIMITED') {
      if (apifyKey) markKeyCooldown(apifyKey)
      return `Apify key rate limited and placed in 15-minute cooldown. ${
        pickKey() ? 'Retrying with next key — please try again.' : 'All keys are in cooldown.'
      }`
    }
    // SECURITY (C2): map error code → fixed friendly string. Never forward
    // err.message — it can carry the raw Apify response body.
    return APIFY_FRIENDLY[err.code] ?? 'Scraping failed — try again or check your Apify key.'
  }
  if (err instanceof GeminiError) {
    return GEMINI_FRIENDLY[err.code] ?? 'AI analysis failed — try again.'
  }
  if (err instanceof TypeError && (err.message === 'Failed to fetch' || err.message.includes('fetch'))) {
    return `Network blocked — could not reach Apify API. If you're using Brave browser, click the Brave shield icon in the address bar and turn off "Block trackers & ads" for localhost, then try again.`
  }
  if (err instanceof Error) {
    // SECURITY (C2): never surface a raw error message — even a generic Error
    // could carry interpolated internal detail. Map to a fixed string.
    return 'An unexpected error occurred — try again.'
  }
  return 'An unexpected error occurred.'
}
