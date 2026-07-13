import { describe, it, expect } from 'vitest'
import { buildReelRemixPrompt } from './reelRemix'
import type { VoiceProfile } from './voiceProfile'

const SOURCE = { transcript: 'yeh reel viral ho gaya kyunki hook strong tha' }

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
