import { describe, it, expect } from 'vitest'
import { buildReelRemixPrompt, VARIATION_ANGLES, buildFieldRegenPrompt, FIELD_REGEN_SCHEMA } from './reelRemix'
import type { VoiceProfile } from './voiceProfile'
import type { ReelRewriteResult } from './reelRewrite'

const SOURCE = { transcript: 'yeh reel viral ho gaya kyunki hook strong tha' }

const CURRENT: ReelRewriteResult = {
  spokenHook: 'this is the current hook',
  beatScript: [{ beatLabel: 'Hook', script: 'beat one', onScreenText: 'overlay' }],
  caption: 'cap', cta: 'follow', onScreenText: ['a'], altHooks: ['x', 'y', 'z'],
}

describe('buildReelRemixPrompt', () => {
  it('injects the new topic and preserves-structure instruction', () => {
    const p = buildReelRemixPrompt(SOURCE, 'how to save money in your 20s', 'english')
    expect(p).toContain('how to save money in your 20s')
    expect(p).toContain('Preserve the reference')
    expect(p).toContain('ENGLISH')
  })

  it('works with no voice (mimics the reference register)', () => {
    const p = buildReelRemixPrompt(SOURCE, 'topic', 'english')
    expect(p).toContain('No specific creator voice')
  })

  it('uses the client voice when provided and honors the hinglish toggle', () => {
    const voice = {
      handle: 'creator', displayName: '@creator', fromScripts: false,
      vocabulary: ['bhai'], formality: 'casual', sentenceRhythm: 'short', audienceAddress: 'you',
      toneDescriptors: ['punchy'], hookHabits: ['POV:'], emotionalRegister: 'energetic',
      structuralPattern: 'hook-body-cta', personaConsistencyScore: 8, reelCount: 8, builtAt: 0,
      exemplars: ['bhai suno ek baat'],
    } as VoiceProfile
    const p = buildReelRemixPrompt(SOURCE, 'topic', 'hinglish', voice)
    expect(p).toContain('@creator')
    expect(p).toContain('HINGLISH')
  })
})

describe('variation angles', () => {
  it('exposes 3 distinct angles', () => {
    expect(VARIATION_ANGLES.length).toBe(3)
    expect(new Set(VARIATION_ANGLES).size).toBe(3)
  })
  it('appends the angle to the prompt when given', () => {
    const p = buildReelRemixPrompt(SOURCE, 'topic', 'english', undefined, VARIATION_ANGLES[1])
    expect(p).toContain(VARIATION_ANGLES[1])
  })
  it('omits the angle line when not given', () => {
    const p = buildReelRemixPrompt(SOURCE, 'topic', 'english')
    expect(p).not.toContain('For THIS version')
  })
})

describe('buildFieldRegenPrompt', () => {
  it('names the field, includes the current script + language directive', () => {
    const p = buildFieldRegenPrompt(CURRENT, SOURCE, 'the spoken hook', 'topic', 'hinglish')
    expect(p).toContain('the spoken hook')
    expect(p).toContain('this is the current hook')
    expect(p).toContain('HINGLISH')
  })
  it('schema requires a single value string', () => {
    expect(FIELD_REGEN_SCHEMA.required).toEqual(['value'])
  })
})
