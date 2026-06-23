/**
 * Tests for the corpus harvesters — pure functions that turn a finished pipeline result
 * (ranked entries + the profiles behind them) into the CreatorInput[] the corpus remembers.
 *
 * Kept pure + out of ChatPage so the join (result entry ↔ profile) and the sighting shape
 * are verified here, not inside a component effect.
 */

import { describe, it, expect } from 'vitest'
import { harvestCompetitors, harvestDiscovery, harvestReelContent } from './corpusHarvest'
import type { NormalizedProfile } from './transformers'
import type { CompetitorAnalysisResult, DiscoveryResult } from '../ai/prompts'
import type { CreatorAnalysisState } from '../store/reelAnalysisStore'

const prof = (username: string): NormalizedProfile => ({
  username,
  fullName: `${username} N`,
  biography: '',
  followersCount: 1000,
  followsCount: 10,
  postsCount: 5,
  profilePicUrl: '',
  verified: false,
  isBusinessAccount: false,
  avgLikes: 1,
  avgComments: 1,
  engagementRate: 5,
  relatedHandles: [],
  topHashtags: ['x'],
})

describe('harvestCompetitors', () => {
  it('builds a CreatorInput per competitor that has a matching profile', () => {
    const competitors: CompetitorAnalysisResult[] = [
      { username: 'alice', category: 'top', rank: 1, rationale: 'r1' },
      { username: 'bob', category: 'trending', rank: 2, rationale: 'r2' },
    ]
    const inputs = harvestCompetitors(competitors, [prof('alice'), prof('bob')], 'fitness', 1000)
    expect(inputs).toHaveLength(2)
    expect(inputs[0].profile.username).toBe('alice')
    expect(inputs[0].profile.topHashtags).toEqual(['x']) // untrimmed signal preserved
    expect(inputs[0].sighting).toMatchObject({
      at: 1000,
      pipeline: 'competitor',
      niche: 'fitness',
      category: 'top',
      rank: 1,
      rationale: 'r1',
    })
  })

  it('skips competitors with no matching profile', () => {
    const competitors: CompetitorAnalysisResult[] = [
      { username: 'alice', category: 'top', rank: 1, rationale: 'r1' },
      { username: 'ghost', category: 'top', rank: 2, rationale: 'r2' },
    ]
    const inputs = harvestCompetitors(competitors, [prof('alice')], 'fitness', 1000)
    expect(inputs.map((i) => i.profile.username)).toEqual(['alice'])
  })
})

describe('harvestDiscovery', () => {
  const dres = (username: string): DiscoveryResult => ({
    username,
    category: 'top',
    rank: 1,
    rationale: 'r',
    specialties: ['Street Food'],
    contentFocus: 'reels',
    partnershipReady: true,
    locationConfidence: 'confirmed',
  })

  it('builds a CreatorInput per result carrying discovery-specific signal', () => {
    const inputs = harvestDiscovery([dres('alice')], [prof('alice')], 'Pune', 'cafes', 2000)
    expect(inputs).toHaveLength(1)
    expect(inputs[0].sighting).toMatchObject({
      at: 2000,
      pipeline: 'discovery',
      city: 'Pune',
      niche: 'cafes',
      category: 'top',
      rank: 1,
      partnershipReady: true,
      locationConfidence: 'confirmed',
      contentFocus: 'reels',
    })
    expect(inputs[0].sighting.specialties).toEqual(['Street Food'])
  })

  it('skips results with no matching profile', () => {
    const inputs = harvestDiscovery([dres('ghost')], [prof('alice')], 'Pune', 'cafes', 2000)
    expect(inputs).toEqual([])
  })
})

describe('harvestReelContent', () => {
  const reel = (shortCode: string) => ({
    shortCode,
    url: `https://reel/${shortCode}`,
    displayUrl: '',
    videoViewCount: 1000,
    likesCount: 100,
    commentsCount: 10,
    videoDuration: 30,
    caption: 'cap',
    hashtags: [],
  })
  const states = (s: Record<string, unknown>) => s as unknown as Record<string, CreatorAnalysisState>

  it('produces a ContentRecord per reel of a finished creator, with hook from analysis', () => {
    const out = harvestReelContent(
      states({
        alice: {
          handle: 'alice',
          status: 'done',
          reels: [reel('r1'), reel('r2')],
          analyses: { r1: { hookArchetype: 'Curiosity gap', openingLine: 'wait for it' } },
        },
      }),
      5,
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      id: 'r1',
      creatorUsername: 'alice',
      kind: 'reel',
      hookArchetype: 'Curiosity gap',
      openingLine: 'wait for it',
      analyzedAt: 5,
    })
    expect(out[1]).toMatchObject({ id: 'r2', creatorUsername: 'alice' })
    expect(out[1].hookArchetype).toBeUndefined() // no analysis for r2
  })

  it('skips creators that are not done (still scraping / failed / no-reels)', () => {
    const out = harvestReelContent(
      states({ bob: { handle: 'bob', status: 'scraping', reels: [reel('r9')], analyses: {} } }),
      5,
    )
    expect(out).toEqual([])
  })

  it('carries the reel thumbnail (displayUrl) and the transcript from state.transcripts', () => {
    const out = harvestReelContent(
      states({
        alice: {
          handle: 'alice',
          status: 'done',
          reels: [{ ...reel('r1'), displayUrl: 'https://cdn/thumb.jpg' }],
          analyses: {},
          transcripts: { r1: 'hello world transcript' },
        },
      }),
      7,
    )
    expect(out[0]).toMatchObject({
      id: 'r1',
      thumbnailUrl: 'https://cdn/thumb.jpg',
      transcript: 'hello world transcript',
    })
  })

  it('falls back to the case-study transcript when state.transcripts has no entry (single-handle HookMap path)', () => {
    const out = harvestReelContent(
      states({
        alice: {
          handle: 'alice',
          status: 'done',
          reels: [{ ...reel('r1'), displayUrl: 'https://cdn/thumb.jpg' }],
          analyses: {},
          // No `transcripts` map — the HookMap path stores transcripts on caseStudies.
          caseStudies: { r1: { transcript: 'case study transcript', segments: [], videoAnalysis: {}, markdown: '# r1' } },
        },
      }),
      7,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 'r1',
      caption: 'cap',
      thumbnailUrl: 'https://cdn/thumb.jpg',
      videoViewCount: 1000,
      transcript: 'case study transcript',
    })
  })

  it('omits thumbnailUrl when displayUrl is empty and transcript when none captured', () => {
    const out = harvestReelContent(
      states({ alice: { handle: 'alice', status: 'done', reels: [reel('r1')], analyses: {} } }),
      7,
    )
    expect(out[0].thumbnailUrl).toBeUndefined()
    expect(out[0].transcript).toBeUndefined()
  })
})
