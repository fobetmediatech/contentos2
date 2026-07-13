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
import { getCachedSingleReel } from '../lib/singleReelCache'
import type { SingleReelResult } from '../domain/reel'
import { buildReelRemixPrompt, buildFieldRegenPrompt, VARIATION_ANGLES, FIELD_REGEN_SCHEMA, type RemixSource } from '../ai/prompts/reelRemix'
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
  /** Pre-resolved voice — set by generateVariations so all 3 share one build. */
  voice?: VoiceProfile
  /** One of VARIATION_ANGLES — biases the hook so variations diverge. */
  variationAngle?: string
}

export interface VariationsOpts {
  count?: number
  onResult?: (i: number, r: ReelRewriteResult) => void
  onError?: (i: number) => void
}

export interface RegenerateArgs {
  current: ReelRewriteResult
  source: RemixSource
  fieldLabel: string
  newTopic: string
  language: TargetLanguage
  voice?: VoiceProfile
}

/** Pure: seed a remix reference from a corpus reel + its (maybe-absent) cached deep analysis. */
export function buildLibrarySource(
  reel: { shortCode: string; transcript: string },
  cached: SingleReelResult | undefined,
): TranscribeResult {
  return {
    platform: 'instagram',
    source: { transcript: reel.transcript, beats: cached?.videoAnalysis?.visual_beats },
    transcript: reel.transcript,
  }
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

      const voice = args.voice
        ?? ((handle || scripts.length > 0)
          ? await buildVoiceProfile({ sourceReelUrl: '', clientHandle: handle, pastedScripts: scripts }, signal)
          : undefined)

      const source: RemixSource = { transcript: args.editedTranscript, beats: args.source.beats }
      const raw = await callGeminiWithSchema<ReelRewriteResult>(
        geminiKeys,
        buildReelRemixPrompt(source, args.newTopic, args.language, voice, args.variationAngle),
        REEL_REWRITE_SCHEMA,
        { temperature: 0.7, thinkingBudget: 3000, model: PREMIUM_MODEL, signal },
      )
      return parseReelRewrite(raw)
    },
    [buildVoiceProfile, geminiKeys],
  )

  const fromLibrary = useCallback(
    async (reel: { shortCode: string; transcript: string }): Promise<TranscribeResult> => {
      const cached = await getCachedSingleReel(reel.shortCode)
      return buildLibrarySource(reel, cached)
    },
    [],
  )

  const generateVariations = useCallback(
    async (
      args: GenerateArgs,
      opts?: VariationsOpts,
      signal?: AbortSignal,
    ): Promise<{ results: (ReelRewriteResult | null)[]; voice?: VoiceProfile }> => {
      const count = opts?.count ?? 3
      const handle = args.clientHandle?.trim()
      const scripts = (args.pastedScripts ?? []).filter((s) => s.trim().length > 0)
      // Resolve voice ONCE — otherwise a fresh @handle would scrape+synthesize `count` times.
      const voice = args.voice
        ?? ((handle || scripts.length > 0)
          ? await buildVoiceProfile({ sourceReelUrl: '', clientHandle: handle, pastedScripts: scripts }, signal)
          : undefined)

      const results: (ReelRewriteResult | null)[] = new Array(count).fill(null)
      for (let i = 0; i < count; i++) {
        if (signal?.aborted) break
        try {
          const r = await generate({ ...args, voice, variationAngle: VARIATION_ANGLES[i % VARIATION_ANGLES.length] }, signal)
          results[i] = r
          opts?.onResult?.(i, r)
        } catch (err) {
          if (signal?.aborted || (err as Error)?.name === 'AbortError') break
          opts?.onError?.(i)
        }
      }
      return { results, voice }
    },
    [generate, buildVoiceProfile],
  )

  const regenerateField = useCallback(
    async (args: RegenerateArgs, signal?: AbortSignal): Promise<string> => {
      const raw = await callGeminiWithSchema<{ value: string }>(
        geminiKeys,
        buildFieldRegenPrompt(args.current, args.source, args.fieldLabel, args.newTopic, args.language, args.voice),
        FIELD_REGEN_SCHEMA,
        { temperature: 0.85, thinkingBudget: 1000, model: PREMIUM_MODEL, signal },
      )
      return typeof raw?.value === 'string' ? raw.value : ''
    },
    [geminiKeys],
  )

  return { transcribe, generate, fromLibrary, generateVariations, regenerateField }
}
