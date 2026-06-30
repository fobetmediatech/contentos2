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
import { discoverCompetitors, type ScrapeResult } from '../lib/apifyClient'
import { webFallbackCompetitors } from '../lib/webFallback'
import { deriveNicheFromProfiles } from '../lib/deriveNiche'
import type { NormalizedProfile } from '../lib/transformers'
import { analyzeCompetitors, generateClarificationQuestion } from '../ai/gemini'
import { buildPipelineErrorMessage, sparseSeedMessage, ALL_DISMISSED_MESSAGE, alreadyCollectedMessage, poolExhaustedMessage } from '../lib/errorMessages'
import { getShownProfiles } from '../lib/competitorCache'
import type { CompetitorAnalysisResult } from '../ai/prompts'
import { linkAbort } from '../lib/abortControl'
import { useCorpusStore } from '../store/corpusStore'
import { dropDismissedCandidates, selectPreferenceExemplars } from '../lib/corpus'
import { buildCorpusSignals } from '../ai/prompts'

const TIMEOUT_MS = 150_000
// The web fallback runs AFTER a scrape failure, so it cannot share the run's abort budget — on a
// timeout that budget is already spent (the signal is aborted, which is what killed the scrape).
// It gets its own fresh timer (one grounded web-search call, ~10–30s), linked only to the external
// steer signal so a genuine user supersede still cancels it.
const FALLBACK_TIMEOUT_MS = 60_000
const MIN_COMPETITOR_RESULTS = 8
// Below this many on-pool picks after the strict niche pass, attempt a relaxed top-up to avoid
// very thin results. Conservative (< the 8 sparse threshold) so the precision-first ranking is
// only supplemented when the niche pool is genuinely thin — not routinely padded with broader picks.
const UNDERFILL_FLOOR = 6
const MAX_COMPETITOR_RESULTS = 10 // Top 5 + Trending 5
/** Target RELEVANT (non-thumbs-downed) competitors PER CATEGORY (5 established/top + 5 growing/trending). */
export const TARGET_PER_CATEGORY = 5

/**
 * Keep up to `topMax` 'top' + `trendingMax' 'trending' results, lowest rank first within each
 * category. Lets a re-run fill each category's deficit independently. Pure — unit-tested.
 */
export function capByCategory(
  list: CompetitorAnalysisResult[],
  topMax: number,
  trendingMax: number,
): CompetitorAnalysisResult[] {
  const byRank = (a: CompetitorAnalysisResult, b: CompetitorAnalysisResult) => a.rank - b.rank
  const top = list.filter((c) => c.category === 'top').sort(byRank).slice(0, Math.max(0, topMax))
  const trending = list.filter((c) => c.category === 'trending').sort(byRank).slice(0, Math.max(0, trendingMax))
  return [...top, ...trending]
}

export function useCompetitorAnalysis() {
  const store = useAnalysisStore()
  const { startAnalysis, setStep, setResults, setError, reset, setClarification, setStepProgressDetail, setDidExpand, answerClarification: storeAnswerClarification } = store
  const { geminiKeys, apifyKeys, pickKey } = useKeysStore()

  // Web fallback (Apify-block degrade): rank competitors DIRECTLY from web search when scraping is
  // unavailable. Returns true if it produced + set a result; false to let the caller surface the
  // original error. `ctx` carries whatever survived the failed scrape — reference profiles + the
  // knowledge-seed briefing on a SOFT block (empty pool), nothing on a HARD Round-1 block.
  const attemptWebFallback = async (
    params: AnalysisParams,
    externalSignal: AbortSignal | undefined,
    ctx: { inputProfiles?: NormalizedProfile[]; briefing?: string } = {},
  ): Promise<boolean> => {
    // Fresh abort budget — NEVER the caller's run signal, which is already aborted on the timeout
    // path. Linked to the external (agent-loop) steer signal so a new user message still cancels it.
    const fbAbort = linkAbort(FALLBACK_TIMEOUT_MS, externalSignal)
    try {
      const refProfiles = ctx.inputProfiles ?? []
      const niche = (params.nicheContext || '').trim() || deriveNicheFromProfiles(refProfiles)
      const { output, profiles } = await webFallbackCompetitors(
        geminiKeys,
        { handles: params.handles, niche, briefing: ctx.briefing, refProfiles, mode: params.mode ?? 'precise' },
        fbAbort.signal,
      )
      if (output.competitors.length === 0) return false
      // The stub profiles ARE the candidate set here; flag unverified so the UI banners the result
      // (`~est`/`—` metrics) and the corpus harvest is skipped.
      setResults(output, refProfiles, profiles.length, profiles, true)
      return true
    } finally {
      fbAbort.cleanup()
    }
  }

  // ── Phase 1: Discovery + clarification question generation ────────────────

  const discoverMutation = useMutation({
    mutationFn: async ({ params, externalSignal, autoAnswer }: { params: AnalysisParams; externalSignal?: AbortSignal; autoAnswer?: string }) => {
      // linkAbort: internal 150s timeout + an optional external (agent-loop) signal.
      const abort = linkAbort(TIMEOUT_MS, externalSignal)

      try {
        // 2.1: capture the active conversation so results land there even if the user
        // switches conversations while the 150s scrape is running.
        const runConversationId = useConversationsStore.getState().activeId
        startAnalysis(params, runConversationId)

        // Step 1: Scraping reference accounts (steps 2–4 inside discoverCompetitors)
        setStep(1)
        // HARD-block path: when Instagram blocks Apify, the scrape throws (timeout/hang, rate-limit,
        // run-failed). Rather than dead-ending, rank competitors from web search instead.
        let discovered: ScrapeResult
        try {
          discovered = await discoverCompetitors(
            params.handles,
            apifyKeys,
            abort.signal,
            params.depth,
            { niche: params.nicheContext, geminiKeys, mode: params.mode ?? 'precise' },
          )
        } catch (scrapeErr) {
          if (abort.wasSuperseded()) return undefined
          console.warn('[analysis:discover] scrape failed — attempting web fallback:', scrapeErr)
          if (await attemptWebFallback(params, externalSignal)) return undefined
          throw scrapeErr // fallback found nothing → surface the original Apify error
        }
        const { inputProfiles, candidateProfiles, nicheBriefing } = discovered

        // SOFT-block / empty-pool path: the run SUCCEEDED but returned no usable candidates — most
        // often Instagram served a login wall (empty dataset), sometimes a genuinely sparse niche.
        // Try the web fallback first (reusing the briefing + reference profiles that survived — the
        // knowledge seed is a Gemini call, so it can outlive an Apify block); only then dead-end.
        if (candidateProfiles.length === 0) {
          console.warn('[analysis:discover] empty candidate pool — attempting web fallback')
          if (await attemptWebFallback(params, externalSignal, { inputProfiles, briefing: nicheBriefing })) return undefined
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

        // Store the discovery data so Phase 2 (analyzeMutation) can read it from the store.
        // The web-grounded niche briefing rides along so ranking gets the same subniche context.
        setClarification({ inputProfiles, candidateProfiles: candidates, clarificationQuestion, nicheBriefing })

        // Re-run path ("Start over"): an autoAnswer reuses the first run's clarification silently —
        // skip the card and fire ranking directly. storeAnswerClarification flips status to 'running'
        // synchronously (same tick), so the 'clarifying' UI never renders.
        if (autoAnswer !== undefined) {
          storeAnswerClarification(autoAnswer)
          analyzeMutation.mutate({ answer: autoAnswer, nicheContext: params.nicheContext, externalSignal })
        }

        return { inputProfiles, candidateProfiles: candidates }

      } catch (err) {
        // Superseded by the agent loop (latest-wins steer) — silent, not a failure.
        if (abort.wasSuperseded()) return undefined
        console.error('[analysis:discover] failed:', err)
        const message = buildPipelineErrorMessage(err, abort.signal, pickKey, 'Scraping timed out. Instagram may be temporarily blocking our data provider (Apify) — a known upstream issue that usually clears within a few hours. Try again later, or with fewer handles.')
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
        const mode = useAnalysisStore.getState().params?.mode ?? 'precise'

        // Load the per-conversation shown map (username → category) and filter out already-seen
        // profiles. Returns {} on first run or IDB unavailability — the filter is then a no-op.
        const runConvId = useAnalysisStore.getState().runConversationId ?? ''
        const inputHandles = useAnalysisStore.getState().params?.handles ?? []
        const shownMap = await getShownProfiles(runConvId, inputHandles)
        const shownSet = new Set(Object.keys(shownMap))
        const freshCandidates = shownSet.size > 0
          ? candidateProfiles.filter((p) => !shownSet.has(p.username.toLowerCase()))
          : candidateProfiles

        const corpusCreators = useCorpusStore.getState().creators

        // Relevant = shown profiles the user has NOT thumbs-downed, counted PER CATEGORY. Each
        // category targets only its own remaining gap toward TARGET_PER_CATEGORY (5 top + 5 trending),
        // so a re-run fills only the deficit folder(s) instead of a combined total.
        const dismissed = new Set(
          Object.values(corpusCreators)
            .filter((c) => c.feedback === 'dismissed')
            .map((c) => c.username.toLowerCase()),
        )
        const relevantTop = Object.entries(shownMap).filter(([u, cat]) => cat === 'top' && !dismissed.has(u)).length
        const relevantTrending = Object.entries(shownMap).filter(([u, cat]) => cat === 'trending' && !dismissed.has(u)).length
        const topTarget = Math.max(0, TARGET_PER_CATEGORY - relevantTop)
        const trendingTarget = Math.max(0, TARGET_PER_CATEGORY - relevantTrending)

        // Both categories full (primary stop is the pre-scrape check in ChatPage; this is
        // belt-and-suspenders for direct re-entry). Pool exhausted before reaching the target.
        if (topTarget <= 0 && trendingTarget <= 0) {
          throw new Error(alreadyCollectedMessage(TARGET_PER_CATEGORY * 2))
        }
        if (freshCandidates.length === 0) {
          throw new Error(poolExhaustedMessage(relevantTop + relevantTrending))
        }

        // Hallucination-filter pool = the fresh candidates we actually rank (already-shown excluded).
        const knownHandles = new Set(freshCandidates.map((p) => p.username.toLowerCase()))

        // 3b (Phase 3): bias ranking toward the strategist's saved traits, away from dismissed.
        const preferenceExemplars = selectPreferenceExemplars(Object.values(corpusCreators), nicheContext)
        // 4.4: annotate candidate lines with corpus recognition signal ([KNOWN: seen Nx in 'niche']).
        const corpusSignals = buildCorpusSignals(freshCandidates.map((p) => p.username), corpusCreators)
        const corpusArg = Object.keys(corpusSignals).length > 0 ? corpusSignals : undefined

        // Hallucination filter: a returned handle must exist in the scraped pool. Strip a leading
        // @ before matching — Gemini occasionally returns "@handle" despite the "no @" instruction.
        const normHandle = (u: string) => u.replace(/^@/, '').toLowerCase()
        const inPool = (c: { username: string }) => knownHandles.has(normHandle(c.username))

        // Step 5: AI rationale — nicheContext + clarification answer + preference + corpus signals
        const output = await analyzeCompetitors(
          geminiKeys,
          inputProfiles,
          freshCandidates,
          abort.signal,
          nicheContext || undefined,
          answer || undefined,
          preferenceExemplars,
          corpusArg,
          mode,
          discovery.nicheBriefing || undefined,
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
            freshCandidates,
            abort.signal,
            undefined,
            undefined,
            preferenceExemplars,
            corpusArg,
            mode,
            // Keep the niche briefing even on the relaxed pass: it's subniche UNDERSTANDING, not a
            // narrowing filter, so it sharpens the broader picks without re-imposing the strict gate.
            discovery.nicheBriefing || undefined,
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

        // Cap each category to its own remaining gap so a re-run fills only the deficit folder(s)
        // toward TARGET_PER_CATEGORY (5 established + 5 growing). The merge in ChatPage then stitches
        // these onto the carried-over relevant accounts for the full accumulated view.
        const capped = capByCategory(competitors, topTarget, trendingTarget)
        if (capped.length === 0) {
          throw new Error(
            'No verified competitors found — Gemini returned accounts that weren\'t in the scraped set. Try again or use different reference handles.',
          )
        }

        const finalOutput = { ...output, competitors: capped }
        setResults(finalOutput, inputProfiles, candidateProfiles.length, candidateProfiles)
        return finalOutput

      } catch (err) {
        if (abort.wasSuperseded()) return undefined
        console.error('[analysis:analyze] failed:', err)
        const message = buildPipelineErrorMessage(err, abort.signal, () => null, 'Scraping timed out. Instagram may be temporarily blocking our data provider (Apify) — a known upstream issue that usually clears within a few hours. Try again later, or with fewer handles.')
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

  /**
   * Kick off Phase 1 (discovery + question generation).
   * Pass `autoAnswer` to skip the clarification card and rank directly with that answer —
   * used by "Start over" re-runs to reuse the first run's clarification silently.
   */
  const analyze = (params: AnalysisParams, externalSignal?: AbortSignal, autoAnswer?: string) => {
    discoverMutation.mutate({ params, externalSignal, autoAnswer })
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
