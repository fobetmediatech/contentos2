import { describe, it, expect } from 'vitest'
import { buildCreatorScriptPrompt } from './creatorScript'
import type { VoiceProfile } from './voiceProfile'

const VOICE: VoiceProfile = {
  handle: 'jeffnippard', displayName: 'Jeff Nippard', fromScripts: false,
  vocabulary: ['science-based'], language: 'English', formality: 'casual-expert',
  sentenceRhythm: 'measured', audienceAddress: 'you', toneDescriptors: ['nerdy', 'precise'],
  hookHabits: ['Here are 3 myths...'], emotionalRegister: 'calm authority',
  structuralPattern: 'hook → myth → evidence → takeaway', personaConsistencyScore: 9,
  reelCount: 8, builtAt: 0, exemplars: ['Let me settle this debate once and for all.'],
}

describe('buildCreatorScriptPrompt', () => {
  it('injects the idea + creator handle + language directive', () => {
    const p = buildCreatorScriptPrompt('how to build your first pull-up', VOICE, 'english')
    expect(p).toContain('how to build your first pull-up')
    expect(p).toContain('@jeffnippard')
    expect(p).toContain('ENGLISH')
  })
  it('anchors on the creator exemplars', () => {
    const p = buildCreatorScriptPrompt('idea', VOICE, 'english')
    expect(p).toContain('Let me settle this debate once and for all.')
  })
  it('honors the hinglish toggle', () => {
    const p = buildCreatorScriptPrompt('idea', VOICE, 'hinglish')
    expect(p).toContain('HINGLISH')
  })
  it('handles a profile with no exemplars', () => {
    const p = buildCreatorScriptPrompt('idea', { ...VOICE, exemplars: [] }, 'english')
    expect(p).toContain('idea')
  })
})
