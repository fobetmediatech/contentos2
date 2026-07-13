// src/ai/prompts/reelRemix.ts
/**
 * Reel Remix — Script Studio prompt: keep a reference video's STRUCTURE, write about a NEW
 * topic. Optional client voice; explicit output language (English/Hinglish toggle).
 *
 * Reuses REEL_REWRITE_SCHEMA / parseReelRewrite / ReelRewriteResult / TargetLanguage from
 * reelRewrite.ts so the output shape, coercion, and result rendering are shared. reelRewrite.ts
 * is intentionally NOT modified — this is the topic-swap mirror of the voice-swap rewrite.
 */
import type { ReelVideoAnalysis } from '../../domain/reel'
import type { VoiceProfile } from './voiceProfile'
import type { TargetLanguage } from './reelRewrite'

export interface RemixSource {
  /** The reference video's spoken transcript (verbatim). May be user-edited. */
  transcript: string
  /** IG-only structural beats from the deep video analysis. Absent for YouTube. */
  beats?: ReelVideoAnalysis['visual_beats']
}

function beatsBlock(source: RemixSource): string {
  const beats = source.beats ?? []
  if (!beats.length) {
    return '(no explicit beat breakdown — infer the structure from the transcript: hook → setup → body → payoff/CTA, and keep the SAME number of moves and the SAME pacing.)'
  }
  return beats
    .map((b, i) => `Beat ${i + 1} [${b.function || 'beat'}] (${b.t_start ?? '?'}–${b.t_end ?? '?'}s): on-screen "${b.on_screen || ''}"`)
    .join('\n')
}

function voiceBlock(v: VoiceProfile): string {
  return [
    `- Vocabulary / signature phrases: ${v.vocabulary.join(', ') || '—'}`,
    `- Formality: ${v.formality || '—'}`,
    `- Sentence rhythm: ${v.sentenceRhythm || '—'}`,
    `- Audience address: ${v.audienceAddress || '—'}`,
    `- Tone: ${v.toneDescriptors.join(', ') || '—'}`,
    `- Hook habits: ${v.hookHabits.join(' | ') || '—'}`,
    `- Emotional register: ${v.emotionalRegister || '—'}`,
  ].join('\n')
}

function exemplarsBlock(v: VoiceProfile): string {
  const ex = (v.exemplars ?? []).map((s) => s.trim()).filter(Boolean)
  if (!ex.length) return '(no verbatim samples — lean on the voice profile above)'
  return ex.map((e) => `- "${e.replace(/"/g, '\\"')}"`).join('\n')
}

function languageDirective(language: TargetLanguage): string {
  if (language === 'hinglish') {
    return '- LANGUAGE (NON-NEGOTIABLE): Write EVERY field in natural HINGLISH — a real Hindi+English speaking mix. Romanize all Hindi in Latin letters; NEVER Devanagari.'
  }
  return '- LANGUAGE (NON-NEGOTIABLE): Write EVERY field in ENGLISH. If the reference transcript is in Hindi/Hinglish, IGNORE that — do NOT carry its Hindi words or sentence shapes across.'
}

export function buildReelRemixPrompt(
  source: RemixSource,
  newTopic: string,
  language: TargetLanguage,
  voice?: VoiceProfile,
): string {
  const voiceSection = voice
    ? `## TARGET voice — @${voice.handle}

${voiceBlock(voice)}

### How @${voice.handle} ACTUALLY talks — match THIS cadence and energy (copy the rhythm, NEVER the topic):
${exemplarsBlock(voice)}`
    : `## Voice

No specific creator voice was given. Match the reference video's OWN spoken register and energy — same confidence, pacing, and address — as a clean first-person voice.`

  const voiceRule = voice
    ? `- Write it so it sounds like @${voice.handle} actually said it out loud in one take — borrow their real words, fillers, and energy from the samples above.`
    : `- Write it so it sounds like a real person said it out loud in one take, in the reference video's own register.`

  return `You are an elite short-form video scriptwriter specializing in viral hooks and retention. Take a reference video's STRUCTURE and write a brand-new script about a DIFFERENT topic using the exact same structural blueprint, pacing, and energy.

## REFERENCE video — its STRUCTURE is the blueprint (copy the shape, NOT the subject)

Beat breakdown:
${beatsBlock(source)}

Full transcript (for pacing/tone reference — do NOT reuse its subject matter):
${source.transcript}

## NEW TOPIC — write the new script about THIS

${newTopic}

${voiceSection}

## WRITE FOR THE EAR — flow + no AI slop

- FLOW: one continuous spoken take. Each beat runs into the next like someone talking without stopping. No line reads as a standalone bullet.
- SOUND SPOKEN: short sentences and fragments, contractions, the rhythm of real speech, one idea per breath.
${voiceRule}
- BANNED AI tells — do NOT use: em-dashes as dramatic pauses; filler openers ("here's the thing", "let's dive in", "the truth is", "we need to talk about"); listicle scaffolding ("number one… number two"); hedges ("kind of", "sort of", "essentially"); essay transitions ("furthermore", "moreover", "in conclusion").

## Rules

${languageDirective(language)}
- SCRIPT: Latin/Roman letters only. Romanize any Hindi as Hinglish; NEVER Devanagari or any non-Latin script in any field.
- Preserve the reference's structure EXACTLY: same number of beats, same beat functions, same hook→…→CTA shape and pacing. Replace the SUBJECT with the new topic — never carry over the reference's specific examples, names, or claims.
- spokenHook: the opening line (verbatim, ready to say to camera), about the NEW topic.
- beatScript: one entry per beat — beatLabel (its function), script (what they say, flowing on from the previous beat), onScreenText (the overlay).
- caption: an Instagram caption for the new topic.
- cta: a single call-to-action.
- onScreenText: 2-5 punchy overlay lines for the whole reel.
- altHooks: exactly 3 ALTERNATIVE opening hooks, for A/B testing.

Return only valid JSON matching the schema. Do not add commentary outside the JSON.`
}
