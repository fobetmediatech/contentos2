// src/ai/prompts/voiceProfile.test.ts
import { describe, it, expect } from 'vitest'
import { buildVoiceProfilePrompt, parseVoiceProfile, VOICE_PROFILE_SCHEMA } from './voiceProfile'

describe('voiceProfile', () => {
  it('parseVoiceProfile coerces missing/mistyped fields and attaches code-owned fields', () => {
    const profile = parseVoiceProfile(
      { vocabulary: ['lowkey', 42], toneDescriptors: 'not-an-array', personaConsistencyScore: '8' },
      { handle: 'aanya', displayName: 'Aanya', reelCount: 8, builtAt: 123, fromScripts: false },
    )
    expect(profile.handle).toBe('aanya')
    expect(profile.displayName).toBe('Aanya')
    expect(profile.reelCount).toBe(8)
    expect(profile.builtAt).toBe(123)
    expect(profile.fromScripts).toBe(false)
    expect(profile.vocabulary).toEqual(['lowkey']) // non-strings dropped
    expect(profile.toneDescriptors).toEqual([])     // non-array -> []
    expect(profile.personaConsistencyScore).toBe(8) // coerced to number, clamped 1-10
    expect(typeof profile.formality).toBe('string')
  })

  it('parseVoiceProfile clamps the consistency score into 1..10', () => {
    expect(parseVoiceProfile({ personaConsistencyScore: 99 }, { handle: 'x', displayName: 'x', reelCount: 0, builtAt: 0, fromScripts: false }).personaConsistencyScore).toBe(10)
    expect(parseVoiceProfile({ personaConsistencyScore: -3 }, { handle: 'x', displayName: 'x', reelCount: 0, builtAt: 0, fromScripts: false }).personaConsistencyScore).toBe(1)
  })

  it('buildVoiceProfilePrompt includes the handle and the supplied transcripts', () => {
    const p = buildVoiceProfilePrompt('aanya', ['hey guys welcome back'], ['caption one'])
    expect(p).toContain('aanya')
    expect(p).toContain('hey guys welcome back')
    expect(p).toContain('caption one')
  })

  it('VOICE_PROFILE_SCHEMA only asks the LLM for the qualitative half', () => {
    const req = (VOICE_PROFILE_SCHEMA as { required: string[] }).required
    expect(req).toContain('toneDescriptors')
    expect(req).not.toContain('handle')      // code-attached
    expect(req).not.toContain('reelCount')   // code-attached
  })

  it('instructs Latin-script / Hinglish field values (no Devanagari)', () => {
    const p = buildVoiceProfilePrompt('aanya', [], [])
    expect(p).toMatch(/Hinglish/i)
    expect(p).toMatch(/Devanagari/i)
  })
})
