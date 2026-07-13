/**
 * Tests for the Google export payload builders (buildCompetitorSheet, buildDiscoverySheet,
 * buildReelDoc). Pure functions — assert column/row shape, sort order, and the Sheets
 * formula-injection guard.
 */

import { describe, it, expect } from 'vitest'
import { buildCompetitorSheet, buildDiscoverySheet, buildReelDoc, buildRepurposeDoc } from './export'
import type { CompetitorAnalysisResult, DiscoveryResult } from '../../ai/prompts'
import type { NormalizedProfile } from '../../lib/transformers'
import type { ReelResultPayload, RepurposeResultPayload } from '../../domain/chat'

function profile(over: Partial<NormalizedProfile>): NormalizedProfile {
  return {
    username: 'u', fullName: '', followersCount: 0, followsCount: 0, postsCount: 0,
    verified: false, isPrivate: false, biography: '', engagementRate: 0,
    ...over,
  } as NormalizedProfile
}

describe('buildCompetitorSheet', () => {
  const competitors: CompetitorAnalysisResult[] = [
    { username: 'trend1', category: 'trending', rank: 1, rationale: 'up and coming' },
    { username: 'top1', category: 'top', rank: 1, rationale: 'strong ER' },
  ]
  const profiles = [
    profile({ username: 'top1', fullName: 'Top One', followersCount: 12000, engagementRate: 4.2, verified: true }),
    profile({ username: 'trend1', fullName: 'Trend One', followersCount: 800 }),
  ]

  it('emits a sheet payload with headers and top-before-trending rows', () => {
    const p = buildCompetitorSheet({ competitors, profiles, sourceHandles: ['ref'] })
    expect(p.kind).toBe('sheet')
    if (p.kind !== 'sheet') return
    expect(p.headers[0]).toBe('rank')
    expect(p.headers).toContain('username')
    // top category sorts first
    expect(p.rows[0][2]).toBe('top1')
    expect(p.rows[1][2]).toBe('trend1')
    // followers + verified mapped
    expect(p.rows[0]).toContain(12000)
    expect(p.rows[0]).toContain('yes')
  })
})

describe('buildDiscoverySheet', () => {
  const results: DiscoveryResult[] = [
    { username: 'creator1', category: 'top', rank: 1, rationale: 'local + active', specialties: ['food', 'travel'], contentFocus: 'reels', partnershipReady: true, locationConfidence: 'confirmed' },
  ]
  const profiles = [profile({ username: 'creator1', followersCount: 5000, engagementRate: 3.1 })]

  it('joins specialties and maps partnership/location fields', () => {
    const p = buildDiscoverySheet({ results, profiles, city: 'KL', niche: 'food', sourceHashtags: ['klfood'] })
    expect(p.kind).toBe('sheet')
    if (p.kind !== 'sheet') return
    const row = p.rows[0]
    expect(row).toContain('food | travel')
    expect(row).toContain('yes') // partnership_ready
    expect(row).toContain('confirmed')
    expect(p.title).toContain('KL')
  })
})

describe('sheet formula-injection guard', () => {
  it("prefixes a rationale that starts with = so Sheets treats it as text", () => {
    const competitors: CompetitorAnalysisResult[] = [
      { username: 'x', category: 'top', rank: 1, rationale: '=SUM(A1:A9)' },
    ]
    const p = buildCompetitorSheet({ competitors, profiles: [profile({ username: 'x' })], sourceHandles: [] })
    if (p.kind !== 'sheet') throw new Error('expected sheet')
    const rationale = p.rows[0].find((c) => typeof c === 'string' && c.includes('SUM'))
    expect(rationale).toBe("'=SUM(A1:A9)")
  })

  it("prefixes a scraped username that starts with @ or -", () => {
    const competitors: CompetitorAnalysisResult[] = [
      { username: '-evil', category: 'top', rank: 1, rationale: 'ok' },
    ]
    const p = buildCompetitorSheet({ competitors, profiles: [profile({ username: '-evil' })], sourceHandles: [] })
    if (p.kind !== 'sheet') throw new Error('expected sheet')
    expect(p.rows[0][2]).toBe("'-evil")
  })
})

describe('buildReelDoc', () => {
  const payload: ReelResultPayload = {
    type: 'result',
    kind: 'reel',
    handles: ['chef'],
    creatorStates: {
      chef: {
        handle: 'chef',
        status: 'done',
        reels: [],
        analyses: {},
        hookSummary: {
          handle: 'chef',
          reelCount: 8,
          dominantHooks: [{ pattern: 'question hook', count: 3, example: 'Ever wonder…' }],
          recurringOpenings: ['POV:'],
          whatConsistentlyWorks: ['fast cuts'],
          replicableTemplates: ['3-step recipe'],
          narrative: 'Consistent question-led openings.',
          benchmarks: { medianViews: 50000, medianLikes: 4000, commentsLikesRatio: 0.05 },
        },
      },
    },
    synthesis: {
      topPatterns: [{ archetype: 'question', count: 5, example: 'Ever wonder…' }],
      benchmarks: { medianViews: 42000, likesViewsRatio: 0.08, commentsLikesRatio: 0.04 },
      replicateTips: ['Open with a question'],
      avoidTips: ['No slow intros'],
    },
  } as ReelResultPayload

  it('produces a doc with synthesis + per-creator sections', () => {
    const p = buildReelDoc(payload)
    expect(p.kind).toBe('doc')
    if (p.kind !== 'doc') return
    expect(p.title).toContain('@chef')
    expect(p.markdown).toContain('Cross-creator synthesis')
    expect(p.markdown).toContain('question')
    expect(p.markdown).toContain('@chef — Reel Hook Report')
    expect(p.markdown).toContain('Open with a question')
  })
})

describe('buildRepurposeDoc', () => {
  const payload = {
    type: 'result',
    kind: 'repurpose',
    voiceProfile: {
      handle: 'coach', displayName: 'Coach', fromScripts: false, reelCount: 12,
      toneDescriptors: ['punchy', 'warm'], personaConsistencyScore: 8,
    },
    rewrite: {
      spokenHook: 'Stop doing this.',
      beatScript: [{ beatLabel: 'Hook', script: 'Line one', onScreenText: 'BIG TEXT' }],
      caption: 'A caption',
      cta: 'Follow for more',
      onScreenText: ['overlay a'],
      altHooks: ['Alt one', 'Alt two'],
    },
    sourceTranscript: 'original words',
  } as unknown as RepurposeResultPayload

  it('produces a doc covering hook, alt hooks, beats, caption, CTA and source', () => {
    const p = buildRepurposeDoc(payload)
    expect(p.kind).toBe('doc')
    if (p.kind !== 'doc') return
    expect(p.title).toContain('@coach')
    expect(p.markdown).toContain('Stop doing this.')
    expect(p.markdown).toContain('Alt one')
    expect(p.markdown).toContain('BIG TEXT')
    expect(p.markdown).toContain('Follow for more')
    expect(p.markdown).toContain('original words')
  })
})
