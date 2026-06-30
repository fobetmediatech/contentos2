// src/ai/prompts/reelRewrite.test.ts
import { describe, it, expect } from 'vitest'
import { buildReelRewritePrompt, parseReelRewrite, resolveTargetLanguage, REEL_REWRITE_SCHEMA } from './reelRewrite'
import type { VoiceProfile } from './voiceProfile'
import type { SingleReelResult } from '../../store/singleReelStore'

const VOICE: VoiceProfile = {
  handle: 'aanya', displayName: 'Aanya', fromScripts: false,
  vocabulary: ['lowkey'], formality: 'casual', sentenceRhythm: 'short', audienceAddress: 'you',
  toneDescriptors: ['playful'], hookHabits: ['POV:'], emotionalRegister: 'fun',
  structuralPattern: 'hook-body-cta', personaConsistencyScore: 8, reelCount: 8, builtAt: 1,
}

const SOURCE: SingleReelResult = {
  transcript: 'stop scrolling, here is the trick',
  segments: [{ start: 0, text: 'stop scrolling' }],
  videoAnalysis: {
    duration_s: 20, aspect_ratio: '9:16', dominant_framing: 'selfie', cuts_count: 4,
    text_overlay_density: 'high', captions_present: true, trending_audio_hint: 'none', t0_frame: 'face',
    visual_beats: [{ t_start: 0, t_end: 3, on_screen: 'STOP', function: 'hook' }],
    notable_moments: [],
  },
  markdown: '## Hook\nCuriosity gap. CTA: follow for more.',
}

describe('reelRewrite', () => {
  it('parseReelRewrite coerces shapes and guarantees exactly 3 altHooks', () => {
    const r = parseReelRewrite({
      spokenHook: 'POV: you found the trick',
      beatScript: [{ beatLabel: 'Hook', script: 'POV…', onScreenText: 'STOP' }, 'garbage'],
      caption: 'cap', cta: 'follow', onScreenText: ['STOP', 7],
      altHooks: ['a', 'b', 'c', 'd'],
    })
    expect(r.spokenHook).toBe('POV: you found the trick')
    expect(r.beatScript).toHaveLength(1)             // non-object beat dropped
    expect(r.onScreenText).toEqual(['STOP'])         // non-string dropped
    expect(r.altHooks).toHaveLength(3)               // capped to 3
  })

  it('parseReelRewrite pads altHooks to 3 when fewer are returned', () => {
    expect(parseReelRewrite({ altHooks: ['only one'] }).altHooks).toHaveLength(3)
  })

  it('buildReelRewritePrompt embeds the source beats, transcript, and the voice', () => {
    const p = buildReelRewritePrompt(SOURCE, VOICE)
    expect(p).toContain('STOP')                 // source on_screen beat
    expect(p).toContain('stop scrolling')       // source transcript / first segment
    expect(p).toContain('aanya')                // target voice
    expect(p).toContain('POV:')                 // a hook habit
  })

  it('schema requires the full package fields', () => {
    const req = (REEL_REWRITE_SCHEMA as { required: string[] }).required
    expect(req).toEqual(expect.arrayContaining(['spokenHook', 'beatScript', 'caption', 'cta', 'onScreenText', 'altHooks']))
  })

  it('instructs Latin-script / Hinglish output (no Devanagari)', () => {
    const p = buildReelRewritePrompt(SOURCE, VOICE)
    expect(p).toMatch(/Hinglish/i)
    expect(p).toMatch(/Latin/i)
    expect(p).toMatch(/Devanagari/i)
  })

  it('few-shots on the voice exemplars when present (the anti-slop fix)', () => {
    const voiceWithExemplars: VoiceProfile = { ...VOICE, exemplars: ['Bro main bata raha hoon, yeh game-changer hai.'] }
    const p = buildReelRewritePrompt(SOURCE, voiceWithExemplars)
    expect(p).toContain('Bro main bata raha hoon')     // verbatim exemplar injected
    expect(p).toMatch(/ACTUALLY talks/i)
  })

  it('falls back to the voice profile when no exemplars are present', () => {
    const p = buildReelRewritePrompt(SOURCE, VOICE)      // VOICE has no exemplars
    expect(p).toContain('no verbatim samples available')
  })

  it('includes the flow + anti-slop guardrails', () => {
    const p = buildReelRewritePrompt(SOURCE, VOICE)
    expect(p).toMatch(/ONE continuous spoken take/i)     // FLOW rule
    expect(p).toMatch(/BANNED/)                          // anti-slop list present
    expect(p).toContain("let's dive in")                 // a named AI tell to avoid
  })

  it('emits a HARD English directive that tells the model to ignore the source language', () => {
    const p = buildReelRewritePrompt(SOURCE, { ...VOICE, language: 'mostly English with occasional Hindi words' })
    expect(p).toContain('mostly English with occasional Hindi words') // still surfaced in the voice block
    expect(p).toMatch(/LANGUAGE \(NON-NEGOTIABLE\)/)
    expect(p).toMatch(/Write EVERY field in ENGLISH/)
    expect(p).toMatch(/SOURCE reel is in Hindi\/Hinglish — IGNORE/)
  })

  it('emits a HARD Hinglish directive for a Hinglish creator', () => {
    const p = buildReelRewritePrompt(SOURCE, { ...VOICE, language: 'heavy Hinglish' })
    expect(p).toMatch(/Write EVERY field in natural HINGLISH/)
  })
})

describe('resolveTargetLanguage', () => {
  const base: VoiceProfile = { ...VOICE }

  it('a manual override beats everything else', () => {
    // english override wins despite a Hinglish field + Hinglish exemplars
    expect(resolveTargetLanguage({ ...base, outputLanguage: 'english', language: 'heavy Hinglish', exemplars: ['bhai yeh kaise hota hai'] })).toBe('english')
    // hinglish override wins despite an English field
    expect(resolveTargetLanguage({ ...base, outputLanguage: 'hinglish', language: 'English' })).toBe('hinglish')
  })

  it('reads the language field when no override is set', () => {
    expect(resolveTargetLanguage({ ...base, language: 'English' })).toBe('english')
    expect(resolveTargetLanguage({ ...base, language: 'mostly English with occasional Hindi words' })).toBe('english')
    expect(resolveTargetLanguage({ ...base, language: 'roughly half-and-half Hinglish' })).toBe('hinglish')
    expect(resolveTargetLanguage({ ...base, language: 'heavy Hinglish' })).toBe('hinglish')
  })

  it('falls back to an exemplar/vocabulary heuristic for stale profiles (no field)', () => {
    expect(resolveTargetLanguage({ ...base, language: undefined, exemplars: ['Bhai yeh kaise hota hai, suno aur samajh lo abhi'] })).toBe('hinglish')
    expect(resolveTargetLanguage({ ...base, language: undefined, exemplars: ['Stop scrolling, this is the one mistake everyone makes daily'] })).toBe('english')
  })

  it('defaults to ENGLISH when there is no usable signal', () => {
    expect(resolveTargetLanguage({ ...base, language: undefined, exemplars: [], vocabulary: [] })).toBe('english')
  })
})
