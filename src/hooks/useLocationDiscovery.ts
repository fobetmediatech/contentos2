/**
 * Location discovery hook — orchestrates the full discovery pipeline.
 *
 * Flow:
 *   Step 1: Generate location-aware hashtags (Gemini micro-call or rule fallback)
 *   Step 2: Scrape hashtag posts → extract creator handles
 *   Step 3: Profile-scrape candidate handles (cap: 60)
 *   Step 4: Location filter → narrow to city-signal profiles
 *   Step 5: AI analysis → 10 ranked DiscoveryResult cards
 *   Step 6: (conditional) Expanding search — second hashtag batch when < MIN_LOCATION_RESULTS pass filter
 *
 * Safety patterns (mirrored from useCompetitorAnalysis.ts):
 *   - Hallucination filter: cross-reference Gemini usernames against scraped handle set
 *   - Zero-result retry: retry analyzeDiscovery without city/niche context on 0 results
 *   - 150s AbortController timeout
 *   - Expansion graceful degradation: expansion failure returns first-pass results, not an error
 */

import { useMutation } from '@tanstack/react-query'
import { useDiscoveryStore, type DiscoveryParams } from '../store/discoveryStore'
import { useConversationsStore } from '../store/conversationsStore'
import { useKeysStore } from '../store/keysStore'
import { generateHashtags } from '../lib/hashtagGenerator'
import { runLocationDiscovery } from '../lib/discoveryClient'
import { analyzeDiscovery } from '../ai/gemini'
import type { DiscoveryResult } from '../ai/prompts'
import { linkAbort } from '../lib/abortControl'
import { useCorpusStore } from '../store/corpusStore'
import { dropDismissedCandidates, selectPreferenceExemplars } from '../lib/corpus'
import { buildPipelineErrorMessage, ALL_DISMISSED_MESSAGE } from '../lib/errorMessages'

const TIMEOUT_MS = 150_000
// Minimum post-filter results before triggering a second hashtag batch
export const MIN_LOCATION_RESULTS = 4

export function useLocationDiscovery() {
  const { startDiscovery, setStep, setStepProgressDetail, setResults, setError, reset } = useDiscoveryStore()
  const { geminiKeys, apifyKeys, pickKey } = useKeysStore()

  const mutation = useMutation({
    mutationFn: async ({ params, externalSignal }: { params: DiscoveryParams; externalSignal?: AbortSignal }) => {
      // linkAbort: internal 150s timeout + an optional external (agent-loop) signal.
      // wasSuperseded() tells an intentional steer (silent) from a timeout (real error).
      const abort = linkAbort(TIMEOUT_MS, externalSignal)

      try {
        // 2.1: capture the active conversation so results land there even if the user
        // switches conversations while the 150s pipeline is running.
        const runConversationId = useConversationsStore.getState().activeId
        startDiscovery(params, runConversationId)

        // Sanitize user-supplied strings before embedding in AI prompts
        const safeCity = params.city.replace(/[\n\r]/g, ' ').trim()
        const safeNiche = params.niche.replace(/[\n\r]/g, ' ').trim()

        // Step 1: Generate location-aware hashtags
        setStep(1)
        const { hashtags } = await generateHashtags(
          geminiKeys,
          safeCity,
          safeNiche,
          params.depth,
          abort.signal,
        )

        // Step 2: Scrape hashtag posts → handles (inside runLocationDiscovery)
        setStep(2)

        // Step 3 + 4: Profile scrape → creator enrichment → location filter (inside runLocationDiscovery)
        // We advance step markers manually as the pipeline progresses.
        const { candidateProfiles, filterResult, scrapedHashtags: firstPassHashtags, creatorCount, businessCount } = await runLocationDiscovery(
          hashtags,
          safeCity,
          apifyKeys,
          params.depth,
          abort.signal,
        )
        let scrapedHashtags = firstPassHashtags

        setStep(3)
        setStep(4)

        // ── Quality gate: post-filter expansion ────────────────────────────────
        // If < MIN_LOCATION_RESULTS profiles passed the location filter and the
        // AbortController still has budget, generate a second hashtag batch
        // (excluding already-tried hashtags) and merge results.
        // Expansion failure degrades gracefully — first-pass results are preserved.
        let finalFiltered = filterResult.filtered
        let finalCandidates = candidateProfiles
        let didExpand = false

        if (filterResult.filtered.length < MIN_LOCATION_RESULTS && !abort.signal.aborted) {
          setStep(6)
          setStepProgressDetail(
            `Found only ${filterResult.filtered.length} creator${filterResult.filtered.length !== 1 ? 's' : ''} in ${safeCity} — trying new hashtags…`
          )

          try {
            const { hashtags: expandedHashtags } = await generateHashtags(
              geminiKeys,
              safeCity,
              safeNiche,
              'deep',          // always deep for expansion — more hashtags, different angle
              abort.signal,
              scrapedHashtags, // exclude already-tried hashtags (sanitized inside generateHashtags)
            )

            if (expandedHashtags.length > 0 && !abort.signal.aborted) {
              const expansion = await runLocationDiscovery(
                expandedHashtags,
                safeCity,
                apifyKeys,
                params.depth,
                abort.signal,
              )
              // Dedup against finalCandidates (full pool), not finalFiltered (filtered subset).
              // Using finalFiltered would re-add profiles that were scraped but didn't pass
              // the location filter, causing the same handle to appear twice in the Gemini input.
              const existingUsernames = new Set(finalCandidates.map(p => p.username.toLowerCase()))
              const newFiltered = expansion.filterResult.filtered.filter(
                p => !existingUsernames.has(p.username.toLowerCase())
              )
              const newCandidates = expansion.candidateProfiles.filter(
                p => !existingUsernames.has(p.username.toLowerCase())
              )
              finalFiltered = [...finalFiltered, ...newFiltered]
              finalCandidates = [...finalCandidates, ...newCandidates]
              scrapedHashtags = [...scrapedHashtags, ...expansion.scrapedHashtags]
              didExpand = true
            }
          } catch {
            // Expansion failed — continue with first-pass results rather than throwing
          }
        }
        // ── End quality gate ───────────────────────────────────────────────────

        // Bail early if still no candidates after expansion
        if (finalFiltered.length === 0) {
          throw new Error(
            `We found no creators in ${safeCity} for "${safeNiche}". Try a broader city or niche.`,
          )
        }

        // 3a (Phase 3): drop creators the user dismissed before ranking, so they stop
        // resurfacing in discovery too. Re-check with a distinct message if it empties the pool.
        finalFiltered = dropDismissedCandidates(finalFiltered, useCorpusStore.getState().creators)
        if (finalFiltered.length === 0) {
          throw new Error(ALL_DISMISSED_MESSAGE)
        }

        // Build hallucination filter set from ALL candidate profiles (including expansion)
        const knownHandles = new Set(finalCandidates.map((p) => p.username.toLowerCase()))

        // Step 5: AI analysis — pass pool composition so Gemini has grounded context
        setStep(5)
        // 3b (Phase 3): bias discovery ranking toward saved traits, away from dismissed.
        // No-op on a cold corpus; safeNiche drives same-niche weighting.
        const preferenceExemplars = selectPreferenceExemplars(
          Object.values(useCorpusStore.getState().creators),
          safeNiche,
        )
        let output = await analyzeDiscovery(
          geminiKeys,
          safeCity,
          safeNiche,
          finalFiltered,
          abort.signal,
          creatorCount,
          businessCount,
          preferenceExemplars,
        )

        // Zero-result guard: if Gemini returned nothing, retry without city/niche context
        // (removes Gemini's geographic/niche framing so it ranks by engagement alone)
        if (output.results.length === 0) {
          output = await analyzeDiscovery(
            geminiKeys,
            '',  // remove city context
            '',  // remove niche context
            finalCandidates,  // use ALL candidates (including expansion), not just filtered
            abort.signal,
            creatorCount,
            businessCount,
          )
        }

        // Apply hallucination filter (post-retry, so both paths are filtered)
        output = {
          ...output,
          results: output.results.filter((r) => knownHandles.has(r.username.toLowerCase())),
        }

        // locationConfidence post-filter: drop 'unknown' results only if ≥10 high-confidence remain.
        // When < 10 high-confidence results exist we preserve all results (including unknowns) to
        // avoid dropping below the 10-result target. On the non-expansion path with exactly 10
        // results and 1 unknown, the filter intentionally does not fire.
        const applyConfidenceFilter = (results: DiscoveryResult[]) => {
          const highConf = results.filter((r) => r.locationConfidence !== 'unknown')
          // Only trim 'unknown' results when 10+ high-confidence results exist —
          // matches the 10-result target so we never drop below it.
          return highConf.length >= 10 ? highConf : results
        }
        output = { ...output, results: applyConfidenceFilter(output.results) }

        setResults(output, finalCandidates, filterResult.relaxed, scrapedHashtags, didExpand)
        return output

      } catch (err) {
        // Superseded by the agent loop (latest-wins steer) — silent, not a failure.
        if (abort.wasSuperseded()) return undefined
        console.error('[discovery] failed:', err)
        const message = buildPipelineErrorMessage(
          err,
          abort.signal,
          pickKey,
          'Discovery timed out after 150 seconds. Try Standard depth or check your Apify key.',
        )
        setError(message)
        throw new Error(message, { cause: err })
      } finally {
        abort.cleanup()
      }
    },
    retry: 0,
    gcTime: 30 * 60 * 1000,
  })

  return {
    // Accepts an optional external signal so the agent loop (T8) can supersede a run.
    discover: (params: DiscoveryParams, externalSignal?: AbortSignal) =>
      mutation.mutate({ params, externalSignal }),
    isPending: mutation.isPending,
    isError: mutation.isError,
    reset,
  }
}
