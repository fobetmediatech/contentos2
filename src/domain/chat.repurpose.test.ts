// src/domain/chat.repurpose.test.ts
import { describe, it, expect } from 'vitest'
import type { ResultPayload, RepurposeResultPayload } from './chat'

describe('RepurposeResultPayload', () => {
  it('is assignable to ResultPayload with the frozen kind "repurpose"', () => {
    const payload: RepurposeResultPayload = {
      kind: 'repurpose',
      sourceReelUrl: 'https://instagram.com/reel/x',
      clientHandle: 'aanya',
      voiceProfile: {
        handle: 'aanya', displayName: 'Aanya', fromScripts: false, vocabulary: [], formality: '',
        sentenceRhythm: '', audienceAddress: '', toneDescriptors: [], hookHabits: [],
        emotionalRegister: '', structuralPattern: '', personaConsistencyScore: 5, reelCount: 8, builtAt: 1,
      },
      rewrite: { spokenHook: 'h', beatScript: [], caption: 'c', cta: 'cta', onScreenText: [], altHooks: ['', '', ''] },
    }
    const widened: ResultPayload = payload
    expect(widened.kind).toBe('repurpose')
  })
})
