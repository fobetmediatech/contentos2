/**
 * Location discovery hook — orchestrates the full discovery pipeline.
 *
 * Flow:
 *   Step 1: Generate location-aware hashtags (Gemini micro-call or rule fallback)
 *   Step 2: Scrape hashtag posts → extract creator handles
 *   Step 3: Profile-scrape candidate handles (cap: 60)
 *   Step 4: Location filter → narrow to city-signal profiles
 *   Step 5: AI analysis → 10 ranked DiscoveryResult cards
 *
 * Safety patterns (mirrored from useCompetitorAnalysis.ts):
 *   - Hallucination filter: cross-reference Gemini usernames against scraped handle set
 *   - Zero-result retry: retry analyzeDiscovery without city/niche context on 0 results
 *   - 150s AbortController timeout
 */

import { useMutation } from '@tanstack/react-query'
import { useDiscoveryStore, type DiscoveryParams } from '../store/discoveryStore'
import { useKeysStore } from '../store/keysStore'
import { generateHashtags } from '../lib/hashtagGenerator'
import { runLocationDiscovery } from '../lib/discoveryClient'
import { analyzeDiscovery } from '../ai/gemini'
import { markKeyCooldown } from '../lib/keyRotator'
import { ApifyError } from '../lib/apifyCore'
import { GeminiError } from '../ai/gemini'

const TIMEOUT_MS = 150_000

export function useLocationDiscovery() {
  const { startDiscovery, setStep, setResults, setError, reset } = useDiscoveryStore()
  const { geminiKey, pickKey } = useKeysStore()

  const mutation = useMutation({
    mutationFn: async (params: DiscoveryParams) => {
      const apifyKey = pickKey()
      if (!apifyKey) throw new Error('No Apify keys available. All keys are in cooldown.')
      if (!geminiKey?.trim()) throw new Error('Gemini API key is not configured.')

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        startDiscovery(params)

        // Step 1: Generate location-aware hashtags
        setStep(1)
        const { hashtags } = await generateHashtags(
          geminiKey,
          params.city,
          params.niche,
          params.depth,
          controller.signal,
        )

        // Step 2: Scrape hashtag posts → handles (inside runLocationDiscovery)
        setStep(2)

        // Step 3 + 4: Profile scrape → location filter (inside runLocationDiscovery)
        // We advance step markers manually as the pipeline progresses.
        const { candidateProfiles, filterResult, scrapedHashtags } = await runLocationDiscovery(
          hashtags,
          params.city,
          apifyKey,
          params.depth,
          controller.signal,
        )

        setStep(3)
        setStep(4)

        // Bail early if no candidates at all
        if (filterResult.filtered.length === 0) {
          throw new Error(
            `We found no creators in ${params.city} for "${params.niche}". Try a broader city or niche.`,
          )
        }

        // Build hallucination filter set from scraped profile usernames
        const knownHandles = new Set(candidateProfiles.map((p) => p.username.toLowerCase()))

        // Step 5: AI analysis
        setStep(5)
        let output = await analyzeDiscovery(
          geminiKey,
          params.city,
          params.niche,
          filterResult.filtered,
          controller.signal,
        )

        // Zero-result guard: if Gemini returned nothing, retry without city/niche context
        if (output.results.length === 0) {
          console.warn('[discovery] zero results from AI — retrying without city/niche context')
          output = await analyzeDiscovery(
            geminiKey,
            params.city,
            params.niche,
            candidateProfiles,  // use ALL candidates, not just filtered
            controller.signal,
          )
        }

        // Apply hallucination filter (post-retry, so both paths are filtered)
        output = {
          ...output,
          results: output.results.filter((r) => knownHandles.has(r.username.toLowerCase())),
        }

        setResults(output, candidateProfiles, filterResult.relaxed, scrapedHashtags)
        return output

      } catch (err) {
        console.error('[discovery] failed:', err)
        let message = 'An unexpected error occurred.'

        if (controller.signal.aborted) {
          message = 'Discovery timed out after 150 seconds. Try Standard depth or check your Apify key.'
        } else if (err instanceof ApifyError) {
          if (err.code === 'RATE_LIMITED') {
            markKeyCooldown(apifyKey)
            message = `Apify key rate limited. ${
              pickKey() ? 'Retrying with next key — please try again.' : 'All keys are in cooldown.'
            }`
          } else {
            message = `Scraping error (${err.code}): ${err.message}`
          }
        } else if (err instanceof GeminiError) {
          message = `AI error (${err.code}): ${err.message}`
        } else if (err instanceof TypeError && err.message.includes('fetch')) {
          message = `Network blocked — could not reach Apify API. If you're using Brave, disable shields for this page.`
        } else if (err instanceof Error) {
          message = err.message
        }

        setError(message)
        throw new Error(message)
      } finally {
        clearTimeout(timeout)
      }
    },
    retry: 0,
    gcTime: 30 * 60 * 1000,
  })

  return {
    discover: mutation.mutate,
    isPending: mutation.isPending,
    isError: mutation.isError,
    reset,
  }
}
