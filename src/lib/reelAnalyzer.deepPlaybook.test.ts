/**
 * Tests for buildDeepPlaybook (Phase 2) — per-creator aggregation over DeepReelAnalysis.
 */

import { describe, it, expect } from 'vitest'
import { buildDeepPlaybook } from './reelAnalyzer'
import type { StoredDeepReelAnalysis, ReelData } from '../store/reelAnalysisStore'

const reel = (shortCode: string, views: number): ReelData => ({
  shortCode,
  url: '',
  displayUrl: '',
  videoViewCount: views,
  likesCount: 1,
  commentsCount: 1,
  videoDuration: 1,
  caption: '',
  hashtags: [],
})

const analysis = (over: Partial<StoredDeepReelAnalysis>): StoredDeepReelAnalysis => ({
  hookArchetype: 'Curiosity gap',
  spokenHookVerbatim: '',
  onScreenTextHook: '',
  visualOpening: 'v',
  hookBreakdown: '',
  pacingEditing: '',
  audioStrategy: '',
  retentionMechanism: '',
  psychologyTrigger: '',
  ctaType: 'none',
  ctaPlacement: 'none',
  replicationTemplate: 'T',
  whatToReplicate: '',
  whatToAvoid: '',
  hookScore: 5,
  commentsLikesRatio: 0,
  ...over,
})

describe('buildDeepPlaybook', () => {
  it('computes distribution, dominant/secondary, avg score, consistency, median views', () => {
    const deep = {
      a: analysis({ hookArchetype: 'Curiosity gap', hookScore: 6 }),
      b: analysis({ hookArchetype: 'Curiosity gap', hookScore: 8 }),
      c: analysis({ hookArchetype: 'Visual shock', hookScore: 4 }),
    }
    const reels = [reel('a', 100), reel('b', 300), reel('c', 200)]
    const p = buildDeepPlaybook('nike', deep, reels)

    expect(p.reelCount).toBe(3)
    expect(p.dominantArchetype).toBe('Curiosity gap')
    expect(p.secondaryArchetype).toBe('Visual shock')
    expect(p.archetypeDistribution[0]).toEqual({ archetype: 'Curiosity gap', count: 2 })
    expect(p.avgHookScore).toBeCloseTo((6 + 8 + 4) / 3)
    expect(p.consistencyScore).toBeCloseTo(2 / 3)
    expect(p.medianViews).toBe(200)
  })

  it('picks the top exemplar by hookScore (views as tiebreak) + its template as signature', () => {
    const deep = {
      a: analysis({ hookScore: 9, replicationTemplate: 'WIN', spokenHookVerbatim: 'hi' }),
      b: analysis({ hookScore: 9, replicationTemplate: 'LOSE' }), // score tie -> views decide
    }
    const reels = [reel('a', 500), reel('b', 100)]
    const p = buildDeepPlaybook('nike', deep, reels)

    expect(p.topExemplar?.shortCode).toBe('a')
    expect(p.topExemplar?.views).toBe(500)
    expect(p.signatureTemplate).toBe('WIN')
  })

  it('handles an empty deep set without throwing', () => {
    const p = buildDeepPlaybook('nike', {}, [])
    expect(p.reelCount).toBe(0)
    expect(p.dominantArchetype).toBe('')
    expect(p.secondaryArchetype).toBeUndefined()
    expect(p.topExemplar).toBeNull()
    expect(p.avgHookScore).toBe(0)
    expect(p.consistencyScore).toBe(0)
    expect(p.signatureTemplate).toBe('')
  })
})
