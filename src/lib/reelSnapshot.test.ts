import { describe, it, expect } from 'vitest'
import { buildReelResultPayload } from './reelSnapshot'
import type { CreatorAnalysisState } from '../store/reelAnalysisStore'

const reel = (shortCode: string) => ({
  shortCode,
  url: `https://reel/${shortCode}`,
  displayUrl: 'https://thumb/expiring.jpg',
  videoViewCount: 1000,
  likesCount: 100,
  commentsCount: 10,
  videoDuration: 30,
  caption: 'cap',
  hashtags: [],
})

const state = (handle: string): CreatorAnalysisState =>
  ({
    handle,
    status: 'done',
    reels: [reel('r1')],
    analyses: { r1: { hookArchetype: 'Curiosity gap' } },
    deepStatus: { r1: 'done' },
    deepAnalyses: { r1: {} },
  }) as unknown as CreatorAnalysisState

describe('buildReelResultPayload', () => {
  it('snapshots only the run handles and trims thumbnails + deep maps', () => {
    const p = buildReelResultPayload({
      handles: ['alice'],
      creatorStates: { alice: state('alice'), bob: state('bob') }, // bob not in this run
      synthesis: null,
      deepReport: null,
    })
    expect(p.kind).toBe('reel')
    expect(Object.keys(p.creatorStates)).toEqual(['alice']) // only the run's handles
    expect(p.creatorStates.alice.reels[0].displayUrl).toBe('') // thumbnail trimmed
    expect(p.creatorStates.alice.deepStatus).toBeUndefined() // deep maps dropped
    expect(p.creatorStates.alice.deepAnalyses).toBeUndefined()
    expect(p.creatorStates.alice.analyses.r1.hookArchetype).toBe('Curiosity gap') // quick analysis kept
  })

  it('carries synthesis + deepReport through', () => {
    const synthesis = { topPatterns: [], benchmarks: { medianViews: 1, likesViewsRatio: 0, commentsLikesRatio: 0 }, replicateTips: [], avoidTips: [] }
    const p = buildReelResultPayload({ handles: ['a'], creatorStates: {}, synthesis, deepReport: null })
    expect(p.synthesis).toBe(synthesis)
    expect(p.deepReport).toBeNull()
  })
})
