# Script Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated **Script Studio** page that turns a reference short-form video (Instagram Reel or YouTube Short) + a new topic into a shoot-ready script that keeps the reference's structural blueprint, in an optional client voice, in English or Hinglish.

**Architecture:** Transcript-first and unified — both platforms resolve to a transcript, then a single Gemini rewrite (reusing the existing repurpose schema/parser) preserves the reference's beat structure while swapping in the new topic. Instagram reuses the shipped `scrapeSingleReel` → `/api/analyze-single-reel` path verbatim; YouTube adds one small Apify Transcript-Ninja adapter. The chat `repurpose_reel` pipeline is **not modified** except for two additive helper exports.

**Tech Stack:** React 18 + Vite + TypeScript, Zustand (not needed here — page-local state), TanStack Query (not needed here), Apify via the `/api/apify` proxy, Gemini via the `/api/gemini` proxy, vitest, Tailwind with the DESIGN.md token system.

---

## Spike result (already validated — do not re-spike)

The YouTube Transcript-Ninja actor (`topaz_sharingan/Youtube-Transcript-Scraper-1`) was run live during planning:

- **Input that works:** `{ startUrls: [url], timestamps: false }` (bare string array).
- **Output dataset item fields:** `videoUrl, videoId, videoTitle, channelName, views, subscribers, text`.
- **The transcript is the `text` field** — one joined string of the full spoken audio.
- Run took ~9s. Actor ID (with Apify's `~` separator): `topaz_sharingan~Youtube-Transcript-Scraper-1`.

During Task 9, smoke-test one real `/shorts/<id>` URL end-to-end (the item shape is identical to a `watch?v=` URL, only the URL form differs).

## Deviations from the spec (deliberate, lower-risk)

1. **New prompt file `reelRemix.ts` instead of modifying `reelRewrite.ts`.** The existing rewrite prompt is `@handle`-coupled throughout and its language logic is voice-derived; a separate file (reusing the shared schema/parser) keeps the shipped repurpose path byte-for-byte untouched.
2. **No new Zustand store.** The two-step form is a single self-contained page — page-local `useState` is simpler and sufficient. (Add a persisted store later only if surviving a mid-flow reload becomes a requirement.)
3. **Reuse `analyzeSource` + `buildVoiceProfile` via two additive exports** from `useRepurposeReel` rather than duplicating ~120 lines. The change is purely additive (extends the returned object); repurpose behavior is unchanged.

## File map

**New:**
- `src/lib/sourceUrl.ts` — pure IG/YouTube URL detection (+ `sourceUrl.test.ts`)
- `src/lib/youtubeTranscript.ts` — YouTube → transcript adapter (+ `youtubeTranscript.test.ts`)
- `src/ai/prompts/reelRemix.ts` — the remix prompt builder (+ `reelRemix.test.ts`)
- `src/hooks/useReelRemix.ts` — two-step orchestration hook
- `src/pages/ScriptStudioPage.tsx` — the form + result UI

**Modified:**
- `src/lib/actors.ts` — add `YOUTUBE_TRANSCRIPT` id + `buildYoutubeTranscriptInput`
- `api/apify.ts` — allowlist the YouTube actor id
- `src/hooks/useRepurposeReel.ts` — export `analyzeSource` + `buildVoiceProfile` (additive)
- `src/components/AppLayout.tsx` — one `NAV_SECTIONS` entry + icon import
- `src/App.tsx` — one route + page import

---

## Task 1: YouTube actor registry entry

**Files:**
- Modify: `src/lib/actors.ts`
- Test: `src/lib/actors.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `src/lib/actors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ACTORS, buildYoutubeTranscriptInput } from './actors'

describe('YouTube transcript actor', () => {
  it('uses the ~-separated actor id', () => {
    expect(ACTORS.YOUTUBE_TRANSCRIPT).toBe('topaz_sharingan~Youtube-Transcript-Scraper-1')
  })

  it('builds the string-array startUrls input shape confirmed by the spike', () => {
    expect(buildYoutubeTranscriptInput('https://youtube.com/shorts/abc123')).toEqual({
      startUrls: ['https://youtube.com/shorts/abc123'],
      timestamps: false,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/lib/actors.test.ts`
Expected: FAIL — `buildYoutubeTranscriptInput` / `ACTORS.YOUTUBE_TRANSCRIPT` not exported.

- [ ] **Step 3: Add the actor id and input builder**

In `src/lib/actors.ts`, add a member to the `ACTORS` object (after `SEARCH_SCRAPER`, before the closing `} as const`):

```ts
  // YOUTUBE_TRANSCRIPT pulls a YouTube video/Short's caption transcript (single `text` field).
  // Confirmed via spike: input { startUrls: [url], timestamps: false }; output item has `text`.
  YOUTUBE_TRANSCRIPT: 'topaz_sharingan~Youtube-Transcript-Scraper-1',
```

Then add this builder at the end of the file:

```ts
/**
 * Build the input for the YouTube Transcript actor (topaz_sharingan~Youtube-Transcript-Scraper-1).
 * `startUrls` takes bare URL strings (spike-confirmed); timestamps:false → one joined transcript.
 *
 * @param url  A YouTube Short/video URL (youtube.com/shorts/…, youtu.be/…, or watch?v=…)
 */
export function buildYoutubeTranscriptInput(url: string): Record<string, unknown> {
  return { startUrls: [url], timestamps: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/lib/actors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actors.ts src/lib/actors.test.ts
git commit -m "feat(script-studio): register YouTube transcript actor + input builder"
```

---

## Task 2: Allowlist the YouTube actor on the server proxy

**Files:**
- Modify: `api/apify.ts:34-39` (the `ALLOWED_ACTORS` set) and the line-13 comment

- [ ] **Step 1: Check for an existing allowlist assertion**

Run: `grep -rn "ALLOWED_ACTORS\|Actor not allowed" api/`
If a test asserts the exact set contents, note it and update it in Step 3. (At time of writing there is none.)

- [ ] **Step 2: Add the actor id to the allowlist**

In `api/apify.ts`, change the `ALLOWED_ACTORS` set to include the YouTube actor:

```ts
const ALLOWED_ACTORS = new Set([
  'apify~instagram-profile-scraper',
  'apify~instagram-hashtag-scraper',
  'apify~instagram-scraper',
  'apify~instagram-reel-scraper',
  'topaz_sharingan~Youtube-Transcript-Scraper-1',
])
```

Also update the comment on line 13 from:

```ts
 *   - Actor allowlist: only the 4 Instagram actors used by this product.
```

to:

```ts
 *   - Actor allowlist: the 4 Instagram actors + the YouTube transcript actor used by this product.
```

- [ ] **Step 3: Typecheck the api workspace**

Run: `bun run typecheck:api`
Expected: no errors (adding a string to a `Set` is trivially valid).

- [ ] **Step 4: Commit**

```bash
git add api/apify.ts
git commit -m "feat(script-studio): allowlist YouTube transcript actor in /api/apify"
```

---

## Task 3: Source-URL platform detection

**Files:**
- Create: `src/lib/sourceUrl.ts`
- Test: `src/lib/sourceUrl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/sourceUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectSourcePlatform } from './sourceUrl'

describe('detectSourcePlatform', () => {
  it('detects Instagram reel URLs', () => {
    expect(detectSourcePlatform('https://www.instagram.com/reel/CxYz123/')).toBe('instagram')
    expect(detectSourcePlatform('https://instagram.com/p/ABC_def-9/')).toBe('instagram')
  })

  it('detects YouTube Shorts and youtu.be links', () => {
    expect(detectSourcePlatform('https://www.youtube.com/shorts/aB3d_Xyz12')).toBe('youtube')
    expect(detectSourcePlatform('https://youtu.be/aB3d_Xyz12')).toBe('youtube')
    expect(detectSourcePlatform('https://www.youtube.com/watch?v=aB3d_Xyz12')).toBe('youtube')
  })

  it('returns null for anything else', () => {
    expect(detectSourcePlatform('https://tiktok.com/@x/video/123')).toBeNull()
    expect(detectSourcePlatform('not a url')).toBeNull()
    expect(detectSourcePlatform('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/lib/sourceUrl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/sourceUrl.ts`:

```ts
/**
 * Source-URL detection for Script Studio. A reference video is either an Instagram reel
 * (reuses the reel-URL parser) or a YouTube Short/video. Pure — no I/O, unit-tested.
 */
import { parseReelUrl } from './reelUrl'

export type SourcePlatform = 'instagram' | 'youtube'

// youtube.com/shorts/<id>, youtu.be/<id>, or youtube.com/watch?v=<id> (any subdomain).
const YOUTUBE_RE = /(?:youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]{6,})/i

/** Which platform a pasted URL belongs to, or null if it's neither. */
export function detectSourcePlatform(input: string): SourcePlatform | null {
  if (typeof input !== 'string' || !input.trim()) return null
  if (parseReelUrl(input)) return 'instagram'
  if (YOUTUBE_RE.test(input)) return 'youtube'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/lib/sourceUrl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourceUrl.ts src/lib/sourceUrl.test.ts
git commit -m "feat(script-studio): source URL platform detection"
```

---

## Task 4: YouTube transcript adapter

**Files:**
- Create: `src/lib/youtubeTranscript.ts`
- Test: `src/lib/youtubeTranscript.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/youtubeTranscript.test.ts` (covers the pure extractor against the spike-confirmed `text` field plus defensive fallbacks):

```ts
import { describe, it, expect } from 'vitest'
import { extractYoutubeTranscript } from './youtubeTranscript'

describe('extractYoutubeTranscript', () => {
  it('reads the spike-confirmed `text` field', () => {
    const rows = [{ videoId: 'x', videoTitle: 't', text: 'one small step for man' }]
    expect(extractYoutubeTranscript(rows)).toBe('one small step for man')
  })

  it('falls back to transcript/transcriptText fields', () => {
    expect(extractYoutubeTranscript([{ transcript: 'hi there' }])).toBe('hi there')
    expect(extractYoutubeTranscript([{ transcriptText: 'yo' }])).toBe('yo')
  })

  it('returns empty string when no usable text is present', () => {
    expect(extractYoutubeTranscript([{ videoId: 'x', text: '' }])).toBe('')
    expect(extractYoutubeTranscript([])).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/lib/youtubeTranscript.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/youtubeTranscript.ts`:

```ts
/**
 * YouTube transcript adapter — given ONE YouTube Short/video URL, returns its spoken
 * transcript as a single string via the Transcript-Ninja actor.
 *
 * Mirrors singleReelClient/reelVideoClient: routes through apifyCore (/api/apify proxy
 * picks the key), serialized on the shared apifyRunLimiter. Spike-confirmed: the dataset
 * item carries the transcript in `text`.
 */
import { startRun, pollRun, fetchDataset, ApifyError, apifyRunLimiter, withKeyFailover } from './apifyCore'
import { ACTORS, buildYoutubeTranscriptInput } from './actors'

// Captions fetch is fast (no video download) — a 2-minute idle budget is ample.
const YT_POLL_MS = 120_000

interface RawYtTranscriptItem {
  text?: string
  transcript?: string
  transcriptText?: string
}

/** Pure: pull the transcript string from the actor's dataset items. Exported for tests. */
export function extractYoutubeTranscript(rawItems: unknown[]): string {
  const items = rawItems as RawYtTranscriptItem[]
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    if (typeof it.text === 'string' && it.text.trim()) return it.text.trim()
    if (typeof it.transcript === 'string' && it.transcript.trim()) return it.transcript.trim()
    if (typeof it.transcriptText === 'string' && it.transcriptText.trim()) return it.transcriptText.trim()
  }
  return ''
}

/**
 * Resolve a YouTube URL to its transcript. Throws ApifyError when the run is blocked or
 * the video has no captions/transcript.
 *
 * @param url        A YouTube Short/video URL
 * @param apifyKeys  keysStore.apifyKeys (ignored by the proxy; kept for call-site parity)
 * @param signal     AbortSignal for cancellation
 */
export async function fetchYoutubeTranscript(
  url: string,
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<string> {
  return apifyRunLimiter(async () => {
    const input = buildYoutubeTranscriptInput(url)
    const raw = await withKeyFailover(apifyKeys, async (apiKey) => {
      const { runId, datasetId, keyIndex } = await startRun(ACTORS.YOUTUBE_TRANSCRIPT, input, apiKey, signal)
      await pollRun(runId, apiKey, signal, YT_POLL_MS, keyIndex)
      return fetchDataset<RawYtTranscriptItem>(datasetId, apiKey, signal, keyIndex)
    })
    const transcript = extractYoutubeTranscript(raw)
    if (!transcript) {
      throw new ApifyError('RUN_FAILED', 'No transcript available for that YouTube Short (no captions found)', 0)
    }
    return transcript
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/lib/youtubeTranscript.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/youtubeTranscript.ts src/lib/youtubeTranscript.test.ts
git commit -m "feat(script-studio): YouTube transcript adapter"
```

---

## Task 5: Remix prompt builder

**Files:**
- Create: `src/ai/prompts/reelRemix.ts`
- Test: `src/ai/prompts/reelRemix.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ai/prompts/reelRemix.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/ai/prompts/reelRemix.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/ai/prompts/reelRemix.ts`:

```ts
// src/ai/prompts/reelRemix.ts
/**
 * Reel Remix — Script Studio prompt: keep a reference video's STRUCTURE, write about a NEW
 * topic. Optional client voice; explicit output language (English/Hinglish toggle).
 *
 * Reuses REEL_REWRITE_SCHEMA / parseReelRewrite / ReelRewriteResult / TargetLanguage from
 * reelRewrite.ts so the output shape, coercion, and result rendering are shared. reelRewrite.ts
 * is intentionally NOT modified — this is the topic-swap mirror of the voice-swap rewrite.
 */
import type { ReelVideoAnalysis } from '../../store/singleReelStore'
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/ai/prompts/reelRemix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompts/reelRemix.ts src/ai/prompts/reelRemix.test.ts
git commit -m "feat(script-studio): remix prompt (preserve structure, swap topic)"
```

---

## Task 6: Orchestration hook (+ additive repurpose exports)

**Files:**
- Modify: `src/hooks/useRepurposeReel.ts:232` (the returned object)
- Create: `src/hooks/useReelRemix.ts`

- [ ] **Step 1: Export the two reusable helpers from `useRepurposeReel`**

Before editing, per CLAUDE.md run GitNexus impact on the symbol:

Run: (in an interactive session, or note for reviewer) `impact({ target: "useRepurposeReel", direction: "upstream" })` — expected LOW (additive change to the return object; no existing caller reads the new keys).

In `src/hooks/useRepurposeReel.ts`, change the final return (currently line 232):

```ts
  return { startRepurpose, rebuildVoiceProfile }
```

to:

```ts
  // analyzeSource + buildVoiceProfile are also consumed by Script Studio (useReelRemix).
  return { startRepurpose, rebuildVoiceProfile, analyzeSource, buildVoiceProfile }
```

- [ ] **Step 2: Create the orchestration hook**

Create `src/hooks/useReelRemix.ts`:

```ts
/**
 * Script Studio orchestration — the two explicit steps behind the dedicated page:
 *   transcribe()  URL → transcript (IG deep-analysis via useRepurposeReel.analyzeSource;
 *                 YouTube via fetchYoutubeTranscript). Returns the (editable) transcript +
 *                 the structural source for the generate step.
 *   generate()    (edited transcript, new topic, language, optional voice) → ReelRewriteResult.
 *
 * Reuses the shipped repurpose primitives (analyzeSource, buildVoiceProfile) and the shared
 * rewrite schema/parser — the remix prompt is the only new LLM logic.
 */
import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useRepurposeReel } from './useRepurposeReel'
import { detectSourcePlatform, type SourcePlatform } from '../lib/sourceUrl'
import { fetchYoutubeTranscript } from '../lib/youtubeTranscript'
import { callGeminiWithSchema, PREMIUM_MODEL } from '../ai/gemini'
import {
  REEL_REWRITE_SCHEMA, parseReelRewrite,
  type ReelRewriteResult, type TargetLanguage,
} from '../ai/prompts/reelRewrite'
import { buildReelRemixPrompt, type RemixSource } from '../ai/prompts/reelRemix'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'

export interface TranscribeResult {
  platform: SourcePlatform
  source: RemixSource
  transcript: string
}

export interface GenerateArgs {
  source: RemixSource
  editedTranscript: string
  newTopic: string
  language: TargetLanguage
  clientHandle?: string
  pastedScripts?: string[]
}

export function useReelRemix() {
  const { analyzeSource, buildVoiceProfile } = useRepurposeReel()
  const { apifyKeys, geminiKeys } = useKeysStore()

  const transcribe = useCallback(
    async (url: string, signal?: AbortSignal): Promise<TranscribeResult> => {
      const platform = detectSourcePlatform(url)
      if (platform === 'instagram') {
        const result = await analyzeSource(url, signal)
        return {
          platform,
          source: { transcript: result.transcript, beats: result.videoAnalysis?.visual_beats },
          transcript: result.transcript,
        }
      }
      if (platform === 'youtube') {
        const transcript = await fetchYoutubeTranscript(url, apifyKeys, signal)
        return { platform, source: { transcript }, transcript }
      }
      throw new Error('Paste an Instagram Reel or a YouTube Short link.')
    },
    [analyzeSource, apifyKeys],
  )

  const generate = useCallback(
    async (args: GenerateArgs, signal?: AbortSignal): Promise<ReelRewriteResult> => {
      const handle = args.clientHandle?.trim()
      const scripts = (args.pastedScripts ?? []).filter((s) => s.trim().length > 0)

      let voice: VoiceProfile | undefined
      if (handle || scripts.length > 0) {
        voice = await buildVoiceProfile({ sourceReelUrl: '', clientHandle: handle, pastedScripts: scripts }, signal)
      }

      const source: RemixSource = { transcript: args.editedTranscript, beats: args.source.beats }
      const raw = await callGeminiWithSchema<ReelRewriteResult>(
        geminiKeys,
        buildReelRemixPrompt(source, args.newTopic, args.language, voice),
        REEL_REWRITE_SCHEMA,
        { temperature: 0.7, thinkingBudget: 3000, model: PREMIUM_MODEL, signal },
      )
      return parseReelRewrite(raw)
    },
    [buildVoiceProfile, geminiKeys],
  )

  return { transcribe, generate }
}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc -p tsconfig.app.json --noEmit`
Expected: no errors. (If `tsconfig.app.json` isn't the app config name, use `bun run build` which typechecks app + api.)

- [ ] **Step 4: Run the repurpose + new unit tests to prove no regression**

Run: `bunx vitest run src/hooks src/lib/youtubeTranscript.test.ts src/ai/prompts/reelRemix.test.ts`
Expected: PASS (existing repurpose tests unaffected by the additive export).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRepurposeReel.ts src/hooks/useReelRemix.ts
git commit -m "feat(script-studio): two-step remix orchestration hook"
```

---

## Task 7: Script Studio page (form + result)

**Files:**
- Create: `src/pages/ScriptStudioPage.tsx`

Design note: follow `DESIGN.md`. Use the chai/saffron token classes already used across the app (`text-primary`, `text-secondary`, `bg-surface`, `bg-surface-raised`, `border-[rgba(var(--border-rgb),0.08)]`, `text-[var(--color-accent)]`, `bg-[rgba(var(--accent-rgb),0.16)]`, `font-serif`). The AI-generated script block uses the **violet AI tint** `#A78BFA` per DESIGN.md.

- [ ] **Step 1: Create the page**

Create `src/pages/ScriptStudioPage.tsx`:

```tsx
import { useRef, useState } from 'react'
import { Wand2, Copy, Check, Loader2 } from 'lucide-react'
import { useReelRemix, type TranscribeResult } from '../hooks/useReelRemix'
import { friendlyError } from '../lib/errorMessages'
import type { TargetLanguage } from '../ai/prompts/reelRewrite'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

type Phase = 'input' | 'transcribing' | 'review' | 'generating' | 'result'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch { /* clipboard blocked — no-op */ }
      }}
      className="inline-flex items-center gap-1 text-xs text-secondary hover:text-primary transition-colors"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function ScriptStudioPage() {
  const { transcribe, generate } = useReelRemix()
  const abortRef = useRef<AbortController | null>(null)

  const [phase, setPhase] = useState<Phase>('input')
  const [url, setUrl] = useState('')
  const [ref_, setRef] = useState<TranscribeResult | null>(null)
  const [transcript, setTranscript] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [language, setLanguage] = useState<TargetLanguage>('english')
  const [clientHandle, setClientHandle] = useState('')
  const [pastedScripts, setPastedScripts] = useState('')
  const [rewrite, setRewrite] = useState<ReelRewriteResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = phase === 'transcribing' || phase === 'generating'

  const onFetch = async () => {
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setPhase('transcribing')
    try {
      const result = await transcribe(url.trim(), ac.signal)
      setRef(result)
      setTranscript(result.transcript)
      setPhase('review')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, (err as Error)?.message ?? 'Could not fetch that video.'))
      setPhase('input')
    }
  }

  const onGenerate = async () => {
    if (!ref_ || !newTopic.trim() || !transcript.trim()) return
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setPhase('generating')
    try {
      const scripts = pastedScripts.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
      const result = await generate(
        {
          source: ref_.source,
          editedTranscript: transcript,
          newTopic: newTopic.trim(),
          language,
          clientHandle: clientHandle.trim() || undefined,
          pastedScripts: scripts,
        },
        ac.signal,
      )
      setRewrite(result)
      setPhase('result')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, 'Could not generate the script.'))
      setPhase('review')
    }
  }

  const onReset = () => {
    abortRef.current?.abort()
    setPhase('input'); setUrl(''); setRef(null); setTranscript('')
    setNewTopic(''); setClientHandle(''); setPastedScripts(''); setRewrite(null); setError(null)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-6">
        <h1 className="font-serif italic text-3xl text-primary flex items-center gap-2">
          <Wand2 size={24} className="text-[var(--color-accent)]" /> Script Studio
        </h1>
        <p className="text-secondary text-sm mt-1">
          Paste a Reel or YouTube Short, add your new idea, and get a script in its exact style.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {/* Step 1 — Source URL */}
      <section className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 mb-4">
        <label className="block text-sm font-medium text-primary mb-2">Reference video URL</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="instagram.com/reel/… or youtube.com/shorts/…"
            disabled={phase !== 'input' && phase !== 'transcribing'}
            className="flex-1 rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="button"
            onClick={onFetch}
            disabled={!url.trim() || busy}
            className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {phase === 'transcribing' ? <Loader2 size={15} className="animate-spin" /> : null}
            {phase === 'transcribing' ? 'Transcribing…' : 'Fetch & Transcribe'}
          </button>
        </div>
      </section>

      {/* Step 2 — Review transcript + inputs */}
      {(phase === 'review' || phase === 'generating' || phase === 'result') && ref_ && (
        <section className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 mb-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-primary">
                Transcript <span className="text-muted font-normal">({ref_.platform})</span>
              </label>
              <span className="text-xs text-muted">Edit any mis-transcribed words</span>
            </div>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={6}
              className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-primary mb-1.5">Your new video idea</label>
            <input
              type="text"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              placeholder="e.g. how to save your first ₹1 lakh in your 20s"
              className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="block text-xs font-medium text-secondary mb-1.5">Language</span>
              <div className="inline-flex rounded-lg border border-[rgba(var(--border-rgb),0.12)] overflow-hidden">
                {(['english', 'hinglish'] as TargetLanguage[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLanguage(l)}
                    className={`px-3 py-1.5 text-sm capitalize ${
                      language === l ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-secondary mb-1.5">Client voice (optional)</label>
              <input
                type="text"
                value={clientHandle}
                onChange={(e) => setClientHandle(e.target.value)}
                placeholder="@handle — or paste scripts below"
                className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-secondary hover:text-primary">…or paste 2–3 of their scripts instead</summary>
            <textarea
              value={pastedScripts}
              onChange={(e) => setPastedScripts(e.target.value)}
              rows={4}
              placeholder="Paste scripts, separated by a blank line"
              className="mt-2 w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </details>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onGenerate}
              disabled={!newTopic.trim() || !transcript.trim() || busy}
              className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              {phase === 'generating' ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {phase === 'generating' ? 'Generating…' : 'Generate script'}
            </button>
            <button type="button" onClick={onReset} className="text-sm text-secondary hover:text-primary">
              Start over
            </button>
          </div>
        </section>
      )}

      {/* Step 3 — Result (violet AI tint) */}
      {phase === 'result' && rewrite && (
        <section className="rounded-xl border border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.06)] p-4 space-y-4">
          <ResultField label="Hook" text={rewrite.spokenHook} />
          {rewrite.altHooks.some((h) => h.trim()) && (
            <div>
              <FieldHeader label="Alt hooks" text={rewrite.altHooks.filter(Boolean).join('\n')} />
              <ul className="mt-1 space-y-1 text-sm text-primary list-disc list-inside">
                {rewrite.altHooks.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          )}
          <div>
            <FieldHeader label="Script" text={rewrite.beatScript.map((b) => b.script).join('\n\n')} />
            <ol className="mt-1 space-y-2">
              {rewrite.beatScript.map((b, i) => (
                <li key={i} className="text-sm">
                  <span className="text-[#A78BFA] font-medium">{b.beatLabel}</span>
                  <p className="text-primary">{b.script}</p>
                  {b.onScreenText && <p className="text-muted text-xs mt-0.5">On-screen: {b.onScreenText}</p>}
                </li>
              ))}
            </ol>
          </div>
          <ResultField label="Caption" text={rewrite.caption} />
          <ResultField label="CTA" text={rewrite.cta} />
          {rewrite.onScreenText.length > 0 && (
            <ResultField label="On-screen text" text={rewrite.onScreenText.join('\n')} />
          )}
        </section>
      )}
    </div>
  )
}

function FieldHeader({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#A78BFA]">{label}</span>
      <CopyButton text={text} />
    </div>
  )
}

function ResultField({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <FieldHeader label={label} text={text} />
      <p className="mt-1 text-sm text-primary whitespace-pre-wrap">{text}</p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run build`
Expected: typecheck (app + api) + Vite build succeed with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ScriptStudioPage.tsx
git commit -m "feat(script-studio): dedicated page (form + editable transcript + result)"
```

---

## Task 8: Nav entry + route

**Files:**
- Modify: `src/components/AppLayout.tsx:3` (icon import) and `:29-37` (NAV_SECTIONS)
- Modify: `src/App.tsx` (import + route)

- [ ] **Step 1: Add the nav icon import**

In `src/components/AppLayout.tsx`, add `Wand2` to the lucide import on line 3:

```ts
import { Brain, MessageSquare, CalendarDays, Wallet, BarChart2, Clapperboard, ShieldCheck, Target, Menu, X, Sun, Moon, Wand2 } from 'lucide-react'
```

- [ ] **Step 2: Add the nav section**

In the `NAV_SECTIONS` array (after the `/strategy` entry), add:

```ts
  { path: '/script-studio', label: 'Script Studio', icon: Wand2 },
```

- [ ] **Step 3: Add the route**

In `src/App.tsx`, add the import near the other page imports (after line 21):

```ts
import { ScriptStudioPage } from './pages/ScriptStudioPage'
```

Then inside the padded `<Route element={<AppLayout />}>` block (e.g. after the `strategy/:id` route, line 128), add:

```tsx
                {/* Script Studio — reference reel/Short → new-topic script remix */}
                <Route path="script-studio" element={<ScriptStudioPage />} />
```

- [ ] **Step 4: Typecheck the build**

Run: `bun run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppLayout.tsx src/App.tsx
git commit -m "feat(script-studio): nav entry + /script-studio route"
```

---

## Task 9: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite + lint**

Run: `bun run test && bun run lint`
Expected: all tests pass, no new lint errors.

- [ ] **Step 2: Start the dev server via the Browser pane**

Use `preview_start` with the dev server (create `.claude/launch.json` with `bun run dev` if needed). Sign in (Clerk gate), then navigate to `/script-studio`.

- [ ] **Step 3: Instagram path**

Paste a real IG reel URL → **Fetch & Transcribe** → confirm the transcript textarea fills. Enter a new topic, keep language English, leave voice blank → **Generate** → confirm a full script renders (hook, beats, caption, CTA, alt hooks) with working copy buttons. Check `read_console_messages` for errors.

- [ ] **Step 4: YouTube Short path (validates the `/shorts/` URL form)**

Paste a real `https://www.youtube.com/shorts/<id>` URL → Fetch & Transcribe → confirm transcript fills (this confirms the Shorts URL form, not just `watch?v=`). Generate with Hinglish + a client `@handle` → confirm the script comes out in Hinglish and reflects the client voice.

- [ ] **Step 5: Error paths**

Paste a TikTok/garbage URL → confirm the "Paste an Instagram Reel or a YouTube Short link." message. Paste a music-only reel (no speech) → confirm a clear error, no crash.

- [ ] **Step 6: Final commit / branch is ready for PR**

```bash
git status   # working tree clean
git log --oneline feat/script-studio ^main
```

The branch `feat/script-studio` is ready for `/ship` or a PR.

---

## Self-review

**Spec coverage:** Optional voice ✅ (Task 5/6, `voice?`); dedicated form + editable transcript ✅ (Task 7); IG + YouTube ✅ (Tasks 3/4/6); English/Hinglish only ✅ (Task 7 toggle, Task 5 directive); "Script Studio" nav ✅ (Task 8); transcript-first unified ingest ✅ (Task 6); allowlist edit ✅ (Task 2); error handling (no-speech / bad URL / provider outage via `friendlyError`) ✅ (Tasks 4/6/7); tests ✅ (Tasks 1/3/4/5). Spike ✅ (done during planning).

**Placeholder scan:** No TBD/TODO; every code step has full content.

**Type consistency:** `RemixSource` (Task 5) is produced in Task 6 and consumed in Task 7 via `ref_.source`; `TargetLanguage` imported from `reelRewrite.ts` everywhere; `ReelRewriteResult`/`parseReelRewrite`/`REEL_REWRITE_SCHEMA` reused unchanged; `analyzeSource`/`buildVoiceProfile` signatures match `useRepurposeReel` (Task 6 export). `fetchYoutubeTranscript(url, apifyKeys, signal)` matches its Task 6 call site.
