/**
 * Transcript-only orchestration — the "get transcript for a reel URL" path.
 *
 *   cache hit (transcript or full-analysis cache) → render instantly
 *   miss → scrapeSingleReel (Apify) → POST /api/get-transcript → store + cache.
 *
 * Completely independent from useSingleReelAnalysis — separate store, separate
 * API endpoint, separate IDB cache. No shared state with the full analysis path.
 */

import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useTranscriptStore, type TranscriptResult } from '../store/transcriptStore'
import { useConversationsStore } from '../store/conversationsStore'
import { scrapeSingleReel } from '../lib/singleReelClient'
import { getCachedTranscript, setCachedTranscript } from '../lib/transcriptCache'
import { parseReelUrl } from '../lib/reelUrl'
import { getClerkSessionToken } from '../lib/clerkToken'
import { devWarn } from '../lib/devLog'

export function useTranscriptAnalysis() {
  const { apifyKeys } = useKeysStore()

  const startTranscript = useCallback(
    async (reelUrl: string, signal?: AbortSignal) => {
      const parsed = parseReelUrl(reelUrl)
      const store = useTranscriptStore.getState()
      if (!parsed) {
        store.setError("That doesn't look like an Instagram reel link.")
        return
      }
      const { shortCode, canonicalUrl } = parsed

      const conversationId = useConversationsStore.getState().activeId

      // Cache hit → render instantly (checks transcript cache then full-analysis cache).
      const cached = await getCachedTranscript(shortCode)
      if (signal?.aborted) return
      if (cached) {
        store.startRun(shortCode, canonicalUrl, conversationId)
        useTranscriptStore.getState().setResult(cached)
        return
      }

      store.startRun(shortCode, canonicalUrl, conversationId)

      try {
        const reel = await scrapeSingleReel(canonicalUrl, apifyKeys, signal)
        if (signal?.aborted) return

        useTranscriptStore.getState().setProgress('Transcribing…')

        const reqBody = JSON.stringify({
          downloadedVideoUrl: reel.downloadedVideoUrl,
          shortCode: reel.shortCode,
        })
        const post = async (): Promise<Response> => {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          const token = await getClerkSessionToken()
          if (token) headers['Authorization'] = `Bearer ${token}`
          return fetch('/api/get-transcript', { method: 'POST', headers, body: reqBody, signal })
        }
        let res = await post()
        if (res.status === 401) {
          if (signal?.aborted) return
          res = await post()
        }
        if (signal?.aborted) return
        if (!res.ok) {
          let detail = ''
          try { detail = await res.clone().text() } catch { /* ignore */ }
          devWarn('[transcript] /api/get-transcript failed', res.status, detail)
          useTranscriptStore.getState().setError('Could not transcribe that reel.')
          return
        }
        const json = (await res.json()) as { result: TranscriptResult }
        useTranscriptStore.getState().setResult(json.result)
        void setCachedTranscript(shortCode, json.result).catch(() => {})
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === 'AbortError') return
        devWarn('[transcript] scrape/network threw before transcription', err)
        useTranscriptStore.getState().setError('Could not transcribe that reel.')
      }
    },
    [apifyKeys],
  )

  return { startTranscript }
}
