# Repurpose Reel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `repurpose_reel` conversational pipeline that rewrites a viral source reel into a client's voice (full shoot-ready package + 3 hook variants), with reusable client voice profiles saved to the shared corpus and editable on the Memory page.

**Architecture:** A 4th pipeline following the existing extension conventions. Three stages in one hook: (1) build/load a `VoiceProfile` for the client (`scrapeTopReels` → `transcribeReels` → one Gemini synthesis), (2) deep-analyze the source reel via the existing `/api/analyze-single-reel` (`SingleReelResult`), (3) one Gemini rewrite call. Result is snapshotted into the conversation (kind `'repurpose'`). Voice profiles persist to a new `corpus_voice_profiles` Supabase table and render on a new Memory "Voices" tab. **Zero new server code.**

**Tech Stack:** React + Vite, TanStack Query, Zustand (+ supabaseStorage persist), Supabase (Postgres + RLS), Gemini via `/api/gemini` proxy, Apify via `/api/apify` proxy, Clerk JWT, vitest.

**Spec:** `docs/superpowers/specs/2026-06-25-repurpose-reel-design.md`

**Branch:** `feat/repurpose-reel` (already created).

**Conventions reminder:**
- Persisted payload `kind` discriminants are FROZEN. We add a new `'repurpose'` kind; never change existing ones.
- User-facing errors must be generic (use the `devWarn` + generic-string pattern); never surface raw API bodies.
- Check `signal?.aborted` after every async hop (latest-wins steering).
- Run targeted tests with `bunx vitest run <path>`; full check with `bun run test`, `bun run typecheck`, `bun run typecheck:api`, `bun run build`.

---

## Type contract (shared across tasks — keep names identical)

```ts
// VoiceProfile — produced by Task 2, stored by Tasks 4-5, consumed by Tasks 3,8,12,14
export interface VoiceProfile {
  handle: string              // code-attached (the @handle, or __scripts__<hash>)
  displayName: string         // user-editable label
  fromScripts: boolean        // true when built from pasted scripts (no scrape)
  vocabulary: string[]        // signature words/phrases
  formality: string           // e.g. "casual, lots of slang" / "polished, professional"
  sentenceRhythm: string      // pacing description
  audienceAddress: string     // "you"/"we"/third-person + intimacy
  toneDescriptors: string[]   // 3-6 adjectives
  hookHabits: string[]        // 3-5 recurring opening patterns
  emotionalRegister: string   // primary emotions + arc
  structuralPattern: string   // hook -> body -> CTA shape
  personaConsistencyScore: number // 1-10
  reelCount: number           // code-attached
  builtAt: number             // epoch ms, code-attached
}

// ReelRewriteResult — produced by Task 3, consumed by Tasks 8,12
export interface ReelRewriteResult {
  spokenHook: string
  beatScript: Array<{ beatLabel: string; script: string; onScreenText: string }>
  caption: string
  cta: string
  onScreenText: string[]
  altHooks: string[]          // exactly 3
}

// RepurposeResultPayload — Task 7, consumed by Tasks 8,12,13
export type RepurposeResultPayload = {
  kind: 'repurpose'
  sourceReelUrl: string
  clientHandle: string        // the profile key (handle or __scripts__<hash>)
  voiceProfile: VoiceProfile
  rewrite: ReelRewriteResult
}
```

---

## Task 1: Supabase migration — `corpus_voice_profiles` table

**Files:**
- Create: `supabase/migrations/20260625000000_voice_profiles.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Voice profiles: reusable client tone profiles for the Repurpose Reel pipeline.
--
-- A voice profile is a client-identity asset (vocabulary, cadence, hook habits, tone),
-- NOT creator-analyzed content — so it gets its own table rather than reusing corpus_content
-- (whose `kind` discriminant is the frozen 'reel' value with a non-null creator FK).
--
-- RLS mirrors the corpus team-brain model (20260612000000_corpus_ownership.sql):
--   SELECT  — any authenticated user (team-wide reuse).
--   INSERT  — any authenticated user, stamping their own Clerk sub as owner_user_id.
--   UPDATE  — any authenticated user (locked decision: any teammate can edit/rebuild).
-- owner_user_id is retained as provenance (last writer), not as an edit gate.
-- No DELETE policy: profiles are rebuilt, never deleted.

create table if not exists corpus_voice_profiles (
  handle         text        primary key,          -- @handle, or __scripts__<hash> for pasted-script profiles
  owner_user_id  text        not null,             -- Clerk sub of the last writer (auth.jwt()->>'sub')
  display_name   text,
  voice_data     jsonb       not null,             -- the full VoiceProfile object
  reel_count     int         not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists corpus_voice_profiles_owner_idx on corpus_voice_profiles (owner_user_id);

alter table corpus_voice_profiles enable row level security;

create policy corpus_voice_profiles_select on corpus_voice_profiles for select
  using (auth.role() = 'authenticated');

create policy corpus_voice_profiles_insert on corpus_voice_profiles for insert
  with check (auth.role() = 'authenticated' and owner_user_id = auth.jwt()->>'sub');

create policy corpus_voice_profiles_update on corpus_voice_profiles for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

revoke delete on corpus_voice_profiles from authenticated, anon;
```

- [ ] **Step 2: Commit**

```bash
git add "supabase/migrations/20260625000000_voice_profiles.sql"
git commit -m "feat(repurpose): add corpus_voice_profiles migration"
```

> Note: applying the migration to Supabase is a deploy step, not part of local dev (the app reads/writes it once deployed). No local test for raw SQL.

---

## Task 2: VoiceProfile prompt module

**Files:**
- Create: `src/ai/prompts/voiceProfile.ts`
- Test: `src/ai/prompts/voiceProfile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/ai/prompts/voiceProfile.test.ts`
Expected: FAIL — `Cannot find module './voiceProfile'`.

- [ ] **Step 3: Write the module**

```ts
// src/ai/prompts/voiceProfile.ts
/**
 * Voice Profile — prompt + schema + type for synthesizing a client's reel voice.
 *
 * Mirrors creatorHookSummary.ts: the LLM produces the qualitative half; handle/displayName/
 * reelCount/builtAt/fromScripts are attached in code (parseVoiceProfile). Consumed by
 * useRepurposeReel (build) and the rewrite prompt (reelRewrite.ts).
 */

export const VOICE_PROFILE_PROMPT_VERSION = 1

export interface VoiceProfile {
  handle: string
  displayName: string
  fromScripts: boolean
  vocabulary: string[]
  formality: string
  sentenceRhythm: string
  audienceAddress: string
  toneDescriptors: string[]
  hookHabits: string[]
  emotionalRegister: string
  structuralPattern: string
  personaConsistencyScore: number
  reelCount: number
  builtAt: number
}

/** The qualitative half the LLM returns; the rest is attached in code. */
export type VoiceProfileDraft = Omit<
  VoiceProfile,
  'handle' | 'displayName' | 'fromScripts' | 'reelCount' | 'builtAt'
>

export const VOICE_PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    vocabulary: { type: 'array', items: { type: 'string' } },
    formality: { type: 'string' },
    sentenceRhythm: { type: 'string' },
    audienceAddress: { type: 'string' },
    toneDescriptors: { type: 'array', items: { type: 'string' } },
    hookHabits: { type: 'array', items: { type: 'string' } },
    emotionalRegister: { type: 'string' },
    structuralPattern: { type: 'string' },
    personaConsistencyScore: { type: 'integer' },
  },
  required: [
    'vocabulary', 'formality', 'sentenceRhythm', 'audienceAddress',
    'toneDescriptors', 'hookHabits', 'emotionalRegister', 'structuralPattern',
    'personaConsistencyScore',
  ],
}

export function buildVoiceProfilePrompt(
  handle: string,
  transcripts: string[],
  captions: string[],
): string {
  const transcriptBlock = transcripts.length
    ? transcripts.map((t, i) => `### Reel ${i + 1} transcript\n${t}`).join('\n\n')
    : '(no spoken transcripts available)'
  const captionBlock = captions.length
    ? captions.map((c, i) => `- ${c}`).join('\n')
    : '(no captions available)'

  return `You are a voice/tone analyst. Study how the creator @${handle} actually talks and writes, then distil a reusable VOICE PROFILE that someone could use to rewrite ANY script so it sounds like @${handle}.

Focus on HOW they communicate, not WHAT topics they cover:

1. **vocabulary** — signature words, phrases, slang, filler, or jargon they reuse (verbatim where possible).
2. **formality** — one phrase placing them on the casual↔polished axis.
3. **sentenceRhythm** — pacing: short punchy lines vs long flowing ones; typical opener length.
4. **audienceAddress** — do they say "you", "we", "guys", third person? How intimate/direct?
5. **toneDescriptors** — 3-6 adjectives for their overall vibe.
6. **hookHabits** — 3-5 recurring ways they OPEN a reel (templated, e.g. "POV: you just…").
7. **emotionalRegister** — the primary emotions and any arc (e.g. humour → urgency → reassurance).
8. **structuralPattern** — their usual hook → body → CTA shape, in one or two sentences.
9. **personaConsistencyScore** — 1-10: how consistent the voice is across the samples (10 = identical persona every reel).

## Spoken transcripts

${transcriptBlock}

## Captions

${captionBlock}

Return only valid JSON matching the schema. Do not add commentary outside the JSON.`
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

/** Coerce raw LLM output + attach code-owned fields. Never throws on bad shapes. */
export function parseVoiceProfile(
  raw: unknown,
  attach: { handle: string; displayName: string; reelCount: number; builtAt: number; fromScripts: boolean },
): VoiceProfile {
  const r = (raw ?? {}) as Record<string, unknown>
  const scoreNum = Number(r.personaConsistencyScore)
  const personaConsistencyScore = Number.isFinite(scoreNum)
    ? Math.min(10, Math.max(1, Math.round(scoreNum)))
    : 5
  return {
    ...attach,
    vocabulary: strArr(r.vocabulary),
    formality: str(r.formality),
    sentenceRhythm: str(r.sentenceRhythm),
    audienceAddress: str(r.audienceAddress),
    toneDescriptors: strArr(r.toneDescriptors),
    hookHabits: strArr(r.hookHabits),
    emotionalRegister: str(r.emotionalRegister),
    structuralPattern: str(r.structuralPattern),
    personaConsistencyScore,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/ai/prompts/voiceProfile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompts/voiceProfile.ts src/ai/prompts/voiceProfile.test.ts
git commit -m "feat(repurpose): add VoiceProfile prompt + schema + guard"
```

---

## Task 3: ReelRewrite prompt module

**Files:**
- Create: `src/ai/prompts/reelRewrite.ts`
- Test: `src/ai/prompts/reelRewrite.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/ai/prompts/reelRewrite.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/ai/prompts/reelRewrite.ts
/**
 * Reel Rewrite — prompt + schema + type for repurposing a source reel into a client's voice.
 *
 * Takes the source reel's structure (SingleReelResult: transcript, segments, visual_beats,
 * markdown case study) plus a VoiceProfile, and produces a full shoot-ready package in the
 * client's voice. Pure text-in/text-out — runs through callGeminiWithSchema / /api/gemini.
 */

import type { SingleReelResult } from '../../store/singleReelStore'
import type { VoiceProfile } from './voiceProfile'

export const REEL_REWRITE_PROMPT_VERSION = 1

export interface ReelRewriteResult {
  spokenHook: string
  beatScript: Array<{ beatLabel: string; script: string; onScreenText: string }>
  caption: string
  cta: string
  onScreenText: string[]
  altHooks: string[]
}

export const REEL_REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    spokenHook: { type: 'string' },
    beatScript: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          beatLabel: { type: 'string' },
          script: { type: 'string' },
          onScreenText: { type: 'string' },
        },
        required: ['beatLabel', 'script', 'onScreenText'],
      },
    },
    caption: { type: 'string' },
    cta: { type: 'string' },
    onScreenText: { type: 'array', items: { type: 'string' } },
    altHooks: { type: 'array', items: { type: 'string' } },
  },
  required: ['spokenHook', 'beatScript', 'caption', 'cta', 'onScreenText', 'altHooks'],
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
    `- Structural pattern: ${v.structuralPattern || '—'}`,
  ].join('\n')
}

function beatsBlock(source: SingleReelResult): string {
  const beats = source.videoAnalysis?.visual_beats ?? []
  if (!beats.length) return '(no beat breakdown available — preserve the transcript order)'
  return beats
    .map((b, i) => `Beat ${i + 1} [${b.function || 'beat'}] (${b.t_start ?? '?'}–${b.t_end ?? '?'}s): on-screen "${b.on_screen || ''}"`)
    .join('\n')
}

export function buildReelRewritePrompt(source: SingleReelResult, voice: VoiceProfile): string {
  const verbatimHook = source.segments?.[0]?.text ?? source.transcript.slice(0, 120)
  return `You are a short-form scriptwriter. Repurpose a viral reel so it sounds like the creator @${voice.handle}, while KEEPING the source reel's structure that made it work.

## SOURCE reel structure (preserve this skeleton)

Verbatim spoken hook: "${verbatimHook}"

Beat breakdown:
${beatsBlock(source)}

Full transcript:
${source.transcript}

Hook / pacing / CTA analysis:
${source.markdown}

## TARGET voice — @${voice.handle}

${voiceBlock(voice)}

## Rules

- Preserve the source's beat structure EXACTLY: same number of beats, same beat functions, same CTA placement.
- Replace ONLY the words and energy so they match @${voice.handle}'s voice. NEVER copy the source's wording.
- Every line must pass the test: "Could @${voice.handle} have said this?"
- spokenHook: the rewritten opening line (verbatim, ready to say to camera).
- beatScript: one entry per source beat — beatLabel (its function), script (what they say), onScreenText (the overlay).
- caption: an Instagram caption in their voice.
- cta: a single call-to-action in their voice.
- onScreenText: 2-5 punchy overlay lines for the whole reel.
- altHooks: exactly 3 ALTERNATIVE opening hooks in their voice, for A/B testing.

Return only valid JSON matching the schema. Do not add commentary outside the JSON.`
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

/** Coerce raw LLM output; guarantees exactly 3 altHooks. Never throws. */
export function parseReelRewrite(raw: unknown): ReelRewriteResult {
  const r = (raw ?? {}) as Record<string, unknown>
  const beatScript = Array.isArray(r.beatScript)
    ? (r.beatScript as unknown[])
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map((b) => ({
          beatLabel: str(b.beatLabel, 'Beat'),
          script: str(b.script),
          onScreenText: str(b.onScreenText),
        }))
    : []
  const hooks = strArr(r.altHooks).slice(0, 3)
  while (hooks.length < 3) hooks.push('')
  return {
    spokenHook: str(r.spokenHook),
    beatScript,
    caption: str(r.caption),
    cta: str(r.cta),
    onScreenText: strArr(r.onScreenText),
    altHooks: hooks,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/ai/prompts/reelRewrite.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompts/reelRewrite.ts src/ai/prompts/reelRewrite.test.ts
git commit -m "feat(repurpose): add ReelRewrite prompt + schema + guard"
```

---

## Task 4: CorpusRepository voice-profile methods

**Files:**
- Modify: `src/lib/corpus.ts` (interface + any in-memory implementer)
- Modify: `src/lib/supabaseCorpus.ts` (Supabase implementation)

- [ ] **Step 1: Find every CorpusRepository implementer**

Run: `grep -rn "CorpusRepository" src/`
Expected: the interface in `src/lib/corpus.ts`, the implementation object in `src/lib/supabaseCorpus.ts` (`const repo: CorpusRepository = {`), and possibly an in-memory implementation (e.g. `createInMemoryCorpus`) used in tests. You must add the three new methods to EVERY object typed as `CorpusRepository`, or `bun run typecheck` fails.

- [ ] **Step 2: Add the methods to the interface**

In `src/lib/corpus.ts`, add a type import near the top:

```ts
import type { VoiceProfile } from '../ai/prompts/voiceProfile'
```

Add to the `CorpusRepository` interface (after `clear(): Promise<void>`):

```ts
  /** Upsert a client voice profile (Repurpose Reel). Keyed by handle; re-build overwrites. */
  upsertVoiceProfile(handle: string, profile: VoiceProfile): Promise<void>
  /** Load one voice profile by handle, or undefined if none. */
  getVoiceProfile(handle: string): Promise<VoiceProfile | undefined>
  /** All voice profiles, most-recently-updated first (the Memory Voices tab feed). */
  listVoiceProfiles(): Promise<VoiceProfile[]>
```

- [ ] **Step 3: Implement in supabaseCorpus.ts**

In `src/lib/supabaseCorpus.ts`, ensure `getClerkUserId` is imported (the file already imports from `clerkToken` for the feedback path; add `getClerkUserId` if not present):

```ts
import { getClerkUserId } from './clerkToken'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'
```

Add these three methods inside the `const repo: CorpusRepository = { ... }` object (e.g. after `setFeedback`):

```ts
    async upsertVoiceProfile(handle: string, profile: VoiceProfile) {
      // owner_user_id must equal the Clerk sub for the INSERT RLS check; guard null so a
      // signed-out write fails loudly instead of hitting a NOT NULL / RLS violation.
      const userId = await getClerkUserId()
      if (!userId) throw new Error('Sign in to save voice profiles.')
      const { error } = await supabase
        .from('corpus_voice_profiles')
        .upsert(
          {
            handle,
            owner_user_id: userId,
            display_name: profile.displayName,
            voice_data: profile,
            reel_count: profile.reelCount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'handle' },
        )
      if (error) throw error
    },

    async getVoiceProfile(handle: string) {
      const { data, error } = await supabase
        .from('corpus_voice_profiles')
        .select('voice_data')
        .eq('handle', handle)
        .maybeSingle()
      if (error) throw error
      return data ? ((data as { voice_data: VoiceProfile }).voice_data) : undefined
    },

    async listVoiceProfiles() {
      const { data, error } = await supabase
        .from('corpus_voice_profiles')
        .select('voice_data')
        .order('updated_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as { voice_data: VoiceProfile }[]).map((r) => r.voice_data)
    },
```

- [ ] **Step 4: Implement in any in-memory implementer (if Step 1 found one)**

If `src/lib/corpus.ts` (or a test helper) has an in-memory `CorpusRepository`, add a Map-backed implementation so the interface is satisfied:

```ts
  // near the in-memory repo's other state:
  const voiceProfiles = new Map<string, VoiceProfile>()
  // ...inside the returned object:
  async upsertVoiceProfile(handle, profile) { voiceProfiles.set(handle, profile) },
  async getVoiceProfile(handle) { return voiceProfiles.get(handle) },
  async listVoiceProfiles() { return [...voiceProfiles.values()] },
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no "Property 'upsertVoiceProfile' is missing" errors).

- [ ] **Step 6: Commit**

```bash
git add src/lib/corpus.ts src/lib/supabaseCorpus.ts
git commit -m "feat(repurpose): add voice-profile methods to CorpusRepository"
```

---

## Task 5: corpusStore voice-profile state

**Files:**
- Modify: `src/store/corpusStore.ts`
- Test: `src/store/corpusStore.voiceProfiles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/store/corpusStore.voiceProfiles.test.ts
import { describe, it, expect } from 'vitest'
import { makeCorpusStore } from './corpusStore'
import type { CorpusRepository } from '../lib/corpus'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'

const PROFILE: VoiceProfile = {
  handle: 'aanya', displayName: 'Aanya', fromScripts: false, vocabulary: [], formality: '',
  sentenceRhythm: '', audienceAddress: '', toneDescriptors: [], hookHabits: [],
  emotionalRegister: '', structuralPattern: '', personaConsistencyScore: 5, reelCount: 8, builtAt: 1,
}

function fakeRepo(): CorpusRepository {
  const profiles = new Map<string, VoiceProfile>([['aanya', PROFILE]])
  return {
    remember: async () => [], get: async () => undefined, getMany: async () => [],
    setFeedback: async () => undefined, list: async () => [], count: async () => 0,
    rememberContent: async () => {}, listContentFor: async () => [], listAllContent: async () => [],
    clear: async () => {},
    upsertVoiceProfile: async (h, p) => { profiles.set(h, p) },
    getVoiceProfile: async (h) => profiles.get(h),
    listVoiceProfiles: async () => [...profiles.values()],
  }
}

describe('corpusStore voice profiles', () => {
  it('hydrate loads voice profiles into the store map', async () => {
    const useStore = makeCorpusStore(fakeRepo())
    await useStore.getState().hydrate()
    expect(useStore.getState().voiceProfiles.aanya?.displayName).toBe('Aanya')
  })

  it('setVoiceProfile writes through the repo and mirrors into the map', async () => {
    const useStore = makeCorpusStore(fakeRepo())
    await useStore.getState().hydrate()
    await useStore.getState().setVoiceProfile('bhavna', { ...PROFILE, handle: 'bhavna', displayName: 'Bhavna' })
    expect(useStore.getState().voiceProfiles.bhavna?.displayName).toBe('Bhavna')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/store/corpusStore.voiceProfiles.test.ts`
Expected: FAIL — `voiceProfiles` / `setVoiceProfile` undefined.

- [ ] **Step 3: Extend the store**

In `src/store/corpusStore.ts`:

Add the import:

```ts
import type { VoiceProfile } from '../ai/prompts/voiceProfile'
```

Add a key-by helper near `keyBy`:

```ts
function keyVoiceProfiles(profiles: VoiceProfile[]): Record<string, VoiceProfile> {
  const map: Record<string, VoiceProfile> = {}
  for (const p of profiles) map[p.handle] = p
  return map
}
```

Add to the `CorpusState` interface:

```ts
  voiceProfiles: Record<string, VoiceProfile>
  setVoiceProfile: (handle: string, profile: VoiceProfile) => Promise<void>
```

In `makeCorpusStore`, add `voiceProfiles: {},` to the initial state object, change `hydrate` to also load profiles, and add `setVoiceProfile`:

```ts
    voiceProfiles: {},
    hydrate: async () => {
      if (get().hydrated) return
      const [slice, total, profiles] = await Promise.all([
        repo.list({ limit: HYDRATION_CAP }),
        repo.count(),
        repo.listVoiceProfiles(),
      ])
      set({ creators: keyBy(slice), count: total, voiceProfiles: keyVoiceProfiles(profiles), hydrated: true })
    },
    setVoiceProfile: async (handle, profile) => {
      await repo.upsertVoiceProfile(handle, profile)
      set({ voiceProfiles: { ...get().voiceProfiles, [handle]: profile } })
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/store/corpusStore.voiceProfiles.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/corpusStore.ts src/store/corpusStore.voiceProfiles.test.ts
git commit -m "feat(repurpose): hydrate + write voice profiles in corpusStore"
```

---

## Task 6: repurposeStore

**Files:**
- Create: `src/store/repurposeStore.ts`
- Test: `src/store/repurposeStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/store/repurposeStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useRepurposeStore, isCleanRepurposeRun } from './repurposeStore'

describe('repurposeStore', () => {
  beforeEach(() => useRepurposeStore.getState().reset())

  it('start sets running state tagged to a conversation', () => {
    useRepurposeStore.getState().start('conv1', 'https://insta/reel/x', 'aanya')
    const s = useRepurposeStore.getState()
    expect(s.status).toBe('building-profile')
    expect(s.conversationId).toBe('conv1')
    expect(s.clientHandle).toBe('aanya')
  })

  it('reset clears back to idle', () => {
    useRepurposeStore.getState().start('conv1', 'u', 'h')
    useRepurposeStore.getState().reset()
    expect(useRepurposeStore.getState().status).toBe('idle')
    expect(useRepurposeStore.getState().conversationId).toBeNull()
  })

  it('isCleanRepurposeRun drops interrupted runs, keeps done runs', () => {
    expect(isCleanRepurposeRun({ status: 'rewriting' })).toBe(false)
    expect(isCleanRepurposeRun({ status: 'building-profile' })).toBe(false)
    expect(isCleanRepurposeRun({ status: 'done' })).toBe(true)
    expect(isCleanRepurposeRun({ status: 'error' })).toBe(true)
    expect(isCleanRepurposeRun({ status: 'idle' })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/store/repurposeStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

```ts
// src/store/repurposeStore.ts
/**
 * Repurpose Reel run state — transient per-run state for the repurpose pipeline.
 *
 * Mirrors reelAnalysisStore: persisted via supabaseStorage, skipHydration, a `merge` guard
 * that drops interrupted runs on restore (so a reload during a run comes back clean). The
 * finished result is snapshotted into the conversation by ChatPage; this store only drives
 * the in-flight progress block.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabaseStorage } from './supabaseStorage'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

export type RepurposeStatus =
  | 'idle' | 'building-profile' | 'analyzing-source' | 'rewriting' | 'done' | 'error'

/** True when a persisted run is safe to restore (terminal), false mid-flight. */
export function isCleanRepurposeRun(s: { status: string }): boolean {
  return s.status === 'done' || s.status === 'error' || s.status === 'idle'
}

interface RepurposeState {
  status: RepurposeStatus
  conversationId: string | null
  sourceReelUrl: string
  clientHandle: string
  voiceProfile: VoiceProfile | null
  rewrite: ReelRewriteResult | null
  error: string | null
  start: (conversationId: string, sourceReelUrl: string, clientHandle: string) => void
  setStatus: (status: RepurposeStatus) => void
  setVoiceProfile: (profile: VoiceProfile) => void
  setRewrite: (rewrite: ReelRewriteResult) => void
  setError: (message: string) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as RepurposeStatus,
  conversationId: null as string | null,
  sourceReelUrl: '',
  clientHandle: '',
  voiceProfile: null as VoiceProfile | null,
  rewrite: null as ReelRewriteResult | null,
  error: null as string | null,
}

export const useRepurposeStore = create<RepurposeState>()(persist((set) => ({
  ...initialState,
  start: (conversationId, sourceReelUrl, clientHandle) =>
    set({ ...initialState, status: 'building-profile', conversationId, sourceReelUrl, clientHandle }),
  setStatus: (status) => set({ status }),
  setVoiceProfile: (voiceProfile) => set({ voiceProfile }),
  setRewrite: (rewrite) => set({ rewrite }),
  setError: (message) => set({ status: 'error', error: message }),
  reset: () => set(initialState),
}), {
  name: 'contentos-repurpose',
  storage: supabaseStorage,
  skipHydration: true,
  partialize: (s) => ({
    status: s.status,
    conversationId: s.conversationId,
    sourceReelUrl: s.sourceReelUrl,
    clientHandle: s.clientHandle,
    voiceProfile: s.voiceProfile,
    rewrite: s.rewrite,
  }),
  version: 1,
  migrate: (state) => state,
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<RepurposeState>
    if (!isCleanRepurposeRun({ status: p.status ?? 'idle' })) return current // interrupted → clean slate
    return { ...current, ...p }
  },
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/store/repurposeStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/repurposeStore.ts src/store/repurposeStore.test.ts
git commit -m "feat(repurpose): add repurposeStore with interrupted-run guard"
```

---

## Task 7: RepurposeResultPayload in the domain types

**Files:**
- Modify: `src/domain/chat.ts`
- Test: `src/domain/chat.repurpose.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/domain/chat.repurpose.test.ts`
Expected: FAIL — `'"repurpose"' is not assignable` / `RepurposeResultPayload` not exported.

- [ ] **Step 3: Edit `src/domain/chat.ts`**

Add the imports (top of file, with the other type imports):

```ts
import type { VoiceProfile } from '../ai/prompts/voiceProfile'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'
```

Add the payload type (next to `ReelResultPayload`):

```ts
export type RepurposeResultPayload = {
  kind: 'repurpose'
  sourceReelUrl: string
  clientHandle: string
  voiceProfile: VoiceProfile
  rewrite: ReelRewriteResult
}
```

Extend the union:

```ts
export type ResultPayload =
  | CompetitorResultPayload
  | DiscoveryResultPayload
  | ReelResultPayload
  | RepurposeResultPayload
```

Add `'repurpose'` to the `ChatMessage.type` union:

```ts
  type?: 'text' | 'options' | 'error' | 'result' | 'reel' | 'single-reel' | 'repurpose'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/domain/chat.repurpose.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/chat.ts src/domain/chat.repurpose.test.ts
git commit -m "feat(repurpose): add RepurposeResultPayload result kind"
```

---

## Task 8: useRepurposeReel pipeline hook

**Files:**
- Create: `src/hooks/useRepurposeReel.ts`
- Test: `src/hooks/repurposeHelpers.test.ts`
- (helper module) Create: `src/lib/repurposeHelpers.ts`

> The orchestrator is I/O wiring mirroring `useSingleReelAnalysis` + `useReelAnalysis`; its pure bits (scripts sanitize/cap + the synthetic key) are extracted into `repurposeHelpers.ts` and unit-tested.

- [ ] **Step 1: Write the failing test for the pure helpers**

```ts
// src/hooks/repurposeHelpers.test.ts
import { describe, it, expect } from 'vitest'
import { prepareScriptCorpus, scriptsProfileKey } from '../lib/repurposeHelpers'

describe('repurposeHelpers', () => {
  it('prepareScriptCorpus trims, drops empties, and caps total length at 4000 chars', () => {
    const out = prepareScriptCorpus(['  hi  ', '', 'x'.repeat(5000)])
    expect(out).toContain('hi')
    expect(out.length).toBeLessThanOrEqual(4000)
  })

  it('scriptsProfileKey is stable for the same scripts and prefixed', () => {
    const a = scriptsProfileKey(['one', 'two'])
    const b = scriptsProfileKey(['one', 'two'])
    expect(a).toBe(b)
    expect(a.startsWith('__scripts__')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/hooks/repurposeHelpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure helpers**

```ts
// src/lib/repurposeHelpers.ts
/** Pure helpers for the repurpose pipeline (kept out of the hook so they're unit-testable). */

const SCRIPT_CORPUS_CAP = 4000

/** Join + sanitize pasted scripts into one prompt-safe corpus, capped to avoid prompt bloat. */
export function prepareScriptCorpus(scripts: string[]): string {
  const joined = scripts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('\n\n---\n\n')
  return joined.slice(0, SCRIPT_CORPUS_CAP)
}

/** Stable, prefixed key for a pasted-scripts profile (same scripts → same key → reuse). */
export function scriptsProfileKey(scripts: string[]): string {
  const s = scripts.join('')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `__scripts__${(h >>> 0).toString(36)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/hooks/repurposeHelpers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the orchestrator hook (no separate unit test — covered by typecheck + the agent eval in Task 9 + manual verification)**

```ts
// src/hooks/useRepurposeReel.ts
/**
 * Repurpose Reel orchestration — the chat-triggered "rewrite a viral reel in a client's voice" path.
 *
 *   Stage 1  build/load the client VoiceProfile (cache → corpus → scrape+transcribe+synthesize)
 *   Stage 2  deep-analyze the SOURCE reel via /api/analyze-single-reel (cache-first)
 *   Stage 3  one Gemini rewrite call → full package + 3 hook variants
 *
 * Mirrors useSingleReelAnalysis/useReelAnalysis: keys from useKeysStore, the run's AbortSignal
 * is supplied by the agent loop (latest-wins), user-safe error strings only. Writes run state to
 * repurposeStore; ChatPage snapshots the finished result into the conversation.
 */

import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useConversationsStore } from '../store/conversationsStore'
import { useCorpusStore } from '../store/corpusStore'
import { useRepurposeStore } from '../store/repurposeStore'
import { scrapeTopReels, NoReelsError } from '../lib/reelScraper'
import { transcribeReels } from '../lib/reelTranscriber'
import { scrapeSingleReel } from '../lib/singleReelClient'
import { getCachedSingleReel, setCachedSingleReel } from '../lib/singleReelCache'
import { getClerkSessionToken } from '../lib/clerkToken'
import { parseReelUrl } from '../lib/reelUrl'
import { callGeminiWithSchema } from '../ai/gemini'
import { devWarn } from '../lib/devLog'
import {
  buildVoiceProfilePrompt, parseVoiceProfile, VOICE_PROFILE_SCHEMA, type VoiceProfile, type VoiceProfileDraft,
} from '../ai/prompts/voiceProfile'
import {
  buildReelRewritePrompt, parseReelRewrite, REEL_REWRITE_SCHEMA, type ReelRewriteResult,
} from '../ai/prompts/reelRewrite'
import { prepareScriptCorpus, scriptsProfileKey } from '../lib/repurposeHelpers'
import type { SingleReelResult } from '../store/singleReelStore'

const PROFILE_REEL_COUNT = 8

export interface RepurposeArgs {
  sourceReelUrl: string
  shortCode?: string
  clientHandle?: string
  pastedScripts?: string[]
}

export function useRepurposeReel() {
  const { apifyKeys, geminiKeys } = useKeysStore()

  /** Deep-analyze ONE source reel → SingleReelResult (mirrors useSingleReelAnalysis body). */
  const analyzeSource = useCallback(
    async (sourceReelUrl: string, signal?: AbortSignal): Promise<SingleReelResult> => {
      const parsed = parseReelUrl(sourceReelUrl)
      if (!parsed) throw new Error("That doesn't look like an Instagram reel link.")
      const { shortCode, canonicalUrl } = parsed

      const cached = await getCachedSingleReel(shortCode)
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      if (cached) return cached

      const reel = await scrapeSingleReel(canonicalUrl, apifyKeys, signal)
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const reqBody = JSON.stringify({
        downloadedVideoUrl: reel.downloadedVideoUrl,
        shortCode: reel.shortCode,
        apify: {
          ownerUsername: reel.ownerUsername, caption: reel.caption, likesCount: reel.likesCount,
          commentsCount: reel.commentsCount, videoViewCount: reel.videoViewCount,
          videoDuration: reel.videoDuration, hashtags: reel.hashtags, timestamp: reel.timestamp,
          musicInfo: reel.musicInfo,
        },
      })
      const post = async (): Promise<Response> => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const token = await getClerkSessionToken()
        if (token) headers['Authorization'] = `Bearer ${token}`
        return fetch('/api/analyze-single-reel', { method: 'POST', headers, body: reqBody, signal })
      }
      let res = await post()
      if (res.status === 401) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
        res = await post()
      }
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      if (!res.ok) {
        let detail = ''
        try { detail = await res.clone().text() } catch { /* ignore */ }
        devWarn('[repurpose] /api/analyze-single-reel failed', res.status, detail)
        throw new Error('Could not analyse the source reel.')
      }
      const json = (await res.json()) as { result: SingleReelResult }
      void setCachedSingleReel(shortCode, json.result)
      return json.result
    },
    [apifyKeys],
  )

  /** Build (or reuse) the client's voice profile. */
  const buildVoiceProfile = useCallback(
    async (args: RepurposeArgs, signal?: AbortSignal): Promise<VoiceProfile> => {
      const handle = args.clientHandle?.trim().toLowerCase()
      const scripts = (args.pastedScripts ?? []).filter((s) => s.trim().length > 0)

      // Reuse a saved profile when we have a handle and it's already in the corpus mirror.
      if (handle) {
        const existing = useCorpusStore.getState().voiceProfiles[handle]
        if (existing) return existing
      }

      // Pasted-scripts path: no scrape; key by a stable synthetic id (renameable in Memory).
      if (!handle && scripts.length > 0) {
        const key = scriptsProfileKey(scripts)
        const existing = useCorpusStore.getState().voiceProfiles[key]
        if (existing) return existing
        const draft = await callGeminiWithSchema<VoiceProfileDraft>(
          geminiKeys,
          buildVoiceProfilePrompt(key.replace('__scripts__', 'pasted-'), [prepareScriptCorpus(scripts)], []),
          VOICE_PROFILE_SCHEMA,
          { temperature: 0.2, thinkingBudget: 2000, signal },
        )
        const profile = parseVoiceProfile(draft, {
          handle: key, displayName: 'Pasted voice', reelCount: 0, builtAt: Date.now(), fromScripts: true,
        })
        await useCorpusStore.getState().setVoiceProfile(key, profile)
        return profile
      }

      if (!handle) throw new Error('Tell me which client to repurpose this for (an @handle or a few of their scripts).')

      // Handle path: scrape + transcribe + synthesize.
      let reels
      try {
        reels = await scrapeTopReels(handle, PROFILE_REEL_COUNT, apifyKeys, signal)
      } catch (err) {
        if (err instanceof NoReelsError) {
          if (scripts.length > 0) {
            const draft = await callGeminiWithSchema<VoiceProfileDraft>(
              geminiKeys, buildVoiceProfilePrompt(handle, [prepareScriptCorpus(scripts)], []),
              VOICE_PROFILE_SCHEMA, { temperature: 0.2, thinkingBudget: 2000, signal },
            )
            const profile = parseVoiceProfile(draft, {
              handle, displayName: `@${handle}`, reelCount: 0, builtAt: Date.now(), fromScripts: true,
            })
            await useCorpusStore.getState().setVoiceProfile(handle, profile)
            return profile
          }
          throw new Error(`@${handle} has no public reels — paste 2-3 of their scripts instead.`)
        }
        throw err
      }
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

      const transcriptMap = await transcribeReels(handle, reels, apifyKeys, signal)
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const transcripts = reels.map((r) => transcriptMap[r.shortCode]).filter((t): t is string => !!t)
      const captions = reels.map((r) => r.caption).filter((c) => !!c)

      const draft = await callGeminiWithSchema<VoiceProfileDraft>(
        geminiKeys, buildVoiceProfilePrompt(handle, transcripts, captions),
        VOICE_PROFILE_SCHEMA, { temperature: 0.2, thinkingBudget: 2000, signal },
      )
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const profile = parseVoiceProfile(draft, {
        handle, displayName: `@${handle}`, reelCount: reels.length, builtAt: Date.now(), fromScripts: false,
      })
      await useCorpusStore.getState().setVoiceProfile(handle, profile)
      return profile
    },
    [apifyKeys, geminiKeys],
  )

  const startRepurpose = useCallback(
    async (args: RepurposeArgs, signal?: AbortSignal) => {
      const store = useRepurposeStore.getState()
      const conversationId = useConversationsStore.getState().activeId
      const clientKey = args.clientHandle?.trim().toLowerCase()
        || (args.pastedScripts?.length ? scriptsProfileKey(args.pastedScripts) : '')
      store.start(conversationId, args.sourceReelUrl, clientKey)

      try {
        // Stage 1
        const profile = await buildVoiceProfile(args, signal)
        if (signal?.aborted) return
        useRepurposeStore.getState().setVoiceProfile(profile)
        useRepurposeStore.getState().setStatus('analyzing-source')

        // Stage 2
        const source = await analyzeSource(args.sourceReelUrl, signal)
        if (signal?.aborted) return
        useRepurposeStore.getState().setStatus('rewriting')

        // Stage 3
        const raw = await callGeminiWithSchema<ReelRewriteResult>(
          geminiKeys, buildReelRewritePrompt(source, profile),
          REEL_REWRITE_SCHEMA, { temperature: 0.7, thinkingBudget: 3000, signal },
        )
        if (signal?.aborted) return
        useRepurposeStore.getState().setRewrite(parseReelRewrite(raw))
        useRepurposeStore.getState().setStatus('done')
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === 'AbortError') return
        devWarn('[repurpose] run failed', err)
        useRepurposeStore.getState().setError((err as Error)?.message || 'Could not repurpose this reel.')
      }
    },
    [analyzeSource, buildVoiceProfile, geminiKeys],
  )

  return { startRepurpose }
}
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (If `scrapeSingleReel`'s return type lacks any referenced field, open `src/lib/singleReelClient.ts` and match the field names exactly — they should mirror `useSingleReelAnalysis.ts`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/repurposeHelpers.ts src/hooks/repurposeHelpers.test.ts src/hooks/useRepurposeReel.ts
git commit -m "feat(repurpose): add useRepurposeReel pipeline hook"
```

---

## Task 9: Register the `repurpose_reel` agent tool (TDD via eval)

**Files:**
- Modify: `src/tools/agentTools.ts`
- Test: `src/ai/agentLoop.eval.test.ts`

- [ ] **Step 1: Add the failing eval cases**

In `src/ai/agentLoop.eval.test.ts`, add `'repurpose_reel'` to the `EvalCase.expect.dispatchName` union:

```ts
    dispatchName?: 'discover_competitors' | 'discover_by_location' | 'analyze_reels' | 'analyze_single_reel' | 'repurpose_reel'
```

Add two cases to the `CASES` array:

```ts
  {
    label: 'repurpose: url + client handle → dispatch',
    messages: [{ role: 'user', content: 'Repurpose https://www.instagram.com/reel/Cabc123/ for @aanya' }],
    expect: { type: 'dispatch', dispatchName: 'repurpose_reel' },
  },
  {
    label: 'repurpose: url with no client → ask, never guess a handle',
    messages: [{ role: 'user', content: 'Repurpose https://www.instagram.com/reel/Cabc123/' }],
    expect: { type: 'ask' },
  },
```

- [ ] **Step 2: Run the eval to verify it fails**

Run: `bunx vitest run src/ai/agentLoop.eval.test.ts`
Expected: FAIL — the model can't dispatch a tool that doesn't exist yet (and/or the union type errors).

- [ ] **Step 3: Register the tool in `src/tools/agentTools.ts`**

Add to `AgentToolName`:

```ts
  | 'repurpose_reel'
```

Add to the `AgentAction` dispatch member's name union:

```ts
  | { type: 'dispatch'; name: 'discover_competitors' | 'discover_by_location' | 'analyze_reels' | 'analyze_single_reel' | 'repurpose_reel'; args: Record<string, unknown> }
```

Add the tool entry to `TOOL_REGISTRY` (next to `analyze_single_reel`):

```ts
  repurpose_reel: {
    description:
      'Repurpose/rewrite a specific viral reel (given its URL) into a CLIENT\'s voice/tone. Use when the user gives a reel URL AND a client to rewrite it for (an @handle, or pasted scripts). Produces a full script package in the client\'s voice. NOT for plain analysis (use analyze_single_reel) and NOT for finding creators.',
    parameters: {
      type: 'object',
      properties: {
        sourceReelUrl: { type: 'string', description: 'The viral reel URL to repurpose (a /reel/, /reels/ or /p/ link).' },
        clientHandle: { type: 'string', description: 'The client @handle whose voice to rewrite into. Omit only if the user pasted the client\'s scripts instead.' },
        pastedScripts: { type: 'array', items: { type: 'string' }, description: 'Optional: 2-3 of the client\'s existing scripts/captions, used when no @handle is given.' },
      },
      required: ['sourceReelUrl'],
    },
    schema: z
      .object({
        sourceReelUrl: z.string().min(1),
        clientHandle: z.string().optional(),
        pastedScripts: z.array(z.string()).optional(),
      })
      .transform((d) => {
        const parsed = parseReelUrl(d.sourceReelUrl)
        const clientHandle = d.clientHandle ? normalizeHandles([d.clientHandle])[0] : undefined
        return {
          sourceReelUrl: parsed ? parsed.canonicalUrl : '',
          shortCode: parsed ? parsed.shortCode : '',
          clientHandle,
          pastedScripts: d.pastedScripts ?? [],
        }
      })
      .refine((d) => d.shortCode.length > 0, { message: 'a valid Instagram reel URL is required', path: ['sourceReelUrl'] })
      .refine((d) => !!d.clientHandle || d.pastedScripts.length > 0, {
        message: 'a client @handle or pasted scripts are required', path: ['clientHandle'],
      }),
    toAction: (args) => ({ type: 'dispatch', name: 'repurpose_reel', args }),
  },
```

Add a routing line to `AGENT_SYSTEM_PROMPT` (after the `analyze_single_reel` line):

```
- repurpose_reel: rewrite a specific viral reel into a CLIENT's voice. Use when the user gives a reel URL AND names a client to repurpose it for (an @handle, or pasted scripts). If a reel URL is present but NO client is named, ask which client (do NOT guess a handle).
```

> Confirm `parseReelUrl` is already imported in `agentTools.ts` (it is — used by `analyze_single_reel`). `normalizeHandles` is defined in the same file.

- [ ] **Step 4: Run the eval to verify it passes**

Run: `bunx vitest run src/ai/agentLoop.eval.test.ts`
Expected: PASS (including the two new cases). Also run `bunx vitest run src/tools/agentTools.test.ts` to confirm tool validation still passes.

- [ ] **Step 5: Commit**

```bash
git add src/tools/agentTools.ts src/ai/agentLoop.eval.test.ts
git commit -m "feat(repurpose): register repurpose_reel agent tool + evals"
```

---

## Task 10: Dispatch wiring in useAgentConversation

**Files:**
- Modify: `src/hooks/useAgentConversation.ts`

- [ ] **Step 1: Mount the hook + add the dispatch branch**

Add the import (with the other hook imports near line 26):

```ts
import { useRepurposeReel } from './useRepurposeReel'
```

Instantiate it (near line 48, with the other hooks):

```ts
  const { startRepurpose } = useRepurposeReel()
```

In `dispatchTool`, add this branch (after the `analyze_single_reel` branch, before `discover_by_location`):

```ts
    if (name === 'repurpose_reel') {
      const clientHandle = args.clientHandle ? `@${String(args.clientHandle)}` : 'this client'
      addMessage({
        role: 'assistant',
        type: 'repurpose',
        content: `Repurposing this reel for ${clientHandle}…`,
      })
      startRepurpose(
        {
          sourceReelUrl: String(args.sourceReelUrl ?? ''),
          shortCode: args.shortCode ? String(args.shortCode) : undefined,
          clientHandle: args.clientHandle ? String(args.clientHandle) : undefined,
          pastedScripts: Array.isArray(args.pastedScripts) ? (args.pastedScripts as string[]) : [],
        },
        signal,
      )
      return
    }
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAgentConversation.ts
git commit -m "feat(repurpose): dispatch repurpose_reel from the agent loop"
```

---

## Task 11: PIPELINE_REGISTRY entry

**Files:**
- Modify: `src/tools/registry.ts`

- [ ] **Step 1: Add the steps + entry**

Near the other `*Steps` consts in `src/tools/registry.ts`:

```ts
const repurposeSteps = [
  'Building the client voice profile',
  'Analyzing the source reel',
  'Rewriting in the client voice',
]
```

Add to `PIPELINE_REGISTRY`:

```ts
  repurpose: {
    id: 'repurpose',
    name: 'Repurpose Reel',
    steps: repurposeSteps,
  },
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tools/registry.ts
git commit -m "feat(repurpose): add repurpose entry to PIPELINE_REGISTRY"
```

---

## Task 12: RepurposeResultMessage component

**Files:**
- Create: `src/components/RepurposeResultMessage.tsx`

> Reads DESIGN.md tokens: background `#1A1410`, surfaces like `#3D3025`, accent saffron `#E07B3A`, AI-content violet `#A78BFA`. No Inter/slate/indigo. Match the structure/styling of `ReelResultMessage.tsx` (open it for the exact class conventions).

- [ ] **Step 1: Write the component**

```tsx
// src/components/RepurposeResultMessage.tsx
/**
 * Inline renderer for a finished repurpose run (kind:'repurpose'). Renders the full package —
 * spoken hook + 3 alt hooks, beat-by-beat script, caption, CTA, on-screen text — with per-section
 * copy buttons, plus a collapsed voice-profile mini-card linking to the Memory Voices tab.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { RepurposeResultPayload } from '../domain/chat'

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}
      className="text-xs px-2 py-1 rounded-md border border-[rgba(245,237,214,0.12)] text-muted hover:text-primary hover:border-[#E07B3A] transition-colors"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function Section({ title, body, copy }: { title: string; body: React.ReactNode; copy?: string }) {
  return (
    <div className="rounded-lg bg-[#3D3025] border border-[rgba(245,237,214,0.08)] p-3">
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-sm font-medium text-primary">{title}</h4>
        {copy !== undefined && <CopyButton text={copy} />}
      </div>
      <div className="text-sm text-secondary whitespace-pre-wrap">{body}</div>
    </div>
  )
}

export default function RepurposeResultMessage({ payload }: { payload: RepurposeResultPayload }) {
  const { voiceProfile: v, rewrite: r } = payload
  const fullScript = [
    r.spokenHook,
    ...r.beatScript.map((b) => `[${b.beatLabel}] ${b.script}${b.onScreenText ? `  (on-screen: ${b.onScreenText})` : ''}`),
    r.cta,
  ].join('\n\n')

  return (
    <div className="my-2 space-y-3">
      <div className="text-xs text-muted">
        Repurposed in <span className="text-[#A78BFA]">@{v.handle.replace('__scripts__', 'pasted ')}</span>'s voice
        {' · '}
        <Link to="/memory" className="underline hover:text-primary">edit voice on Memory</Link>
      </div>

      <Section title="Spoken hook" body={r.spokenHook} copy={r.spokenHook} />

      <Section
        title="Alt hooks (A/B)"
        copy={r.altHooks.join('\n')}
        body={<ol className="list-decimal ml-4 space-y-1">{r.altHooks.map((h, i) => <li key={i}>{h}</li>)}</ol>}
      />

      <Section
        title="Beat-by-beat script"
        copy={fullScript}
        body={
          <div className="space-y-2">
            {r.beatScript.map((b, i) => (
              <div key={i}>
                <div className="text-xs text-muted">{b.beatLabel}</div>
                <div>{b.script}</div>
                {b.onScreenText && <div className="text-xs text-[#A78BFA]">on-screen: {b.onScreenText}</div>}
              </div>
            ))}
          </div>
        }
      />

      <Section title="Caption" body={r.caption} copy={r.caption} />
      <Section title="CTA" body={r.cta} copy={r.cta} />
      <Section
        title="On-screen text"
        copy={r.onScreenText.join('\n')}
        body={<ul className="list-disc ml-4 space-y-1">{r.onScreenText.map((t, i) => <li key={i}>{t}</li>)}</ul>}
      />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (If `text-secondary`/`text-muted`/`text-primary` aren't the exact utility names in this project, open `ReelResultMessage.tsx` and copy its color classes verbatim.)

- [ ] **Step 3: Commit**

```bash
git add src/components/RepurposeResultMessage.tsx
git commit -m "feat(repurpose): add RepurposeResultMessage result card"
```

---

## Task 13: ChatPage wiring — progress marker, snapshot, render

**Files:**
- Modify: `src/pages/ChatPage.tsx`

> ChatPage is large; line numbers below are approximate. Mirror the EXISTING discovery snapshot `useEffect` (~lines 269-297) and the single-reel marker render (~line 620) already in this file.

- [ ] **Step 1: Read the store + add a tiny inline progress component**

Add imports near the other store/component imports:

```ts
import { useRepurposeStore } from '../store/repurposeStore'
import RepurposeResultMessage from '../components/RepurposeResultMessage'
import { PIPELINE_REGISTRY } from '../tools/registry'
```

Inside the `ChatPage` component, read the store (with the other store hooks):

```ts
  const repurposeStatus = useRepurposeStore((s) => s.status)
  const repurposeConversationId = useRepurposeStore((s) => s.conversationId)
  const repurposeError = useRepurposeStore((s) => s.error)
  const resetRepurpose = useRepurposeStore((s) => s.reset)
```

Add a ref for the snapshot arm (with the other `*ArmedRef`s):

```ts
  const repurposeArmedRef = useRef(false)
```

- [ ] **Step 2: Add the snapshot useEffect (mirror discovery)**

```ts
  // Snapshot a finished repurpose run into the conversation, then reset the store. Armed only
  // while a real run is live so it fires once. The persisted payload carries everything the
  // result card needs, so it survives reload independent of the (reset) transient store.
  useEffect(() => {
    const running = repurposeStatus === 'building-profile' || repurposeStatus === 'analyzing-source' || repurposeStatus === 'rewriting'
    if (running) {
      repurposeArmedRef.current = true
    } else if (repurposeStatus === 'done' && repurposeArmedRef.current) {
      repurposeArmedRef.current = false
      const s = useRepurposeStore.getState()
      if (s.conversationId && s.voiceProfile && s.rewrite) {
        addMessageTo(s.conversationId, {
          role: 'assistant',
          type: 'result',
          content: `Repurposed in @${s.voiceProfile.handle.replace('__scripts__', 'pasted ')}'s voice.`,
          result: {
            kind: 'repurpose',
            sourceReelUrl: s.sourceReelUrl,
            clientHandle: s.clientHandle,
            voiceProfile: s.voiceProfile,
            rewrite: s.rewrite,
          },
        })
      }
      resetRepurpose()
    } else if (repurposeStatus === 'error' && repurposeArmedRef.current) {
      repurposeArmedRef.current = false
      const s = useRepurposeStore.getState()
      addMessageTo(s.conversationId ?? activeConversationId, {
        role: 'assistant',
        type: 'error',
        content: s.error || 'Could not repurpose this reel.',
      })
      resetRepurpose()
    }
  }, [repurposeStatus, addMessageTo, activeConversationId, resetRepurpose])
```

- [ ] **Step 3: Compute the last repurpose marker id (with the other `last*MarkerId`)**

```ts
  const lastRepurposeMarkerId = [...conversationMessages].reverse().find((m) => m.type === 'repurpose')?.id
```

- [ ] **Step 4: Add render branches**

In the `conversationMessages.map(...)` chain, add a result branch (next to the other `kind` branches):

```tsx
                ) : message.type === 'result' && message.result?.kind === 'repurpose' ? (
                  <RepurposeResultMessage key={message.id} payload={message.result} />
```

And a marker branch (next to the `single-reel` marker branch) that shows live progress while the run is active in this conversation:

```tsx
                ) : message.type === 'repurpose' ? (
                  message.id === lastRepurposeMarkerId
                  && repurposeConversationId === activeConversationId
                  && (repurposeStatus === 'building-profile' || repurposeStatus === 'analyzing-source' || repurposeStatus === 'rewriting' || repurposeStatus === 'error') ? (
                    <div key={message.id} className="my-2 text-sm text-muted flex items-center gap-2">
                      {repurposeStatus === 'error' ? (
                        <span className="text-[#E07B3A]">{repurposeError || 'Could not repurpose this reel.'}</span>
                      ) : (
                        <>
                          <span className="inline-block w-3 h-3 rounded-full border-2 border-[#E07B3A] border-t-transparent animate-spin" />
                          <span>
                            {repurposeStatus === 'building-profile' && PIPELINE_REGISTRY.repurpose.steps[0]}
                            {repurposeStatus === 'analyzing-source' && PIPELINE_REGISTRY.repurpose.steps[1]}
                            {repurposeStatus === 'rewriting' && PIPELINE_REGISTRY.repurpose.steps[2]}
                            …
                          </span>
                        </>
                      )}
                    </div>
                  ) : null
```

> Place these branches BEFORE the final `: (<ChatMessage .../>)` fallback, matching the existing ternary chain shape.

- [ ] **Step 5: Verify in the browser**

Run the dev server and confirm: typing `Repurpose <a real reel URL> for @<a handle>` shows the spinner stepping through the 3 stages, then renders the result card; reloading keeps the result card. Use the preview tools (start server → snapshot/console). Fix any console errors before committing.

- [ ] **Step 6: Typecheck + commit**

Run: `bun run typecheck`

```bash
git add src/pages/ChatPage.tsx
git commit -m "feat(repurpose): wire repurpose progress + result into ChatPage"
```

---

## Task 14: Memory "Voices" tab + VoiceProfileCard (inline edit + rebuild)

**Files:**
- Create: `src/components/VoiceProfileCard.tsx`
- Modify: `src/pages/MemoryPage.tsx`

> Inline-edit pattern + `inputCls` mirror `PaymentClientsManager.tsx`. Any authenticated user may edit/rebuild (locked decision) — no owner gate in the UI.

- [ ] **Step 1: Write VoiceProfileCard**

```tsx
// src/components/VoiceProfileCard.tsx
/**
 * A voice profile on the Memory Voices tab: handle/display name, tone chips, expandable fields,
 * inline editing of the text fields (saved via corpusStore.setVoiceProfile), and a Rebuild
 * button that re-runs the profile build from the client's reels.
 */

import { useState } from 'react'
import { useCorpusStore } from '../store/corpusStore'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'

const inputCls =
  'w-full bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[#E07B3A]'

export default function VoiceProfileCard({ profile, onRebuild }: { profile: VoiceProfile; onRebuild: (handle: string) => void }) {
  const setVoiceProfile = useCorpusStore((s) => s.setVoiceProfile)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<VoiceProfile>(profile)
  const [saving, setSaving] = useState(false)

  const set = (patch: Partial<VoiceProfile>) => setForm((f) => ({ ...f, ...patch }))
  const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

  const save = async () => {
    setSaving(true)
    try { await setVoiceProfile(profile.handle, { ...form, handle: profile.handle }) ; setEditing(false) }
    finally { setSaving(false) }
  }

  if (editing) {
    return (
      <div className="rounded-lg bg-[#2A211B] border border-[rgba(245,237,214,0.08)] p-3 space-y-2">
        <input className={inputCls} value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} placeholder="Display name" />
        <input className={inputCls} value={form.toneDescriptors.join(', ')} onChange={(e) => set({ toneDescriptors: csv(e.target.value) })} placeholder="Tone (comma-separated)" />
        <input className={inputCls} value={form.vocabulary.join(', ')} onChange={(e) => set({ vocabulary: csv(e.target.value) })} placeholder="Vocabulary (comma-separated)" />
        <input className={inputCls} value={form.hookHabits.join(', ')} onChange={(e) => set({ hookHabits: csv(e.target.value) })} placeholder="Hook habits (comma-separated)" />
        <textarea className={inputCls} rows={2} value={form.audienceAddress} onChange={(e) => set({ audienceAddress: e.target.value })} placeholder="Audience address" />
        <textarea className={inputCls} rows={2} value={form.sentenceRhythm} onChange={(e) => set({ sentenceRhythm: e.target.value })} placeholder="Sentence rhythm" />
        <textarea className={inputCls} rows={2} value={form.emotionalRegister} onChange={(e) => set({ emotionalRegister: e.target.value })} placeholder="Emotional register" />
        <textarea className={inputCls} rows={2} value={form.structuralPattern} onChange={(e) => set({ structuralPattern: e.target.value })} placeholder="Structural pattern" />
        <div className="flex gap-2 pt-1">
          <button type="button" disabled={saving} onClick={() => void save()} className="text-sm px-3 py-1.5 rounded-md bg-[#E07B3A] text-[#1A1410] font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={() => { setForm(profile); setEditing(false) }} className="text-sm px-3 py-1.5 rounded-md border border-[rgba(245,237,214,0.12)] text-muted">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-[#2A211B] border border-[rgba(245,237,214,0.08)] p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-primary">{profile.displayName || `@${profile.handle}`}</div>
          <div className="text-xs text-muted">
            {profile.fromScripts ? 'From scripts' : `@${profile.handle}`} · {profile.reelCount} reels · consistency {profile.personaConsistencyScore}/10
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(true)} className="text-xs px-2 py-1 rounded-md border border-[rgba(245,237,214,0.12)] text-muted hover:text-primary hover:border-[#E07B3A]">Edit</button>
          {!profile.fromScripts && (
            <button type="button" onClick={() => onRebuild(profile.handle)} className="text-xs px-2 py-1 rounded-md border border-[rgba(245,237,214,0.12)] text-muted hover:text-primary hover:border-[#E07B3A]">Rebuild</button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {profile.toneDescriptors.map((t, i) => (
          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#3D3025] text-[#A78BFA]">{t}</span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the Voices tab to MemoryPage**

In `src/pages/MemoryPage.tsx`:

Add imports:

```ts
import VoiceProfileCard from '../components/VoiceProfileCard'
```

Add a tab state (with the other `useState`s):

```ts
  const [tab, setTab] = useState<'creators' | 'voices'>('creators')
  const voiceProfiles = useCorpusStore((s) => s.voiceProfiles)
```

Add a tab switcher just above the existing search/filter rows (between the count line and the search `<div>`):

```tsx
      <div className="flex gap-2 mb-3">
        {(['creators', 'voices'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-1.5 rounded-md border ${tab === t ? 'border-[#E07B3A] text-primary' : 'border-[rgba(245,237,214,0.12)] text-muted'}`}
          >
            {t === 'creators' ? 'Creators' : 'Voice Profiles'}
          </button>
        ))}
      </div>
```

Wrap the existing creators content so it only shows on the `creators` tab, and add the voices grid for the `voices` tab. The voices grid:

```tsx
      {tab === 'voices' && (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {Object.values(voiceProfiles).length === 0 ? (
            <p className="text-sm text-muted col-span-full">No voice profiles yet. Repurpose a reel for a client to create one.</p>
          ) : (
            Object.values(voiceProfiles).map((p) => (
              <VoiceProfileCard
                key={p.handle}
                profile={p}
                onRebuild={(handle) => { window.location.href = `/?repurpose=${encodeURIComponent(handle)}` }}
              />
            ))
          )}
        </div>
      )}
```

> Rebuild here just routes the operator back to chat to run a fresh repurpose for that handle (the laziest correct behavior — a rebuild IS a new run). If a deeper "rebuild in place" is wanted later, it becomes a follow-up; do not build it now (YAGNI).

- [ ] **Step 3: Verify in the browser**

Start the dev server, open Memory → Voice Profiles, confirm the empty state renders; after running a repurpose, confirm the card appears, Edit saves changes (reload to confirm persistence), and tone chips use the violet tint. Fix console errors.

- [ ] **Step 4: Typecheck + commit**

Run: `bun run typecheck`

```bash
git add src/components/VoiceProfileCard.tsx src/pages/MemoryPage.tsx
git commit -m "feat(repurpose): add Memory Voices tab + VoiceProfileCard"
```

---

## Task 15: Full verification + docs

**Files:**
- Modify: `CHANGELOG.md`, `VERSION`, `package.json` (version bump per release conventions)

- [ ] **Step 1: Run the full test + build gate**

Run, in order:
- `bun run test` — Expected: all green (incl. the new voiceProfile / reelRewrite / corpusStore / repurposeStore / chat / eval tests).
- `bun run typecheck` — Expected: clean.
- `bun run typecheck:api` — Expected: clean (no api/ changes, but confirm).
- `bun run lint` — Expected: clean (fix any unused-import / a11y nits in the new files).
- `bun run build` — Expected: success.

- [ ] **Step 2: Manual end-to-end (browser)**

Verify the full flow against the spec's user-facing behavior:
1. `Repurpose <reel URL> for @<handle>` → progress → result card with hook, 3 alt hooks, beat script, caption, CTA, on-screen text.
2. `Repurpose <reel URL>` (no client) → agent asks which client (does not invent a handle).
3. Re-running for the same `@handle` reuses the cached profile (fast; no re-scrape).
4. Memory → Voice Profiles shows the profile; Edit + Save persists across reload.

- [ ] **Step 3: Update CHANGELOG + bump version**

Add a CHANGELOG entry under a new version heading describing the Repurpose Reel pipeline, and bump `VERSION` + `package.json` `version` to the same new value (CI checks they match).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md VERSION package.json
git commit -m "chore(repurpose): changelog + version bump for Repurpose Reel"
```

---

## Self-review checklist (done while authoring)

- **Spec coverage:** tone source @handle (Task 8) + pasted-scripts fallback (Task 8) + NoReels fallback (Task 8); full package + 3 hooks (Tasks 3, 12); corpus-saved profiles (Tasks 1, 4, 5); Memory browse + full inline edit + rebuild (Task 14); any-teammate RLS (Task 1); 8 reels (Task 8 `PROFILE_REEL_COUNT`); single-endpoint source (Task 8); conversation-only result persistence (Tasks 7, 13); agent tool + dispatch + registry + eval (Tasks 9, 10, 11); new frozen `kind` (Task 7). All covered.
- **Type consistency:** `VoiceProfile`, `VoiceProfileDraft`, `ReelRewriteResult`, `RepurposeResultPayload`, `RepurposeStatus`, `RepurposeArgs` names are used identically across tasks. `startRepurpose(args, signal)` signature matches the dispatch call.
- **Placeholders:** none — every code step has complete code.
- **Known soft spots (verify against live code while implementing):** exact Tailwind color utility names (`text-primary`/`text-muted`/`text-secondary`) — copy from `ReelResultMessage.tsx` if they differ; the exact field names on `scrapeSingleReel`'s return — copy from `useSingleReelAnalysis.ts`; whether a second in-memory `CorpusRepository` exists (Task 4 Step 1 grep); ChatPage ternary-chain insertion points (mirror the single-reel/discovery branches already there).
