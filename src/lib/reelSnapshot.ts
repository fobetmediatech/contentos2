/**
 * buildReelResultPayload — snapshot a finished reel run into a persistable ReelResultPayload
 * (Phase 2 reel parity). Keeps only the creators in this run and trims heavy/volatile fields:
 * reel thumbnails (`displayUrl`, expiring CDN URLs) and the deep per-reel maps (the deep report
 * summary is kept; the per-reel deep analyses re-run on demand). Pure + unit-tested.
 */

import type { ReelResultPayload } from '../store/analysisStore'
import type { CreatorAnalysisState, SynthesisOutput } from '../store/reelAnalysisStore'
import type { DeepNicheReport } from '../ai/prompts/deepReelAnalysis'

export function buildReelResultPayload(input: {
  handles: string[]
  creatorStates: Record<string, CreatorAnalysisState>
  synthesis: SynthesisOutput | null
  deepReport: DeepNicheReport | null
}): ReelResultPayload {
  const creatorStates: Record<string, CreatorAnalysisState> = {}
  for (const [handle, state] of Object.entries(input.creatorStates)) {
    if (!input.handles.includes(handle)) continue // only the creators in this run
    creatorStates[handle] = {
      ...state,
      reels: state.reels.map((r) => ({ ...r, displayUrl: '', musicInfo: undefined })),
      deepStatus: undefined,
      deepAnalyses: undefined,
    }
  }
  return {
    kind: 'reel',
    handles: input.handles,
    creatorStates,
    synthesis: input.synthesis,
    deepReport: input.deepReport,
  }
}
