/**
 * Main analysis hook — orchestrates the full competitor discovery pipeline.
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
import { analyzeCompetitors } from '../ai/gemini'
import { markKeyCooldown } from '../lib/keyRotator'
import { ApifyError } from '../lib/apifyClient'
import { GeminiError } from '../ai/gemini'

const TIMEOUT_MS = 150_000

export function useCompetitorAnalysis() {
  const { startAnalysis, setStep, setResults, setError, reset } = useAnalysisStore()
  const { geminiKey, pickKey } = useKeysStore()

  const mutation = useMutation({
    mutationFn: async (params: AnalysisParams) => {
      const apifyKey = pickKey()
      if (!apifyKey) throw new Error('No Apify keys available. All keys are in cooldown.')
      if (!geminiKey?.trim()) throw new Error('Gemini API key is not configured.')

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        startAnalysis(params)

        // Step 1: Scraping reference accounts
        setStep(1)
        const { inputProfiles, candidateProfiles } = await discoverCompetitors(
          params.handles,
          apifyKey,
          controller.signal,
          params.depth,
        )

        // Step 2–4: handled inside discoverCompetitors (2–3 rounds + ranking data)
        setStep(4)

        // Hallucination filter: build a set of known candidate usernames.
        // Gemini occasionally invents handles not in the candidate list — remove them.
        const knownHandles = new Set(candidateProfiles.map((p) => p.username.toLowerCase()))

        // Step 5: AI rationale
        setStep(5)
        let output = await analyzeCompetitors(
          geminiKey,
          inputProfiles,
          candidateProfiles,
          controller.signal,
          params.nicheContext,
        )

        // Zero-result guard: if nicheContext was set and Gemini returned nothing,
        // retry without it so the user sees at least some results with a warning.
        if (output.competitors.length === 0 && params.nicheContext.trim()) {
          console.warn('[analysis] zero competitors with nicheContext — retrying without it')
          output = await analyzeCompetitors(
            geminiKey,
            inputProfiles,
            candidateProfiles,
            controller.signal,
          )
        }

        // Apply hallucination filter (post-retry, so both paths are filtered)
        output = {
          ...output,
          competitors: output.competitors.filter((c) => knownHandles.has(c.username.toLowerCase())),
        }

        setResults(output, inputProfiles)
        return output

      } catch (err) {
        console.error('[analysis] failed:', err)
        let message = 'An unexpected error occurred.'

        if (controller.signal.aborted) {
          message = 'Analysis timed out after 150 seconds. Try with fewer handles or check your Apify key.'
        } else if (err instanceof ApifyError) {
          if (err.code === 'RATE_LIMITED') {
            markKeyCooldown(apifyKey)
            message = `Apify key rate limited and placed in 15-minute cooldown. ${
              pickKey() ? 'Retrying with next key — please try again.' : 'All keys are in cooldown.'
            }`
          } else {
            message = `Scraping error (${err.code}): ${err.message}`
          }
        } else if (err instanceof GeminiError) {
          message = `AI error (${err.code}): ${err.message}`
        } else if (err instanceof TypeError && (err.message === 'Failed to fetch' || err.message.includes('fetch'))) {
          message = `Network blocked — could not reach Apify API. If you're using Brave browser, click the Brave shield icon in the address bar and turn off "Block trackers & ads" for localhost, then try again.`
        } else if (err instanceof Error) {
          message = err.message
        }

        setError(message)
        throw new Error(message)
      } finally {
        clearTimeout(timeout)
      }
    },
    retry: 0,       // no automatic retries — 120s ops must be user-initiated
    gcTime: 30 * 60 * 1000,
  })

  return {
    analyze: mutation.mutate,
    isPending: mutation.isPending,
    isError: mutation.isError,
    reset,
  }
}
