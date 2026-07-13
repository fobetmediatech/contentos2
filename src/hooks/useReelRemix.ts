/**
 * Script Studio orchestration — the two explicit steps behind the dedicated page:
 *   transcribe()  URL → transcript (IG deep-analysis via useRepurposeReel.analyzeSource;
 *                 YouTube via fetchYoutubeTranscript). Returns the (editable) transcript +
 *                 the structural source for the generate step.
 *   generate()    (edited transcript, new topic, language, optional voice) → ReelRewriteResult.
 *
 * Reuses the shipped repurpose primitives (analyzeSource, buildVoiceProfile) and the shared
 * rewrite schema/parser — the remix prompt is the only new LLM logic.
 */
import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useRepurposeReel } from './useRepurposeReel'
import { detectSourcePlatform, type SourcePlatform } from '../lib/sourceUrl'
import { fetchYoutubeTranscript } from '../lib/youtubeTranscript'
import { callGeminiWithSchema, PREMIUM_MODEL } from '../ai/gemini'
import {
  REEL_REWRITE_SCHEMA, parseReelRewrite,
  type ReelRewriteResult, type TargetLanguage,
} from '../ai/prompts/reelRewrite'
import { buildReelRemixPrompt, type RemixSource } from '../ai/prompts/reelRemix'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'

export interface TranscribeResult {
  platform: SourcePlatform
  source: RemixSource
  transcript: string
}

export interface GenerateArgs {
  source: RemixSource
  editedTranscript: string
  newTopic: string
  language: TargetLanguage
  clientHandle?: string
  pastedScripts?: string[]
}

export function useReelRemix() {
  const { analyzeSource, buildVoiceProfile } = useRepurposeReel()
  const { apifyKeys, geminiKeys } = useKeysStore()

  const transcribe = useCallback(
    async (url: string, signal?: AbortSignal): Promise<TranscribeResult> => {
      const platform = detectSourcePlatform(url)
      if (platform === 'instagram') {
        const result = await analyzeSource(url, signal)
        return {
          platform,
          source: { transcript: result.transcript, beats: result.videoAnalysis?.visual_beats },
          transcript: result.transcript,
        }
      }
      if (platform === 'youtube') {
        const transcript = await fetchYoutubeTranscript(url, apifyKeys, signal)
        return { platform, source: { transcript }, transcript }
      }
      throw new Error('Paste an Instagram Reel or a YouTube Short link.')
    },
    [analyzeSource, apifyKeys],
  )

  const generate = useCallback(
    async (args: GenerateArgs, signal?: AbortSignal): Promise<ReelRewriteResult> => {
      const handle = args.clientHandle?.trim()
      const scripts = (args.pastedScripts ?? []).filter((s) => s.trim().length > 0)

      let voice: VoiceProfile | undefined
      if (handle || scripts.length > 0) {
        voice = await buildVoiceProfile({ sourceReelUrl: '', clientHandle: handle, pastedScripts: scripts }, signal)
      }

      const source: RemixSource = { transcript: args.editedTranscript, beats: args.source.beats }
      const raw = await callGeminiWithSchema<ReelRewriteResult>(
        geminiKeys,
        buildReelRemixPrompt(source, args.newTopic, args.language, voice),
        REEL_REWRITE_SCHEMA,
        { temperature: 0.7, thinkingBudget: 3000, model: PREMIUM_MODEL, signal },
      )
      return parseReelRewrite(raw)
    },
    [buildVoiceProfile, geminiKeys],
  )

  return { transcribe, generate }
}
