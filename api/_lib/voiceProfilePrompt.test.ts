import { describe, it, expect } from 'vitest'
import * as apiCopy from './voiceProfilePrompt'
import * as srcOrig from '../../src/ai/prompts/voiceProfile'
import { pickExemplars as srcPickExemplars } from '../../src/lib/repurposeHelpers'

describe('voiceProfilePrompt copy parity', () => {
  it('VERSION matches src (fails loudly if the copy drifts)', () => {
    expect(apiCopy.VOICE_PROFILE_PROMPT_VERSION).toBe(srcOrig.VOICE_PROFILE_PROMPT_VERSION)
  })
  it('SCHEMA matches src', () => {
    expect(apiCopy.VOICE_PROFILE_SCHEMA).toEqual(srcOrig.VOICE_PROFILE_SCHEMA)
  })
  it('buildVoiceProfilePrompt produces identical output', () => {
    const a = apiCopy.buildVoiceProfilePrompt('h', ['t1'], ['c1'])
    const b = srcOrig.buildVoiceProfilePrompt('h', ['t1'], ['c1'])
    expect(a).toBe(b)
  })
  it('pickExemplars matches src/lib/repurposeHelpers.ts (fails loudly if the copy drifts)', () => {
    const cases: Array<[string[], number?]> = [
      [['Hello there. Second sentence.']],
      [['a. b. c.', 'Repeat this. Repeat this.', '', '   ', 'short']],
      [['  extra   whitespace   here. and more.', 'no punctuation at all just a run of words']],
      [['One.', 'Two.', 'Three.', 'Four.', 'Five.'], 2],
      [['x'.repeat(300) + '.']], // exercises EXEMPLAR_MAX_CHARS truncation
    ]
    for (const [samples, max] of cases) {
      expect(apiCopy.pickExemplars(samples, max)).toEqual(srcPickExemplars(samples, max))
    }
  })
  it('parseVoiceProfile matches src (fails loudly if coercion/clamping logic drifts)', () => {
    const attach = {
      handle: 'creator',
      displayName: 'Creator Name',
      reelCount: 3,
      builtAt: 1700000000000,
      fromScripts: false,
      exemplars: ['Hello there.'],
    }
    const rawCases: unknown[] = [
      // well-formed
      {
        vocabulary: ['bhai', 'literally'],
        language: 'mostly English with occasional Hindi words',
        formality: 'casual',
        sentenceRhythm: 'short punchy lines',
        audienceAddress: 'you',
        toneDescriptors: ['energetic', 'warm'],
        hookHabits: ['POV: you just…'],
        emotionalRegister: 'humour → urgency',
        structuralPattern: 'hook → body → CTA',
        personaConsistencyScore: 7,
      },
      // score out of range (clamp high) + non-integer (rounding)
      { personaConsistencyScore: 14.6 },
      // score out of range (clamp low)
      { personaConsistencyScore: -3 },
      // score as numeric string (Number() coercion)
      { personaConsistencyScore: '8.5' },
      // missing/invalid score → fallback default
      { personaConsistencyScore: 'not-a-number' },
      // wrong types for string/array fields → fallback coercion
      {
        vocabulary: 'not-an-array',
        toneDescriptors: [1, 2, 'ok'],
        formality: 42,
        personaConsistencyScore: null,
      },
      // completely empty/nullish raw
      {},
      null,
      undefined,
    ]
    for (const raw of rawCases) {
      expect(apiCopy.parseVoiceProfile(raw, attach)).toEqual(srcOrig.parseVoiceProfile(raw, attach))
    }
  })
})
