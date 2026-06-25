// src/ai/prompts/reelRewrite.test.ts
import { describe, it, expect } from 'vitest'
import { buildReelRewritePrompt, parseReelRewrite, REEL_REWRITE_SCHEMA } from './reelRewrite'
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
})
