/**
 * useCreatorScript — Script Studio "Choose a creator": handle + idea → an original script in
 * the creator's voice. Reuses buildVoiceProfile (cache-or-build) + REEL_REWRITE_SCHEMA/parser.
 */
import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useRepurposeReel } from './useRepurposeReel'
import { callGeminiWithSchema, PREMIUM_MODEL } from '../ai/gemini'
import { REEL_REWRITE_SCHEMA, parseReelRewrite, type ReelRewriteResult, type TargetLanguage } from '../ai/prompts/reelRewrite'
import { buildCreatorScriptPrompt } from '../ai/prompts/creatorScript'

export interface CreatorScriptArgs {
  handle: string
  idea: string
  language: TargetLanguage
}

export function useCreatorScript() {
  const { buildVoiceProfile } = useRepurposeReel()
  const { geminiKeys } = useKeysStore()

  const generate = useCallback(
    async (args: CreatorScriptArgs, signal?: AbortSignal): Promise<ReelRewriteResult> => {
      const handle = args.handle.replace(/^@/, '').trim()
      const voice = await buildVoiceProfile({ sourceReelUrl: '', clientHandle: handle }, signal)
      const raw = await callGeminiWithSchema<ReelRewriteResult>(
        geminiKeys,
        buildCreatorScriptPrompt(args.idea, voice, args.language),
        REEL_REWRITE_SCHEMA,
        { temperature: 0.8, thinkingBudget: 3000, model: PREMIUM_MODEL, signal },
      )
      return parseReelRewrite(raw)
    },
    [buildVoiceProfile, geminiKeys],
  )

  return { generate }
}
