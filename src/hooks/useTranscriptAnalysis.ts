/**
 * Transcript-only orchestration — the "get transcript for a reel URL" path.
 *
 *   cache hit (transcript or full-analysis cache) → render instantly
 *   miss → scrapeSingleReel (Apify) → POST /api/get-transcript → store + cache.
 *
 * Completely independent from useSingleReelAnalysis — separate store, separate
 * API endpoint, separate IDB cache. No shared state with the full analysis path.
 *
 * Signature: startTranscript(runId, reelUrl, signal)
 * The run MUST be created by the caller before invoking this function.
 * Progress + result/error are written via runsStore (not transcriptStore).
 */

import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useRunsStore } from '../store/runsStore'
import type { RunId } from '../domain/runs'
import type { TranscriptResult } from '../store/transcriptStore'
import { scrapeSingleReel } from '../lib/singleReelClient'
import { getCachedTranscript, setCachedTranscript } from '../lib/transcriptCache'
import { parseReelUrl } from '../lib/reelUrl'
import { getClerkSessionToken } from '../lib/clerkToken'
import { devWarn } from '../lib/devLog'

export function useTranscriptAnalysis() {
  const { apifyKeys } = useKeysStore()

  const startTranscript = useCallback(
    async (runId: RunId, reelUrl: string, signal: AbortSignal) => {
      const parsed = parseReelUrl(reelUrl)
      if (!parsed) {
        useRunsStore.getState().failRun(runId, "That doesn't look like an Instagram reel link.")
        return
      }
      const { shortCode, canonicalUrl } = parsed

      // Optimistic progress update at the start of the run.
      useRunsStore.getState().updateRun(runId, { progress: 'Transcribing…' })

      // Cache hit → render instantly (checks transcript cache then full-analysis cache).
      const cached = await getCachedTranscript(shortCode)
      if (signal.aborted) return
      if (cached) {
        useRunsStore.getState().finishRun(runId, {
          kind: 'transcript',
          reelUrl: canonicalUrl,
          transcript: cached.transcript,
          segments: cached.segments,
        })
        return
      }

      try {
        const reel = await scrapeSingleReel(canonicalUrl, apifyKeys, signal)
        if (signal.aborted) return

        useRunsStore.getState().updateRun(runId, { progress: 'Transcribing…' })

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
          if (signal.aborted) return
          res = await post()
        }
        if (signal.aborted) return
        if (!res.ok) {
          let detail = ''
          try { detail = await res.clone().text() } catch { /* ignore */ }
          devWarn('[transcript] /api/get-transcript failed', res.status, detail)
          useRunsStore.getState().failRun(runId, 'Could not transcribe that reel.')
          return
        }
        const json = (await res.json()) as { result: TranscriptResult }
        useRunsStore.getState().finishRun(runId, {
          kind: 'transcript',
          reelUrl: canonicalUrl,
          transcript: json.result.transcript,
          segments: json.result.segments,
        })
        void setCachedTranscript(shortCode, json.result).catch(() => {})
      } catch (err) {
        if (signal.aborted || (err as Error)?.name === 'AbortError') return
        devWarn('[transcript] scrape/network threw before transcription', err)
        useRunsStore.getState().failRun(runId, 'Could not transcribe that reel.')
      }
    },
    [apifyKeys],
  )

  return { startTranscript }
}
