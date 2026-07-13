/**
 * Single-reel analysis orchestration — the chat-triggered "analyze ONE reel by URL" path.
 *
 *   cache hit → render instantly
 *   miss → scrapeSingleReel (Apify) → POST /api/analyze-single-reel → store + cache.
 *
 * Signature: startSingleReel(runId, reelUrl, signal)
 * The run MUST be created by the caller before invoking this function.
 * Progress + result/error are written via runsStore (not singleReelStore).
 *
 * Mirrors useTranscriptAnalysis: keys from useKeysStore (the /api/apify + serverless proxies hold
 * the real keys), AbortSignal for latest-wins, user-safe error strings only. The Clerk
 * session JWT is attached exactly as the deep path does (reelAnalyzer.ts / apifyCore.ts /
 * gemini.ts all use getClerkSessionToken() → `Authorization: Bearer <token>`).
 */

import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useRunsStore } from '../store/runsStore'
import type { RunId } from '../domain/runs'
import type { SingleReelResult } from '../domain/reel'
import { useCorpusStore } from '../store/corpusStore'
import { scrapeSingleReel } from '../lib/singleReelClient'
import { getCachedSingleReel, setCachedSingleReel } from '../lib/singleReelCache'
import { parseReelUrl } from '../lib/reelUrl'
import { getClerkSessionToken } from '../lib/clerkToken'
import { devWarn } from '../lib/devLog'

export function useSingleReelAnalysis() {
  const { apifyKeys } = useKeysStore()

  const startSingleReel = useCallback(
    async (runId: RunId, reelUrl: string, signal: AbortSignal) => {
      const parsed = parseReelUrl(reelUrl)
      if (!parsed) {
        useRunsStore.getState().failRun(runId, "That doesn't look like an Instagram reel link.")
        return
      }
      const { shortCode, canonicalUrl } = parsed

      // Optimistic progress update + label refinement at the start of the run.
      useRunsStore.getState().updateRun(runId, { progress: 'Scraping reel…', targetLabel: shortCode ?? canonicalUrl })

      // Cache hit → render instantly.
      // Latest-wins: a steer during the (fast) IDB read must not land a stale result.
      const cached = await getCachedSingleReel(shortCode)
      if (signal.aborted) return
      if (cached) {
        useRunsStore.getState().finishRun(runId, {
          kind: 'single-reel',
          reelUrl: canonicalUrl,
          shortCode,
          result: cached,
        })
        return
      }

      try {
        const reel = await scrapeSingleReel(canonicalUrl, apifyKeys, signal)
        if (signal.aborted) return

        useRunsStore.getState().updateRun(runId, { progress: 'Transcribing & analysing…' })

        // Attach the Clerk session JWT exactly as the deep reel path (analyze-reel-video) does:
        // getClerkSessionToken() → `Authorization: Bearer <token>` (coalesced across the burst).
        // A 401 can be a transient token-window miss — retry ONCE with a freshly fetched token.
        const reqBody = JSON.stringify({
          downloadedVideoUrl: reel.downloadedVideoUrl,
          shortCode: reel.shortCode,
          apify: {
            ownerUsername: reel.ownerUsername,
            caption: reel.caption,
            likesCount: reel.likesCount,
            commentsCount: reel.commentsCount,
            videoViewCount: reel.videoViewCount,
            videoDuration: reel.videoDuration,
            hashtags: reel.hashtags,
            timestamp: reel.timestamp,
            musicInfo: reel.musicInfo,
          },
        })
        const post = async (): Promise<Response> => {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          const token = await getClerkSessionToken()
          if (token) headers['Authorization'] = `Bearer ${token}`
          return fetch('/api/analyze-single-reel', { method: 'POST', headers, body: reqBody, signal })
        }
        let res = await post()
        if (res.status === 401) {
          if (signal.aborted) return
          res = await post()
        }
        if (signal.aborted) return
        if (!res.ok) {
          // DEV diagnostic: the user-facing string is intentionally generic, so surface the real
          // server error ({ error: "Server not configured" | "Video fetch failed (...)" | ... }).
          let detail = ''
          try {
            detail = await res.clone().text()
          } catch {
            /* ignore body read failure */
          }
          devWarn('[single-reel] /api/analyze-single-reel failed', res.status, detail)
          useRunsStore.getState().failRun(runId, 'Could not analyse that reel.')
          return
        }
        const json = (await res.json()) as { result: SingleReelResult }
        useRunsStore.getState().finishRun(runId, {
          kind: 'single-reel',
          reelUrl: canonicalUrl,
          shortCode,
          result: json.result,
        })
        void setCachedSingleReel(shortCode, json.result)

        // Persist into the shared corpus so this reel shows up in the gallery (transcript +
        // caption + metrics + thumbnail, URL only). Best-effort — never blocks the result.
        void useCorpusStore
          .getState()
          .rememberContent([
            {
              id: reel.shortCode,
              creatorUsername: reel.ownerUsername,
              kind: 'reel',
              url: reel.url,
              caption: reel.caption || undefined,
              thumbnailUrl: reel.displayUrl || undefined,
              transcript: json.result.transcript || undefined,
              videoViewCount: reel.videoViewCount,
              likesCount: reel.likesCount,
              commentsCount: reel.commentsCount,
              analyzedAt: Date.now(),
            },
          ])
          .catch(() => {})
      } catch (err) {
        if (signal.aborted || (err as Error)?.name === 'AbortError') return
        // DEV diagnostic: this catches a scrape failure (ApifyError) or a network error BEFORE the
        // analyzer responds — the most common cause when the @handle/competitor paths work but this
        // one doesn't. The error carries the real reason (e.g. no downloadable video, 402 quota).
        devWarn('[single-reel] scrape/network threw before analysis', err)
        useRunsStore.getState().failRun(runId, 'Could not analyse that reel.')
      }
    },
    [apifyKeys],
  )

  return { startSingleReel }
}
