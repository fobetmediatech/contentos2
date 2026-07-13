// src/ai/prompts/creatorScript.ts
/**
 * Creator Script — Script Studio's "Choose a creator" prompt: write an ORIGINAL short-form
 * script about an idea, in a specific creator's voice, with NO reference reel. Grounds on the
 * creator's VoiceProfile (built from their real reels) + verbatim exemplars. Reuses
 * REEL_REWRITE_SCHEMA / parseReelRewrite for output; reelRewrite.ts is not modified.
 */
import type { VoiceProfile } from './voiceProfile'
import type { TargetLanguage } from './reelRewrite'

function voiceBlock(v: VoiceProfile): string {
  return [
    `- Vocabulary / signature phrases: ${v.vocabulary.join(', ') || '—'}`,
    `- Formality: ${v.formality || '—'}`,
    `- Sentence rhythm: ${v.sentenceRhythm || '—'}`,
    `- Audience address: ${v.audienceAddress || '—'}`,
    `- Tone: ${v.toneDescriptors.join(', ') || '—'}`,
    `- Hook habits: ${v.hookHabits.join(' | ') || '—'}`,
    `- Emotional register: ${v.emotionalRegister || '—'}`,
    `- Usual structure: ${v.structuralPattern || '—'}`,
  ].join('\n')
}

function exemplarsBlock(v: VoiceProfile): string {
  const ex = (v.exemplars ?? []).map((s) => s.trim()).filter(Boolean)
  if (!ex.length) return '(no verbatim samples — lean on the voice profile above)'
  return ex.map((e) => `- "${e.replace(/"/g, '\\"')}"`).join('\n')
}

function languageDirective(language: TargetLanguage): string {
  if (language === 'hinglish') {
    return '- LANGUAGE (NON-NEGOTIABLE): Write EVERY field in natural HINGLISH — a real Hindi+English mix. Romanize all Hindi in Latin letters; NEVER Devanagari.'
  }
  return '- LANGUAGE (NON-NEGOTIABLE): Write EVERY field in ENGLISH.'
}

export function buildCreatorScriptPrompt(idea: string, voice: VoiceProfile, language: TargetLanguage): string {
  return `You are the scriptwriter on @${voice.handle}'s team. Write a brand-new short-form video script about the idea below, in @${voice.handle}'s EXACT voice and style — as if their own team wrote it. It must sound like a real person said it out loud in one take, NOT like AI wrote it.

## THE IDEA — write the script about THIS

${idea}

## @${voice.handle}'s voice — match it precisely

${voiceBlock(voice)}

### How @${voice.handle} ACTUALLY opens / talks — copy this cadence and energy (NOT the topic):
${exemplarsBlock(voice)}

## WRITE FOR THE EAR — flow + no AI slop

- FLOW: one continuous spoken take. Each beat runs into the next like someone talking without stopping. No line reads as a standalone bullet.
- SOUND SPOKEN: short sentences and fragments, contractions, the rhythm of real speech, one idea per breath.
- Open with a hook in @${voice.handle}'s hook style; follow their usual structure ("${voice.structuralPattern || 'hook → body → payoff → CTA'}").
- BANNED AI tells — do NOT use: em-dashes as dramatic pauses; filler openers ("here's the thing", "let's dive in", "the truth is", "we need to talk about"); listicle scaffolding ("number one… number two"); hedges ("kind of", "sort of", "essentially"); essay transitions ("furthermore", "moreover", "in conclusion").

## Rules

${languageDirective(language)}
- SCRIPT: Latin/Roman letters only. Romanize any Hindi as Hinglish; NEVER Devanagari or any non-Latin script in any field.
- Build the structure from @${voice.handle}'s usual shape — a natural number of beats for this idea, their hook→…→CTA flow.
- spokenHook: the opening line (verbatim, ready to say to camera), about the idea, in their hook style.
- beatScript: one entry per beat — beatLabel (its function), script (what they say, flowing on from the previous beat), onScreenText (the overlay).
- caption: an Instagram caption in their voice.
- cta: a single call-to-action in their voice.
- onScreenText: 2-5 punchy overlay lines for the whole reel.
- altHooks: exactly 3 ALTERNATIVE opening hooks in their voice, for A/B testing.

Return only valid JSON matching the schema. Do not add commentary outside the JSON.`
}
