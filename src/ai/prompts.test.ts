/**
 * Tests for buildCompetitorPrompt — source-tagging labels.
 *
 * Verifies that candidateSummary correctly labels each candidate based on
 * its discoverySource field so Gemini can apply SOURCE PRIORITY logic.
 *
 * Also tests buildCompetitorPrompt with clarificationAnswer (USER REFINEMENT injection)
 * and buildClarificationPrompt (candidate list formatting + niche context inclusion).
 */

import { describe, it, expect } from 'vitest'
import { buildCompetitorPrompt, buildClarificationPrompt } from './prompts'
import type { NormalizedProfile } from '../lib/transformers'

function makeProfile(overrides: Partial<NormalizedProfile> = {}): NormalizedProfile {
  return {
    username: 'testuser',
    fullName: 'Test User',
    biography: 'Startup tips and entrepreneurship',
    followersCount: 50_000,
    followsCount: 500,
    postsCount: 120,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 800,
    avgComments: 30,
    engagementRate: 1.7,
    relatedHandles: [],
    topHashtags: ['entrepreneur', 'startup', 'business'],
    ...overrides,
  }
}

const inputProfile = makeProfile({ username: 'refaccount', biography: 'Reference account' })

describe('buildCompetitorPrompt — source labels in candidateSummary', () => {
  it('labels hashtag-sourced candidates as [CONTENT-NICHE]', () => {
    const candidate = makeProfile({ username: 'nicheguy', discoverySource: 'hashtag' })
    const prompt = buildCompetitorPrompt([inputProfile], [candidate])
    expect(prompt).toContain('[CONTENT-NICHE: posted with reference account hashtags]')
    expect(prompt).toContain('@nicheguy')
  })

  it('labels relatedProfiles candidates as [AUDIENCE-ADJACENT]', () => {
    const candidate = makeProfile({ username: 'overlapguy', discoverySource: 'relatedProfiles' })
    const prompt = buildCompetitorPrompt([inputProfile], [candidate])
    // Scope to the candidate line — SOURCE PRIORITY rule in SELECTION CRITERIA also
    // mentions [CONTENT-NICHE] / [AUDIENCE-ADJACENT], so a full-prompt toContain check
    // would give false positives / false negatives.
    const candidateLine = prompt.split('\n').find((l) => l.includes('@overlapguy')) ?? ''
    expect(candidateLine).toContain('[AUDIENCE-ADJACENT: relatedProfiles]')
    expect(candidateLine).not.toContain('[CONTENT-NICHE')
  })

  it('labels round3 candidates as [AUDIENCE-ADJACENT: 2-hop relatedProfiles]', () => {
    const candidate = makeProfile({ username: 'deepoverlap', discoverySource: 'round3' })
    const prompt = buildCompetitorPrompt([inputProfile], [candidate])
    expect(prompt).toContain('[AUDIENCE-ADJACENT: 2-hop relatedProfiles]')
  })

  it('emits no source label for candidates with undefined discoverySource (safe fallback)', () => {
    const candidate = makeProfile({ username: 'unlabeled', discoverySource: undefined })
    const prompt = buildCompetitorPrompt([inputProfile], [candidate])
    // Should not contain any label bracket for this candidate
    const candidateLine = prompt
      .split('\n')
      .find((line) => line.includes('@unlabeled'))
    expect(candidateLine).toBeDefined()
    expect(candidateLine).not.toContain('[CONTENT-NICHE')
    expect(candidateLine).not.toContain('[AUDIENCE-ADJACENT')
  })

  it('places the source label after the established label when both apply', () => {
    const bigCandidate = makeProfile({
      username: 'bigcreator',
      followersCount: 600_000,
      discoverySource: 'hashtag',
    })
    const prompt = buildCompetitorPrompt([inputProfile], [bigCandidate])
    const line = prompt.split('\n').find((l) => l.includes('@bigcreator')) ?? ''
    const establishedPos = line.indexOf('[ESTABLISHED')
    const sourcePos = line.indexOf('[CONTENT-NICHE')
    expect(establishedPos).toBeGreaterThan(-1)
    expect(sourcePos).toBeGreaterThan(-1)
    // Established label comes before source label
    expect(establishedPos).toBeLessThan(sourcePos)
  })

  it('includes SOURCE PRIORITY rule in SELECTION CRITERIA', () => {
    const prompt = buildCompetitorPrompt([inputProfile], [makeProfile()])
    expect(prompt).toContain('SOURCE PRIORITY')
    expect(prompt).toContain('[CONTENT-NICHE]')
    expect(prompt).toContain('[AUDIENCE-ADJACENT]')
  })

  it('correctly labels multiple candidates with mixed sources', () => {
    const candidates = [
      makeProfile({ username: 'nicheA', discoverySource: 'hashtag' }),
      makeProfile({ username: 'adjacentB', discoverySource: 'relatedProfiles' }),
      makeProfile({ username: 'deepC', discoverySource: 'round3' }),
    ]
    const prompt = buildCompetitorPrompt([inputProfile], candidates)
    // Scope counts to candidate lines only — the SELECTION CRITERIA section also
    // references these label strings, so a full-prompt count would overcount.
    const candidateLines = prompt
      .split('\n')
      .filter((l) => /^@(nicheA|adjacentB|deepC)\b/.test(l))
      .join('\n')
    const contentNicheCount = (candidateLines.match(/\[CONTENT-NICHE/g) ?? []).length
    const relatedCount = (candidateLines.match(/\[AUDIENCE-ADJACENT: relatedProfiles\]/g) ?? []).length
    const round3Count = (candidateLines.match(/\[AUDIENCE-ADJACENT: 2-hop relatedProfiles\]/g) ?? []).length
    expect(contentNicheCount).toBe(1)
    expect(relatedCount).toBe(1)
    expect(round3Count).toBe(1)
  })
})

describe('buildCompetitorPrompt — clarificationAnswer injection', () => {
  it('injects USER REFINEMENT block when clarificationAnswer is non-empty', () => {
    const prompt = buildCompetitorPrompt(
      [inputProfile],
      [makeProfile()],
      undefined,
      'Online transformation coaches, not gym equipment brands',
    )
    expect(prompt).toContain('USER REFINEMENT')
    expect(prompt).toContain('Online transformation coaches, not gym equipment brands')
    expect(prompt).toContain('Prioritize candidates that match this direction')
  })

  it('does not inject USER REFINEMENT block when clarificationAnswer is empty string', () => {
    const prompt = buildCompetitorPrompt(
      [inputProfile],
      [makeProfile()],
      undefined,
      '',
    )
    expect(prompt).not.toContain('USER REFINEMENT')
  })

  it('does not inject USER REFINEMENT block when clarificationAnswer is undefined', () => {
    const prompt = buildCompetitorPrompt([inputProfile], [makeProfile()])
    expect(prompt).not.toContain('USER REFINEMENT')
  })

  it('uses "up to" count instruction when clarificationAnswer is non-empty (filter signal present)', () => {
    const prompt = buildCompetitorPrompt(
      [makeProfile({ username: 'refaccount', topHashtags: [] })],
      [makeProfile()],
      undefined,
      'Fitness transformation coaches',
    )
    expect(prompt).toContain('select up to')
  })

  it('clarificationAnswer is injected BEFORE nicheContextSection in prompt', () => {
    const prompt = buildCompetitorPrompt(
      [inputProfile],
      [makeProfile()],
      'fitness niche',
      'Online coaching',
    )
    const refinementPos = prompt.indexOf('USER REFINEMENT')
    const nicheContextPos = prompt.indexOf('EXPLICIT NICHE CONTEXT')
    expect(refinementPos).toBeGreaterThan(-1)
    expect(nicheContextPos).toBeGreaterThan(-1)
    expect(refinementPos).toBeLessThan(nicheContextPos)
  })
})

describe('buildClarificationPrompt', () => {
  it('includes reference account username and bio', () => {
    const ref = makeProfile({ username: 'fitcoach', biography: 'Helping you transform your body' })
    const prompt = buildClarificationPrompt(ref, [makeProfile()], 'fitness')
    expect(prompt).toContain('@fitcoach')
    expect(prompt).toContain('Helping you transform your body')
  })

  it('includes stated niche when provided', () => {
    const ref = makeProfile({ username: 'refaccount' })
    const prompt = buildClarificationPrompt(ref, [makeProfile()], 'online business coaching')
    expect(prompt).toContain('Stated niche: "online business coaching"')
  })

  it('omits stated niche line when nicheContext is empty', () => {
    const ref = makeProfile({ username: 'refaccount' })
    const prompt = buildClarificationPrompt(ref, [makeProfile()], '')
    expect(prompt).not.toContain('Stated niche')
  })

  it('includes top 20 candidates (not more) in the prompt', () => {
    const ref = makeProfile({ username: 'refaccount' })
    const candidates = Array.from({ length: 25 }, (_, i) =>
      makeProfile({ username: `candidate${i + 1}` }),
    )
    const prompt = buildClarificationPrompt(ref, candidates, 'fitness')
    // Only first 20 should appear
    expect(prompt).toContain('@candidate1')
    expect(prompt).toContain('@candidate20')
    expect(prompt).not.toContain('@candidate21')
  })

  it('reports the full candidate count (not just the 20 shown)', () => {
    const ref = makeProfile({ username: 'refaccount' })
    const candidates = Array.from({ length: 30 }, (_, i) =>
      makeProfile({ username: `cand${i}` }),
    )
    const prompt = buildClarificationPrompt(ref, candidates, '')
    expect(prompt).toContain('30 candidate accounts')
  })

  it('includes the JSON format instruction', () => {
    const ref = makeProfile({ username: 'refaccount' })
    const prompt = buildClarificationPrompt(ref, [makeProfile()], '')
    expect(prompt).toContain('Return JSON:')
    expect(prompt).toContain('"question"')
    expect(prompt).toContain('"options"')
  })
})
