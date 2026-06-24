/**
 * buildReelResultPayload — snapshot a finished reel run into a persistable ReelResultPayload
 * (reel parity). Keeps only the creators in this run and trims the heavy/volatile reel
 * thumbnails (`displayUrl`, expiring CDN URLs). The HookMap case-study text
 * (`caseStudies`/`caseStudyStatus`/`hookSummary`) is bounded and kept as-is. Pure + unit-tested.
 */

import type { ReelResultPayload } from '../store/analysisStore'
import type { CreatorAnalysisState, SynthesisOutput } from '../store/reelAnalysisStore'

export function buildReelResultPayload(input: {
  handles: string[]
  creatorStates: Record<string, CreatorAnalysisState>
  synthesis: SynthesisOutput | null
}): ReelResultPayload {
  const creatorStates: Record<string, CreatorAnalysisState> = {}
  for (const [handle, state] of Object.entries(input.creatorStates)) {
    if (!input.handles.includes(handle)) continue // only the creators in this run
    creatorStates[handle] = {
      ...state,
      reels: state.reels.map((r) => ({ ...r, displayUrl: '', musicInfo: undefined })),
    }
  }
  return {
    kind: 'reel',
    handles: input.handles,
    creatorStates,
    synthesis: input.synthesis,
  }
}
