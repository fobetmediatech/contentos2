/**
 * Single-reel analysis orchestration — the chat-triggered "analyze ONE reel by URL" path.
 *
 *   cache hit → render instantly
 *   miss → scrapeSingleReel (Apify) → POST /api/analyze-single-reel → store + cache.
 *
 * Mirrors useReelAnalysis: keys from useKeysStore (the /api/apify + serverless proxies hold
 * the real keys), AbortSignal for latest-wins, user-safe error strings only. The Clerk
 * session JWT is attached exactly as the deep path does (reelAnalyzer.ts / apifyCore.ts /
 * gemini.ts all use getClerkSessionToken() → `Authorization: Bearer <token>`).
 */

import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useSingleReelStore, type SingleReelResult } from '../store/singleReelStore'
import { useConversationsStore } from '../store/conversationsStore'
import { scrapeSingleReel } from '../lib/singleReelClient'
import { getCachedSingleReel, setCachedSingleReel } from '../lib/singleReelCache'
import { parseReelUrl } from '../lib/reelUrl'
import { getClerkSessionToken } from '../lib/clerkToken'

export function useSingleReelAnalysis() {
  const { apifyKeys } = useKeysStore()

  const startSingleReel = useCallback(
    async (reelUrl: string, signal?: AbortSignal) => {
      const parsed = parseReelUrl(reelUrl)
      const store = useSingleReelStore.getState()
      if (!parsed) {
        store.setError("That doesn't look like an Instagram reel link.")
        return
      }
      const { shortCode, canonicalUrl } = parsed

      // Cache hit → render instantly. Tag the run to the active conversation first so the
      // result lands in the right chat (mirrors how useReelAnalysis binds reelConversationId).
      const conversationId = useConversationsStore.getState().activeId
      const cached = await getCachedSingleReel(shortCode)
      // Latest-wins: a steer during the (fast) IDB read must not land a stale result.
      if (signal?.aborted) return
      if (cached) {
        store.startRun(shortCode, canonicalUrl, conversationId)
        useSingleReelStore.getState().setResult(cached)
        return
      }

      store.startRun(shortCode, canonicalUrl, conversationId)

      try {
        const reel = await scrapeSingleReel(canonicalUrl, apifyKeys, signal)
        if (signal?.aborted) return

        useSingleReelStore.getState().setProgress('Transcribing & analysing…')
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
          if (signal?.aborted) return
          res = await post()
        }
        if (signal?.aborted) return
        if (!res.ok) {
          useSingleReelStore.getState().setError('Could not analyse that reel.')
          return
        }
        const json = (await res.json()) as { result: SingleReelResult }
        useSingleReelStore.getState().setResult(json.result)
        void setCachedSingleReel(shortCode, json.result)
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === 'AbortError') return
        useSingleReelStore.getState().setError('Could not analyse that reel.')
      }
    },
    [apifyKeys],
  )

  return { startSingleReel }
}
