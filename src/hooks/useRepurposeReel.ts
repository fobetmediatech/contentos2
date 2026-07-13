/**
 * Repurpose Reel orchestration — the chat-triggered "rewrite a viral reel in a client's voice" path.
 *
 *   Stage 1  build/load the client VoiceProfile (cache → corpus → scrape+transcribe+synthesize)
 *   Stage 2  deep-analyze the SOURCE reel via /api/analyze-single-reel (cache-first)
 *   Stage 3  one Gemini rewrite call → full package + 3 hook variants
 *
 * Mirrors useSingleReelAnalysis/useReelAnalysis: keys from useKeysStore, the run's AbortSignal
 * is supplied by the agent loop (latest-wins), user-safe error strings only. Writes run state to
 * repurposeStore; ChatPage snapshots the finished result into the conversation.
 */

import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useConversationsStore } from '../store/conversationsStore'
import { useCorpusStore } from '../store/corpusStore'
import { useRepurposeStore } from '../store/repurposeStore'
import { scrapeTopReels, NoReelsError } from '../lib/reelScraper'
import { friendlyError } from '../lib/errorMessages'
import { transcribeReels } from '../lib/reelTranscriber'
import { scrapeSingleReel } from '../lib/singleReelClient'
import { getCachedSingleReel, setCachedSingleReel } from '../lib/singleReelCache'
import { getClerkSessionToken } from '../lib/clerkToken'
import { parseReelUrl } from '../lib/reelUrl'
import { callGeminiWithSchema, PREMIUM_MODEL } from '../ai/gemini'
import { devWarn } from '../lib/devLog'
import {
  buildVoiceProfilePrompt, parseVoiceProfile, VOICE_PROFILE_SCHEMA,
  type VoiceProfile, type VoiceProfileDraft,
} from '../ai/prompts/voiceProfile'
import {
  buildReelRewritePrompt, parseReelRewrite, REEL_REWRITE_SCHEMA,
  type ReelRewriteResult,
} from '../ai/prompts/reelRewrite'
import { prepareScriptCorpus, scriptsProfileKey, pickExemplars } from '../lib/repurposeHelpers'
import type { SingleReelResult } from '../store/singleReelStore'

const PROFILE_REEL_COUNT = 8

export interface RepurposeArgs {
  sourceReelUrl: string
  shortCode?: string
  clientHandle?: string
  pastedScripts?: string[]
  /** Skip the cached-profile reuse and re-scrape + re-synthesize (Memory "Rebuild"). */
  forceRebuild?: boolean
}

export function useRepurposeReel() {
  const { apifyKeys, geminiKeys } = useKeysStore()

  /** Deep-analyze ONE source reel → SingleReelResult (mirrors useSingleReelAnalysis body). */
  const analyzeSource = useCallback(
    async (sourceReelUrl: string, signal?: AbortSignal): Promise<SingleReelResult> => {
      const parsed = parseReelUrl(sourceReelUrl)
      if (!parsed) throw new Error("That doesn't look like an Instagram reel link.")
      const { shortCode, canonicalUrl } = parsed

      const cached = await getCachedSingleReel(shortCode)
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      if (cached) return cached

      const reel = await scrapeSingleReel(canonicalUrl, apifyKeys, signal)
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const reqBody = JSON.stringify({
        downloadedVideoUrl: reel.downloadedVideoUrl,
        shortCode: reel.shortCode,
        apify: {
          ownerUsername: reel.ownerUsername, caption: reel.caption, likesCount: reel.likesCount,
          commentsCount: reel.commentsCount, videoViewCount: reel.videoViewCount,
          videoDuration: reel.videoDuration, hashtags: reel.hashtags, timestamp: reel.timestamp,
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
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
        res = await post()
      }
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      if (!res.ok) {
        let detail = ''
        try { detail = await res.clone().text() } catch { /* ignore */ }
        devWarn('[repurpose] /api/analyze-single-reel failed', res.status, detail)
        throw new Error('Could not analyse the source reel.')
      }
      const json = (await res.json()) as { result: SingleReelResult }
      void setCachedSingleReel(shortCode, json.result)
      return json.result
    },
    [apifyKeys],
  )

  /** Build (or reuse) the client's voice profile. */
  const buildVoiceProfile = useCallback(
    async (args: RepurposeArgs, signal?: AbortSignal): Promise<VoiceProfile> => {
      const handle = args.clientHandle?.trim().toLowerCase()
      const scripts = (args.pastedScripts ?? []).filter((s) => s.trim().length > 0)

      // Reuse a saved profile when we have a handle and it's already in the corpus mirror —
      // unless this is an explicit Rebuild, which must always re-scrape + re-synthesize.
      if (handle && !args.forceRebuild) {
        const existing = useCorpusStore.getState().voiceProfiles[handle]
        if (existing) return existing
      }

      // Pasted-scripts path: no scrape; key by a stable synthetic id (renameable in Memory).
      if (!handle && scripts.length > 0) {
        const key = scriptsProfileKey(scripts)
        const existing = useCorpusStore.getState().voiceProfiles[key]
        if (existing) return existing
        const draft = await callGeminiWithSchema<VoiceProfileDraft>(
          geminiKeys,
          buildVoiceProfilePrompt(key.replace('__scripts__', 'pasted-'), [prepareScriptCorpus(scripts)], []),
          VOICE_PROFILE_SCHEMA,
          { temperature: 0.2, thinkingBudget: 2000, signal },
        )
        const profile = parseVoiceProfile(draft, {
          handle: key, displayName: 'Pasted voice', reelCount: 0, builtAt: Date.now(), fromScripts: true,
          exemplars: pickExemplars(scripts),
        })
        await useCorpusStore.getState().setVoiceProfile(key, profile)
        return profile
      }

      if (!handle) throw new Error('Tell me which client to repurpose this for (an @handle or a few of their scripts).')

      // Handle path: scrape + transcribe + synthesize.
      let reels
      try {
        reels = await scrapeTopReels(handle, PROFILE_REEL_COUNT, apifyKeys, signal)
      } catch (err) {
        if (err instanceof NoReelsError) {
          if (scripts.length > 0) {
            const draft = await callGeminiWithSchema<VoiceProfileDraft>(
              geminiKeys, buildVoiceProfilePrompt(handle, [prepareScriptCorpus(scripts)], []),
              VOICE_PROFILE_SCHEMA, { temperature: 0.2, thinkingBudget: 2000, signal },
            )
            const profile = parseVoiceProfile(draft, {
              handle, displayName: `@${handle}`, reelCount: 0, builtAt: Date.now(), fromScripts: true,
              exemplars: pickExemplars(scripts),
            })
            await useCorpusStore.getState().setVoiceProfile(handle, profile)
            return profile
          }
          throw new Error(`@${handle} has no public reels — paste 2-3 of their scripts instead.`, { cause: err })
        }
        throw err
      }
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

      const transcriptMap = await transcribeReels(handle, reels, apifyKeys, signal)
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const transcripts = reels.map((r) => transcriptMap[r.shortCode]).filter((t): t is string => !!t)
      const captions = reels.map((r) => r.caption).filter((c) => !!c)

      const draft = await callGeminiWithSchema<VoiceProfileDraft>(
        geminiKeys, buildVoiceProfilePrompt(handle, transcripts, captions),
        VOICE_PROFILE_SCHEMA, { temperature: 0.2, thinkingBudget: 2000, signal },
      )
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const profile = parseVoiceProfile(draft, {
        handle, displayName: `@${handle}`, reelCount: reels.length, builtAt: Date.now(), fromScripts: false,
        exemplars: pickExemplars(transcripts),
      })
      // Preserve a user's explicit language override across a Rebuild — it's a preference, not a
      // derived field, so re-synthesis shouldn't silently reset it to 'auto'.
      const priorLang = useCorpusStore.getState().voiceProfiles[handle]?.outputLanguage
      if (priorLang) profile.outputLanguage = priorLang
      await useCorpusStore.getState().setVoiceProfile(handle, profile)
      return profile
    },
    [apifyKeys, geminiKeys],
  )

  const startRepurpose = useCallback(
    async (args: RepurposeArgs, signal?: AbortSignal) => {
      const store = useRepurposeStore.getState()
      const conversationId = useConversationsStore.getState().activeId
      const clientKey = args.clientHandle?.trim().toLowerCase()
        || (args.pastedScripts?.length ? scriptsProfileKey(args.pastedScripts) : '')
      store.start(conversationId, args.sourceReelUrl, clientKey)

      try {
        // Stage 1
        const profile = await buildVoiceProfile(args, signal)
        if (signal?.aborted) return
        useRepurposeStore.getState().setVoiceProfile(profile)
        useRepurposeStore.getState().setStatus('analyzing-source')

        // Stage 2
        const source = await analyzeSource(args.sourceReelUrl, signal)
        if (signal?.aborted) return
        useRepurposeStore.getState().setSourceTranscript(source.transcript)
        useRepurposeStore.getState().setStatus('rewriting')

        // Stage 3 — premium model (the rewrite is the creative-quality call; joins the split).
        const raw = await callGeminiWithSchema<ReelRewriteResult>(
          geminiKeys, buildReelRewritePrompt(source, profile),
          REEL_REWRITE_SCHEMA, { temperature: 0.7, thinkingBudget: 3000, signal, model: PREMIUM_MODEL },
        )
        if (signal?.aborted) return
        useRepurposeStore.getState().setRewrite(parseReelRewrite(raw))
        useRepurposeStore.getState().setStatus('done')
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === 'AbortError') return
        devWarn('[repurpose] run failed', err)
        useRepurposeStore.getState().setError(friendlyError(err, 'Could not repurpose this reel.'))
      }
    },
    [analyzeSource, buildVoiceProfile, geminiKeys],
  )

  /**
   * Rebuild a saved client's voice profile in place (Memory "Voices" tab): force a fresh
   * scrape + synthesis, bypassing the cache, and overwrite the saved profile. Resolves to the
   * new profile; rejects on failure so the caller can surface it. Only valid for handle-based
   * profiles (pasted-script profiles have no reels to re-scrape).
   */
  const rebuildVoiceProfile = useCallback(
    (handle: string, signal?: AbortSignal): Promise<VoiceProfile> =>
      buildVoiceProfile({ sourceReelUrl: '', clientHandle: handle, forceRebuild: true }, signal),
    [buildVoiceProfile],
  )

  // analyzeSource + buildVoiceProfile are also consumed by Script Studio (useReelRemix).
  return { startRepurpose, rebuildVoiceProfile, analyzeSource, buildVoiceProfile }
}
