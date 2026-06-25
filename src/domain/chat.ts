/**
 * Domain types for the chat transcript and pipeline result payloads.
 *
 * These types are conversation-level (one ChatMessage per turn; ResultPayload holds
 * the snapshotted output of a finished pipeline run). Kept out of the store files so
 * components, hooks, and libraries can import types without pulling in store logic.
 *
 * Re-exported from analysisStore for backward compatibility.
 */

import type { NormalizedProfile } from '../lib/transformers'
import type { CompetitorAnalysisResult, DiscoveryResult } from '../ai/prompts'
import type { CreatorAnalysisState, SynthesisOutput } from '../store/reelAnalysisStore'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

export type CompetitorResultPayload = {
  kind: 'competitor'
  competitors: CompetitorAnalysisResult[]
  summary: string
  niche: string
  profiles: NormalizedProfile[]
  didExpand: boolean
  /** Input reference handles — lets "Start over" re-run the same search (optional: absent on legacy payloads). */
  handles?: string[]
  /** Niche context, reused on re-run. */
  nicheContext?: string
  /** First run's clarification answer, reused silently on "Start over" re-runs (no card re-shown). */
  clarificationAnswer?: string
}

export type DiscoveryResultPayload = {
  kind: 'discovery'
  results: DiscoveryResult[]
  city: string
  profiles: NormalizedProfile[]
  didExpand: boolean
  locationRelaxed: boolean
}

/**
 * A finished reel/hook run, snapshotted into the conversation it ran in.
 * `creatorStates` is trimmed (reel thumbnails dropped); the bounded HookMap case-study
 * text is kept.
 */
export type ReelResultPayload = {
  kind: 'reel'
  handles: string[]
  creatorStates: Record<string, CreatorAnalysisState>
  synthesis: SynthesisOutput | null
}

export type RepurposeResultPayload = {
  kind: 'repurpose'
  sourceReelUrl: string
  clientHandle: string
  voiceProfile: VoiceProfile
  rewrite: ReelRewriteResult
}

export type ResultPayload =
  | CompetitorResultPayload
  | DiscoveryResultPayload
  | ReelResultPayload
  | RepurposeResultPayload

export interface ChatMessage {
  /** Stable unique id for React keys — monotonic, assigned by addMessage. */
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /**
   * Controls rendering: text = plain bubble, options = pill choices, error = red bubble,
   * result = inline result cards, reel = position marker for the (live) reel-analysis block,
   * single-reel = position marker for the (live) single-reel case-study block.
   */
  type?: 'text' | 'options' | 'error' | 'result' | 'reel' | 'single-reel' | 'repurpose' | 'transcript'
  /** Present when type === 'options' */
  options?: string[]
  /** Present when type === 'result' — the snapshotted pipeline result rendered inline. */
  result?: ResultPayload
}
