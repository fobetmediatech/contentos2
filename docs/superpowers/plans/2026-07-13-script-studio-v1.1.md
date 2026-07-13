# Script Studio v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four enhancements to Script Studio — pick a corpus reel as the reference (free, no scrape) with an in-Studio picker + a Gallery "Remix this" button; a saved-voice dropdown; 3 sequential hook-angle variations in tabs; and a regenerate-any-field ↻.

**Architecture:** Extends the existing `useReelRemix` hook, the `reelRemix.ts` prompt, and the `ScriptStudioPage`. New pure helpers (`remixFields.ts`, `buildLibrarySource`, `filterReels`) carry the logic so it's unit-testable; the page splits into `RemixLibraryPicker` / `RemixVoicePicker` / `RemixResultPanel`. Voice is resolved once and reused across variations + regenerate. `reelRewrite.ts` stays untouched.

**Tech Stack:** React 18 + Vite + TypeScript, Zustand (corpus store, read-only here), Gemini via `/api/gemini`, IndexedDB cache (`idb`), vitest, Tailwind with the DESIGN.md token system.

---

## Spec reference
`docs/superpowers/specs/2026-07-13-script-studio-v1.1-design.md`. Branch: `feat/script-studio-v1.1` (stacked on v1 / PR #76).

## File map
**New:** `src/lib/remixFields.ts` (+test), `src/components/RemixVoicePicker.tsx`, `src/components/RemixLibraryPicker.tsx` (+test for its filter helper), `src/components/RemixResultPanel.tsx`.
**Modified:** `src/ai/prompts/reelRemix.ts` (+test), `src/hooks/useReelRemix.ts` (+test for `buildLibrarySource`), `src/pages/ScriptStudioPage.tsx`, `src/pages/GalleryPage.tsx`.

Test command: `bunx vitest run <file>`. Typecheck/build: `bun run build`.

---

## Task 1: Remix prompt — variation angle + field-regen

**Files:**
- Modify: `src/ai/prompts/reelRemix.ts`
- Test: `src/ai/prompts/reelRemix.test.ts` (exists — append)

- [ ] **Step 1: Write the failing tests** — append to `src/ai/prompts/reelRemix.test.ts`:

```ts
import { VARIATION_ANGLES, buildFieldRegenPrompt, FIELD_REGEN_SCHEMA } from './reelRemix'
import type { ReelRewriteResult } from './reelRewrite'

const CURRENT: ReelRewriteResult = {
  spokenHook: 'this is the current hook',
  beatScript: [{ beatLabel: 'Hook', script: 'beat one', onScreenText: 'overlay' }],
  caption: 'cap', cta: 'follow', onScreenText: ['a'], altHooks: ['x', 'y', 'z'],
}

describe('variation angles', () => {
  it('exposes 3 distinct angles', () => {
    expect(VARIATION_ANGLES.length).toBe(3)
    expect(new Set(VARIATION_ANGLES).size).toBe(3)
  })
  it('appends the angle to the prompt when given', () => {
    const p = buildReelRemixPrompt(SOURCE, 'topic', 'english', undefined, VARIATION_ANGLES[1])
    expect(p).toContain(VARIATION_ANGLES[1])
  })
  it('omits the angle line when not given', () => {
    const p = buildReelRemixPrompt(SOURCE, 'topic', 'english')
    expect(p).not.toContain('For THIS version')
  })
})

describe('buildFieldRegenPrompt', () => {
  it('names the field, includes the current script + language directive', () => {
    const p = buildFieldRegenPrompt(CURRENT, SOURCE, 'the spoken hook', 'topic', 'hinglish')
    expect(p).toContain('the spoken hook')
    expect(p).toContain('this is the current hook')
    expect(p).toContain('HINGLISH')
  })
  it('schema requires a single value string', () => {
    expect(FIELD_REGEN_SCHEMA.required).toEqual(['value'])
  })
})
```

(`SOURCE` and `buildReelRemixPrompt` are already imported at the top of the existing test file.)

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run src/ai/prompts/reelRemix.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement** — in `src/ai/prompts/reelRemix.ts`:

(a) Add after the imports:
```ts
/** Three fixed hook angles that make the 3 variations reliably distinct (not random twins). */
export const VARIATION_ANGLES = [
  'open with a curiosity or question hook',
  'open with a bold, contrarian claim',
  'open with a personal-story or "POV" hook',
]

export const FIELD_REGEN_SCHEMA = {
  type: 'object',
  properties: { value: { type: 'string' } },
  required: ['value'],
}
```

(b) Change the signature of `buildReelRemixPrompt` to accept an optional angle, and inject it into the hook instruction. Replace the function signature line:
```ts
export function buildReelRemixPrompt(
  source: RemixSource,
  newTopic: string,
  language: TargetLanguage,
  voice?: VoiceProfile,
  variationAngle?: string,
): string {
```
Then, inside the returned template, find the `spokenHook:` rule line:
```ts
- spokenHook: the opening line (verbatim, ready to say to camera), about the NEW topic.
```
and replace it with:
```ts
- spokenHook: the opening line (verbatim, ready to say to camera), about the NEW topic.${variationAngle ? `\n- For THIS version, ${variationAngle}.` : ''}
```

(c) Add the field-regen prompt at the end of the file:
```ts
function currentScriptBlock(r: ReelRewriteResult): string {
  const beats = r.beatScript
    .map((b, i) => `  Beat ${i + 1} [${b.beatLabel}]: ${b.script}${b.onScreenText ? ` (overlay: ${b.onScreenText})` : ''}`)
    .join('\n')
  return [
    `Hook: ${r.spokenHook}`,
    `Beats:\n${beats}`,
    `Caption: ${r.caption}`,
    `CTA: ${r.cta}`,
    `On-screen: ${r.onScreenText.join(' | ')}`,
  ].join('\n')
}

/** Prompt to regenerate ONE field of an existing script, coherent with the rest. Returns { value }. */
export function buildFieldRegenPrompt(
  current: ReelRewriteResult,
  source: RemixSource,
  fieldLabel: string,
  newTopic: string,
  language: TargetLanguage,
  voice?: VoiceProfile,
): string {
  const lang = language === 'hinglish'
    ? '- Write in natural romanized HINGLISH (Latin letters, never Devanagari).'
    : '- Write in ENGLISH.'
  return `You are refining ONE part of an existing short-form video script. Rewrite ONLY "${fieldLabel}" so it is fresh and DIFFERENT from the current version, while staying coherent with the rest of the script, the topic, and the reference structure.

## New topic
${newTopic}

## Current script (keep everything EXCEPT "${fieldLabel}")
${currentScriptBlock(current)}

## Reference transcript (for pacing/structure only — do not reuse its subject)
${source.transcript}
${voice ? `\n## Voice — @${voice.handle}\nMatch this creator's cadence and energy.\n` : ''}
## Rules
${lang}
- Latin/Roman letters only; romanize any Hindi as Hinglish; never Devanagari.
- Return ONLY the new "${fieldLabel}" as JSON: { "value": "..." }. No other fields, no commentary.`
}
```
`buildReelRemixPrompt` already imports `ReelRewriteResult`? It does not — it imports `TargetLanguage` from `./reelRewrite`. Add `ReelRewriteResult` to that import: change `import type { TargetLanguage } from './reelRewrite'` to `import type { TargetLanguage, ReelRewriteResult } from './reelRewrite'`.

- [ ] **Step 4: Run to verify it passes** — `bunx vitest run src/ai/prompts/reelRemix.test.ts` → PASS. Also `bunx eslint src/ai/prompts/reelRemix.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/ai/prompts/reelRemix.ts src/ai/prompts/reelRemix.test.ts
git commit -m "feat(script-studio): variation angles + field-regen prompt"
```

---

## Task 2: Field helpers (`remixFields.ts`)

**Files:**
- Create: `src/lib/remixFields.ts`
- Test: `src/lib/remixFields.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/lib/remixFields.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { fieldKey, fieldLabel, applyFieldValue, type FieldRef } from './remixFields'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

const R: ReelRewriteResult = {
  spokenHook: 'hook', caption: 'cap', cta: 'cta',
  beatScript: [{ beatLabel: 'B1', script: 's1', onScreenText: 'o1' }, { beatLabel: 'B2', script: 's2', onScreenText: 'o2' }],
  onScreenText: ['x', 'y'], altHooks: ['a', 'b', 'c'],
}

describe('fieldKey', () => {
  it('gives stable keys incl. indices', () => {
    expect(fieldKey({ kind: 'hook' })).toBe('hook')
    expect(fieldKey({ kind: 'beatScript', i: 1 })).toBe('beatScript:1')
    expect(fieldKey({ kind: 'onScreen', j: 0 })).toBe('onScreen:0')
  })
})

describe('fieldLabel', () => {
  it('is human + 1-indexed', () => {
    expect(fieldLabel({ kind: 'beatScript', i: 0 })).toContain('beat 1')
    expect(fieldLabel({ kind: 'hook' })).toContain('hook')
  })
})

describe('applyFieldValue (immutable)', () => {
  it('replaces the targeted slot only', () => {
    expect(applyFieldValue(R, { kind: 'hook' }, 'NEW').spokenHook).toBe('NEW')
    expect(applyFieldValue(R, { kind: 'beatScript', i: 1 }, 'NEW').beatScript[1].script).toBe('NEW')
    expect(applyFieldValue(R, { kind: 'beatOverlay', i: 0 }, 'NEW').beatScript[0].onScreenText).toBe('NEW')
    expect(applyFieldValue(R, { kind: 'onScreen', j: 1 }, 'NEW').onScreenText[1]).toBe('NEW')
    // original untouched
    expect(R.spokenHook).toBe('hook')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run src/lib/remixFields.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/lib/remixFields.ts`:
```ts
/**
 * Script Studio field references — identifies one single-string slot of a generated script
 * so the page/panel can regenerate or update just that field. Pure + unit-tested.
 */
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

export type FieldRef =
  | { kind: 'hook' }
  | { kind: 'caption' }
  | { kind: 'cta' }
  | { kind: 'beatScript'; i: number }
  | { kind: 'beatOverlay'; i: number }
  | { kind: 'onScreen'; j: number }

/** Stable id for a field (used to mark which ↻ is in-flight). */
export function fieldKey(f: FieldRef): string {
  switch (f.kind) {
    case 'beatScript': return `beatScript:${f.i}`
    case 'beatOverlay': return `beatOverlay:${f.i}`
    case 'onScreen': return `onScreen:${f.j}`
    default: return f.kind
  }
}

/** Human label passed to the regen prompt. */
export function fieldLabel(f: FieldRef): string {
  switch (f.kind) {
    case 'hook': return 'the spoken hook'
    case 'caption': return 'the caption'
    case 'cta': return 'the call-to-action'
    case 'beatScript': return `beat ${f.i + 1}'s spoken line`
    case 'beatOverlay': return `beat ${f.i + 1}'s on-screen overlay`
    case 'onScreen': return `on-screen text line ${f.j + 1}`
  }
}

/** Immutably write a new value into the targeted slot. */
export function applyFieldValue(r: ReelRewriteResult, f: FieldRef, value: string): ReelRewriteResult {
  switch (f.kind) {
    case 'hook': return { ...r, spokenHook: value }
    case 'caption': return { ...r, caption: value }
    case 'cta': return { ...r, cta: value }
    case 'beatScript':
      return { ...r, beatScript: r.beatScript.map((b, i) => (i === f.i ? { ...b, script: value } : b)) }
    case 'beatOverlay':
      return { ...r, beatScript: r.beatScript.map((b, i) => (i === f.i ? { ...b, onScreenText: value } : b)) }
    case 'onScreen':
      return { ...r, onScreenText: r.onScreenText.map((t, j) => (j === f.j ? value : t)) }
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `bunx vitest run src/lib/remixFields.test.ts` → PASS. `bunx eslint src/lib/remixFields.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/remixFields.ts src/lib/remixFields.test.ts
git commit -m "feat(script-studio): field-ref helpers (key/label/apply)"
```

---

## Task 3: Hook additions (`useReelRemix.ts`)

**Files:**
- Modify: `src/hooks/useReelRemix.ts`
- Test: `src/hooks/useReelRemix.test.ts` (create — tests the pure `buildLibrarySource`)

- [ ] **Step 1: Write the failing test** — create `src/hooks/useReelRemix.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildLibrarySource } from './useReelRemix'
import type { SingleReelResult } from '../store/singleReelStore'

const REEL = { shortCode: 'ABC', transcript: 'hello world' }

describe('buildLibrarySource', () => {
  it('uses cached beats when the deep analysis is cached', () => {
    const cached = { videoAnalysis: { visual_beats: [{ t_start: 0, t_end: 1, on_screen: 'x', function: 'hook' }] } } as unknown as SingleReelResult
    const out = buildLibrarySource(REEL, cached)
    expect(out.platform).toBe('instagram')
    expect(out.transcript).toBe('hello world')
    expect(out.source.beats).toHaveLength(1)
  })
  it('is transcript-only (no beats) on cache miss', () => {
    const out = buildLibrarySource(REEL, undefined)
    expect(out.source.transcript).toBe('hello world')
    expect(out.source.beats).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run src/hooks/useReelRemix.test.ts` → FAIL (`buildLibrarySource` not exported).

- [ ] **Step 3: Implement** — edit `src/hooks/useReelRemix.ts`:

(a) Extend imports (top of file) — add these lines to the existing imports:
```ts
import { getCachedSingleReel } from '../lib/singleReelCache'
import type { SingleReelResult } from '../store/singleReelStore'
import { buildReelRemixPrompt, buildFieldRegenPrompt, VARIATION_ANGLES, FIELD_REGEN_SCHEMA, type RemixSource } from '../ai/prompts/reelRemix'
```
(replace the existing `import { buildReelRemixPrompt, type RemixSource } from '../ai/prompts/reelRemix'` line with the expanded one above.)

(b) Extend `GenerateArgs` — add two optional fields:
```ts
export interface GenerateArgs {
  source: RemixSource
  editedTranscript: string
  newTopic: string
  language: TargetLanguage
  clientHandle?: string
  pastedScripts?: string[]
  /** Pre-resolved voice — set by generateVariations so all 3 share one build. */
  voice?: VoiceProfile
  /** One of VARIATION_ANGLES — biases the hook so variations diverge. */
  variationAngle?: string
}

export interface VariationsOpts {
  count?: number
  onResult?: (i: number, r: ReelRewriteResult) => void
  onError?: (i: number) => void
}

export interface RegenerateArgs {
  current: ReelRewriteResult
  source: RemixSource
  fieldLabel: string
  newTopic: string
  language: TargetLanguage
  voice?: VoiceProfile
}
```

(c) Add the pure `buildLibrarySource` at module scope (outside the hook, after the interfaces):
```ts
/** Pure: seed a remix reference from a corpus reel + its (maybe-absent) cached deep analysis. */
export function buildLibrarySource(
  reel: { shortCode: string; transcript: string },
  cached: SingleReelResult | undefined,
): TranscribeResult {
  return {
    platform: 'instagram',
    source: { transcript: reel.transcript, beats: cached?.videoAnalysis?.visual_beats },
    transcript: reel.transcript,
  }
}
```

(d) Change `generate` to honor a pre-resolved voice + angle. Replace the body of the `generate` useCallback's voice resolution and prompt call:
```ts
  const generate = useCallback(
    async (args: GenerateArgs, signal?: AbortSignal): Promise<ReelRewriteResult> => {
      const handle = args.clientHandle?.trim()
      const scripts = (args.pastedScripts ?? []).filter((s) => s.trim().length > 0)

      const voice = args.voice
        ?? ((handle || scripts.length > 0)
          ? await buildVoiceProfile({ sourceReelUrl: '', clientHandle: handle, pastedScripts: scripts }, signal)
          : undefined)

      const source: RemixSource = { transcript: args.editedTranscript, beats: args.source.beats }
      const raw = await callGeminiWithSchema<ReelRewriteResult>(
        geminiKeys,
        buildReelRemixPrompt(source, args.newTopic, args.language, voice, args.variationAngle),
        REEL_REWRITE_SCHEMA,
        { temperature: 0.7, thinkingBudget: 3000, model: PREMIUM_MODEL, signal },
      )
      return parseReelRewrite(raw)
    },
    [buildVoiceProfile, geminiKeys],
  )
```

(e) Add `fromLibrary`, `generateVariations`, `regenerateField` after `generate`:
```ts
  const fromLibrary = useCallback(
    async (reel: { shortCode: string; transcript: string }): Promise<TranscribeResult> => {
      const cached = await getCachedSingleReel(reel.shortCode)
      return buildLibrarySource(reel, cached)
    },
    [],
  )

  const generateVariations = useCallback(
    async (
      args: GenerateArgs,
      opts?: VariationsOpts,
      signal?: AbortSignal,
    ): Promise<{ results: (ReelRewriteResult | null)[]; voice?: VoiceProfile }> => {
      const count = opts?.count ?? 3
      const handle = args.clientHandle?.trim()
      const scripts = (args.pastedScripts ?? []).filter((s) => s.trim().length > 0)
      // Resolve voice ONCE — otherwise a fresh @handle would scrape+synthesize `count` times.
      const voice = args.voice
        ?? ((handle || scripts.length > 0)
          ? await buildVoiceProfile({ sourceReelUrl: '', clientHandle: handle, pastedScripts: scripts }, signal)
          : undefined)

      const results: (ReelRewriteResult | null)[] = new Array(count).fill(null)
      for (let i = 0; i < count; i++) {
        if (signal?.aborted) break
        try {
          const r = await generate({ ...args, voice, variationAngle: VARIATION_ANGLES[i % VARIATION_ANGLES.length] }, signal)
          results[i] = r
          opts?.onResult?.(i, r)
        } catch (err) {
          if (signal?.aborted || (err as Error)?.name === 'AbortError') break
          opts?.onError?.(i)
        }
      }
      return { results, voice }
    },
    [generate, buildVoiceProfile],
  )

  const regenerateField = useCallback(
    async (args: RegenerateArgs, signal?: AbortSignal): Promise<string> => {
      const raw = await callGeminiWithSchema<{ value: string }>(
        geminiKeys,
        buildFieldRegenPrompt(args.current, args.source, args.fieldLabel, args.newTopic, args.language, args.voice),
        FIELD_REGEN_SCHEMA,
        { temperature: 0.85, thinkingBudget: 1000, model: PREMIUM_MODEL, signal },
      )
      return typeof raw?.value === 'string' ? raw.value : ''
    },
    [geminiKeys],
  )
```

(f) Extend the return:
```ts
  return { transcribe, generate, fromLibrary, generateVariations, regenerateField }
```

- [ ] **Step 4: Verify** — `bunx vitest run src/hooks/useReelRemix.test.ts` → PASS. `bunx tsc -b` → clean. `bunx vitest run src/hooks src/ai/prompts/reelRemix.test.ts` → all PASS. `bunx eslint src/hooks/useReelRemix.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/hooks/useReelRemix.ts src/hooks/useReelRemix.test.ts
git commit -m "feat(script-studio): hook adds fromLibrary, generateVariations, regenerateField"
```

---

## Task 4: RemixVoicePicker

**Files:**
- Create: `src/components/RemixVoicePicker.tsx`

- [ ] **Step 1: Create the component**
```tsx
import { useState } from 'react'
import { useCorpusStore } from '../store/corpusStore'

/** Reports the chosen client voice up to Script Studio. */
export interface VoiceChoice {
  clientHandle?: string
  pastedScripts?: string
}

/** Dropdown of saved voice profiles + a "new voice" fallback (type @handle or paste scripts). */
export function RemixVoicePicker({ onChange }: { onChange: (v: VoiceChoice) => void }) {
  const profiles = useCorpusStore((s) => s.voiceProfiles)
  const saved = Object.values(profiles)
  const [mode, setMode] = useState<'none' | 'saved' | 'new'>('none')
  const [handle, setHandle] = useState('')
  const [pasted, setPasted] = useState('')

  const onSelect = (value: string) => {
    if (value === '') { setMode('none'); onChange({}) }
    else if (value === '__new__') { setMode('new'); onChange({ clientHandle: handle.trim() || undefined, pastedScripts: pasted.trim() || undefined }) }
    else { setMode('saved'); onChange({ clientHandle: value }) } // value === saved profile handle
  }

  return (
    <div className="flex-1 min-w-[180px]">
      <label className="block text-xs font-medium text-secondary mb-1.5">Client voice (optional)</label>
      <select
        onChange={(e) => onSelect(e.target.value)}
        defaultValue=""
        className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="">No client voice</option>
        {saved.map((p) => (
          <option key={p.handle} value={p.handle}>{p.displayName || `@${p.handle}`}</option>
        ))}
        <option value="__new__">New voice…</option>
      </select>

      {mode === 'new' && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={handle}
            onChange={(e) => { setHandle(e.target.value); onChange({ clientHandle: e.target.value.trim() || undefined, pastedScripts: pasted.trim() || undefined }) }}
            placeholder="@handle"
            className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <textarea
            value={pasted}
            onChange={(e) => { setPasted(e.target.value); onChange({ clientHandle: handle.trim() || undefined, pastedScripts: e.target.value.trim() || undefined }) }}
            rows={3}
            placeholder="…or paste 2–3 of their scripts, separated by a blank line"
            className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck** — `bun run build` → clean. `bunx eslint src/components/RemixVoicePicker.tsx`.

- [ ] **Step 3: Commit**
```bash
git add src/components/RemixVoicePicker.tsx
git commit -m "feat(script-studio): saved-voice dropdown component"
```

---

## Task 5: RemixLibraryPicker (+ filter helper)

**Files:**
- Create: `src/components/RemixLibraryPicker.tsx`
- Test: `src/components/RemixLibraryPicker.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/components/RemixLibraryPicker.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { filterReels } from './RemixLibraryPicker'
import type { ContentRecord } from '../lib/corpus'

const rec = (over: Partial<ContentRecord>): ContentRecord => ({
  id: 'x', creatorUsername: 'alice', caption: 'a caption', transcript: 't',
  url: '', thumbnailUrl: '', videoViewCount: 0, likesCount: 0, commentsCount: 0, hookArchetype: '',
} as ContentRecord as ContentRecord & typeof over)

describe('filterReels', () => {
  const reels = [
    rec({ id: '1', creatorUsername: 'alice', caption: 'fitness tips', transcript: 'has words' }),
    rec({ id: '2', creatorUsername: 'bob', caption: 'cooking', transcript: '' }),        // no transcript → excluded
    rec({ id: '3', creatorUsername: 'carol', caption: 'money hacks', transcript: 'yes' }),
  ]
  it('drops reels with no transcript', () => {
    expect(filterReels(reels, '').map((r) => r.id)).toEqual(['1', '3'])
  })
  it('matches caption or handle, case-insensitive', () => {
    expect(filterReels(reels, 'CAROL').map((r) => r.id)).toEqual(['3'])
    expect(filterReels(reels, 'fitness').map((r) => r.id)).toEqual(['1'])
  })
})
```
NOTE: adjust the `rec` helper if `ContentRecord` requires other required fields — inspect `src/lib/corpus.ts` and add any missing required fields to the base object so it typechecks.

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run src/components/RemixLibraryPicker.test.ts` → FAIL (module/export missing).

- [ ] **Step 3: Implement** — create `src/components/RemixLibraryPicker.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { corpus } from '../lib/corpusIdb'
import type { ContentRecord } from '../lib/corpus'

/** Pure: reels that have a transcript, matching the query in caption or handle. */
export function filterReels(reels: ContentRecord[], query: string): ContentRecord[] {
  const q = query.trim().toLowerCase()
  return reels.filter((r) => {
    if (!r.transcript || !r.transcript.trim()) return false
    if (!q) return true
    return (r.caption ?? '').toLowerCase().includes(q) || (r.creatorUsername ?? '').toLowerCase().includes(q)
  })
}

/** Searchable list of corpus reels; picking one seeds the remix reference (free — has transcript). */
export function RemixLibraryPicker({ onPick }: { onPick: (reel: { shortCode: string; transcript: string }) => void }) {
  const [reels, setReels] = useState<ContentRecord[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    corpus.listAllContent({ limit: 200 })
      .then((r) => alive && setReels(r))
      .catch(() => alive && setReels([]))
    return () => { alive = false }
  }, [])

  const shown = reels ? filterReels(reels, query) : []

  return (
    <div className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] p-2">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Search size={14} className="text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library by caption or @handle"
          className="flex-1 bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
        />
      </div>
      <div className="max-h-72 overflow-y-auto mt-1">
        {reels === null ? (
          <p className="text-sm text-muted px-2 py-3">Loading your library…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted px-2 py-3">No reels with a transcript match. Analyze creators in chat to fill your library.</p>
        ) : (
          shown.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick({ shortCode: r.id, transcript: r.transcript })}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-[rgba(var(--accent-rgb),0.08)] text-left transition-colors"
            >
              {r.thumbnailUrl
                ? <img src={r.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="w-10 h-12 object-cover rounded flex-shrink-0" />
                : <div className="w-10 h-12 rounded bg-[var(--color-bg)] flex-shrink-0" />}
              <span className="min-w-0">
                <span className="block text-sm text-primary font-medium truncate">@{r.creatorUsername}</span>
                <span className="block text-xs text-secondary truncate">{r.caption || r.transcript.slice(0, 60)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify** — `bunx vitest run src/components/RemixLibraryPicker.test.ts` → PASS. `bun run build` → clean. `bunx eslint src/components/RemixLibraryPicker.tsx`.

- [ ] **Step 5: Commit**
```bash
git add src/components/RemixLibraryPicker.tsx src/components/RemixLibraryPicker.test.ts
git commit -m "feat(script-studio): searchable library reel picker"
```

---

## Task 6: RemixResultPanel (variation tabs + per-field ↻)

**Files:**
- Create: `src/components/RemixResultPanel.tsx`

- [ ] **Step 1: Create the component**
```tsx
import { useState } from 'react'
import { Copy, Check, RotateCw, Loader2, AlertCircle } from 'lucide-react'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'
import { fieldKey, type FieldRef } from '../lib/remixFields'

export type VariationSlot = { status: 'pending' | 'done' | 'failed'; result: ReelRewriteResult | null }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ } }}
      className="inline-flex items-center gap-1 text-xs text-secondary hover:text-primary transition-colors"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function RegenButton({ field, regeneratingKey, onRegenerate }: { field: FieldRef; regeneratingKey: string | null; onRegenerate: (f: FieldRef) => void }) {
  const busy = regeneratingKey === fieldKey(field)
  return (
    <button
      type="button"
      onClick={() => onRegenerate(field)}
      disabled={regeneratingKey !== null}
      title="Regenerate this"
      className="inline-flex items-center gap-1 text-xs text-secondary hover:text-[var(--color-ai-tint)] disabled:opacity-40 transition-colors"
    >
      <RotateCw size={13} className={busy ? 'animate-spin' : undefined} />
    </button>
  )
}

function FieldRow({ label, text, field, regeneratingKey, onRegenerate }: {
  label: string; text: string; field: FieldRef; regeneratingKey: string | null; onRegenerate: (f: FieldRef) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">{label}</span>
        <span className="flex items-center gap-2">
          <RegenButton field={field} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
          <CopyButton text={text} />
        </span>
      </div>
      <p className="mt-1 text-sm text-primary whitespace-pre-wrap">{text}</p>
    </div>
  )
}

export function RemixResultPanel({ slots, activeIndex, onSelect, regeneratingKey, onRegenerate, onRetry }: {
  slots: VariationSlot[]
  activeIndex: number
  onSelect: (i: number) => void
  regeneratingKey: string | null
  onRegenerate: (f: FieldRef) => void
  onRetry: (i: number) => void
}) {
  const active = slots[activeIndex]
  return (
    <section className="rounded-xl border border-[rgba(var(--ai-rgb),0.30)] bg-[rgba(var(--ai-rgb),0.06)] p-4 space-y-4">
      {/* Variation tabs */}
      <div className="flex items-center gap-1">
        {slots.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
              i === activeIndex ? 'bg-[rgba(var(--ai-rgb),0.18)] text-[var(--color-ai-tint)]' : 'text-secondary hover:text-primary'
            }`}
          >
            Variation {i + 1}
            {s.status === 'pending' && <Loader2 size={12} className="animate-spin" />}
            {s.status === 'failed' && <AlertCircle size={12} className="text-red-400" />}
          </button>
        ))}
      </div>

      {active.status === 'pending' && <p className="text-sm text-secondary">Writing this variation…</p>}
      {active.status === 'failed' && (
        <div className="text-sm text-secondary">
          This variation failed.{' '}
          <button type="button" onClick={() => onRetry(activeIndex)} className="text-[var(--color-accent)] hover:underline">Retry</button>
        </div>
      )}

      {active.status === 'done' && active.result && (
        <div className="space-y-4">
          <FieldRow label="Hook" text={active.result.spokenHook} field={{ kind: 'hook' }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
          {active.result.altHooks.some((h) => h.trim()) && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">Alt hooks</span>
              <ul className="mt-1 space-y-1 text-sm text-primary list-disc list-inside">
                {active.result.altHooks.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          )}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">Script</span>
            <ol className="mt-1 space-y-2">
              {active.result.beatScript.map((b, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-ai-tint)] font-medium">{b.beatLabel}</span>
                    <RegenButton field={{ kind: 'beatScript', i }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
                  </div>
                  <p className="text-primary">{b.script}</p>
                  {b.onScreenText && (
                    <p className="text-muted text-xs mt-0.5 flex items-center gap-2">
                      <span>On-screen: {b.onScreenText}</span>
                      <RegenButton field={{ kind: 'beatOverlay', i }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
          <FieldRow label="Caption" text={active.result.caption} field={{ kind: 'caption' }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
          <FieldRow label="CTA" text={active.result.cta} field={{ kind: 'cta' }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
          {active.result.onScreenText.length > 0 && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">On-screen text</span>
              <ul className="mt-1 space-y-1">
                {active.result.onScreenText.map((t, j) => (
                  <li key={j} className="text-sm text-primary flex items-center justify-between gap-2">
                    <span>{t}</span>
                    <RegenButton field={{ kind: 'onScreen', j }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Typecheck** — `bun run build` → clean. `bunx eslint src/components/RemixResultPanel.tsx`.

- [ ] **Step 3: Commit**
```bash
git add src/components/RemixResultPanel.tsx
git commit -m "feat(script-studio): variation tabs + per-field regenerate panel"
```

---

## Task 7: Wire everything into ScriptStudioPage

**Files:**
- Modify (replace whole file): `src/pages/ScriptStudioPage.tsx`

- [ ] **Step 1: Replace the file** with:
```tsx
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Wand2, Loader2, Library, Link2 } from 'lucide-react'
import { useReelRemix, type TranscribeResult } from '../hooks/useReelRemix'
import { friendlyError } from '../lib/errorMessages'
import { RemixLibraryPicker } from '../components/RemixLibraryPicker'
import { RemixVoicePicker, type VoiceChoice } from '../components/RemixVoicePicker'
import { RemixResultPanel, type VariationSlot } from '../components/RemixResultPanel'
import { fieldKey, fieldLabel, applyFieldValue, type FieldRef } from '../lib/remixFields'
import { VARIATION_ANGLES } from '../ai/prompts/reelRemix'
import type { TargetLanguage } from '../ai/prompts/reelRewrite'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'

type Phase = 'input' | 'transcribing' | 'review' | 'generating' | 'result'
const VARIATION_COUNT = 3

export function ScriptStudioPage() {
  const { transcribe, generate, fromLibrary, generateVariations, regenerateField } = useReelRemix()
  const location = useLocation()
  const navigate = useNavigate()
  const abortRef = useRef<AbortController | null>(null)

  const [phase, setPhase] = useState<Phase>('input')
  const [sourceMode, setSourceMode] = useState<'url' | 'library'>('url')
  const [url, setUrl] = useState('')
  const [ref_, setRef] = useState<TranscribeResult | null>(null)
  const [transcript, setTranscript] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [language, setLanguage] = useState<TargetLanguage>('english')
  const [voiceChoice, setVoiceChoice] = useState<VoiceChoice>({})
  const [slots, setSlots] = useState<VariationSlot[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [voice, setVoice] = useState<VoiceProfile | undefined>(undefined)
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = phase === 'transcribing' || phase === 'generating'

  // Seed from a Gallery "Remix this" click (router state), then clear it so refresh doesn't re-seed.
  useEffect(() => {
    const st = location.state as { shortCode?: string; transcript?: string } | null
    if (st?.shortCode && st?.transcript) {
      void (async () => {
        const result = await fromLibrary({ shortCode: st.shortCode!, transcript: st.transcript! })
        setRef(result); setTranscript(result.transcript); setPhase('review')
      })()
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const seedFromLibrary = async (reel: { shortCode: string; transcript: string }) => {
    setError(null)
    const result = await fromLibrary(reel)
    setRef(result); setTranscript(result.transcript); setPhase('review')
  }

  const onFetch = async () => {
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController(); abortRef.current = ac
    setPhase('transcribing')
    try {
      const result = await transcribe(url.trim(), ac.signal)
      setRef(result); setTranscript(result.transcript); setPhase('review')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, (err as Error)?.message ?? 'Could not fetch that video.'))
      setPhase('input')
    }
  }

  const baseArgs = () => ({
    source: ref_!.source,
    editedTranscript: transcript,
    newTopic: newTopic.trim(),
    language,
    clientHandle: voiceChoice.clientHandle,
    pastedScripts: voiceChoice.pastedScripts ? voiceChoice.pastedScripts.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean) : undefined,
  })

  const onGenerate = async () => {
    if (!ref_ || !newTopic.trim() || !transcript.trim()) return
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController(); abortRef.current = ac
    setSlots(Array.from({ length: VARIATION_COUNT }, () => ({ status: 'pending', result: null })))
    setActiveIndex(0)
    setPhase('generating')
    try {
      const { voice: resolvedVoice } = await generateVariations(
        baseArgs(),
        {
          count: VARIATION_COUNT,
          onResult: (i, r) => setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'done', result: r } : s))),
          onError: (i) => setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'failed', result: null } : s))),
        },
        ac.signal,
      )
      if (ac.signal.aborted) return
      setVoice(resolvedVoice)
      setPhase('result')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, 'Could not generate the script.'))
      setPhase('review')
    }
  }

  const onRetry = async (i: number) => {
    if (!ref_) return
    const ac = new AbortController()
    setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'pending', result: null } : s)))
    try {
      const r = await generate({ ...baseArgs(), voice, variationAngle: VARIATION_ANGLES[i % VARIATION_ANGLES.length] }, ac.signal)
      setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'done', result: r } : s)))
    } catch {
      setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'failed', result: null } : s)))
    }
  }

  const onRegenerate = async (field: FieldRef) => {
    if (!ref_ || regeneratingKey) return
    const slot = slots[activeIndex]
    if (slot.status !== 'done' || !slot.result) return
    const key = fieldKey(field)
    setRegeneratingKey(key)
    try {
      const value = await regenerateField({
        current: slot.result, source: ref_.source, fieldLabel: fieldLabel(field),
        newTopic: newTopic.trim(), language, voice,
      })
      if (value) {
        setSlots((prev) => prev.map((s, k) => (k === activeIndex && s.result ? { ...s, result: applyFieldValue(s.result, field, value) } : s)))
      }
    } catch (err) {
      setError(friendlyError(err, 'Could not regenerate that field.'))
    } finally {
      setRegeneratingKey(null)
    }
  }

  const onReset = () => {
    abortRef.current?.abort()
    setPhase('input'); setSourceMode('url'); setUrl(''); setRef(null); setTranscript('')
    setNewTopic(''); setVoiceChoice({}); setSlots([]); setActiveIndex(0); setVoice(undefined); setError(null)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-6">
        <h1 className="font-serif italic text-3xl text-primary flex items-center gap-2">
          <Wand2 size={24} className="text-[var(--color-accent)]" /> Script Studio
        </h1>
        <p className="text-secondary text-sm mt-1">
          Paste a Reel or YouTube Short, or pick one from your library, add your new idea, and get 3 scripts in its exact style.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 text-sm px-3 py-2">{error}</div>
      )}

      {/* Step 1 — Source */}
      <section className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 mb-4">
        <div className="flex items-center gap-1 mb-3">
          <button type="button" onClick={() => setSourceMode('url')} disabled={phase !== 'input'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${sourceMode === 'url' ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'}`}>
            <Link2 size={14} /> Paste URL
          </button>
          <button type="button" onClick={() => setSourceMode('library')} disabled={phase !== 'input'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${sourceMode === 'library' ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'}`}>
            <Library size={14} /> Choose from library
          </button>
        </div>

        {sourceMode === 'url' ? (
          <div className="flex gap-2">
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="instagram.com/reel/… or youtube.com/shorts/…"
              disabled={phase !== 'input' && phase !== 'transcribing'}
              className="flex-1 rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
            <button type="button" onClick={onFetch} disabled={!url.trim() || busy}
              className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5">
              {phase === 'transcribing' ? <Loader2 size={15} className="animate-spin" /> : null}
              {phase === 'transcribing' ? 'Transcribing…' : 'Fetch & Transcribe'}
            </button>
          </div>
        ) : (
          <RemixLibraryPicker onPick={(reel) => void seedFromLibrary(reel)} />
        )}
      </section>

      {/* Step 2 — Review + inputs */}
      {(phase === 'review' || phase === 'generating' || phase === 'result') && ref_ && (
        <section className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 mb-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-primary">Transcript <span className="text-muted font-normal">({ref_.platform})</span></label>
              <span className="text-xs text-muted">Edit any mis-transcribed words</span>
            </div>
            <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={6}
              className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary mb-1.5">Your new video idea</label>
            <input type="text" value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
              placeholder="e.g. how to save your first ₹1 lakh in your 20s"
              className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <span className="block text-xs font-medium text-secondary mb-1.5">Language</span>
              <div className="inline-flex rounded-lg border border-[rgba(var(--border-rgb),0.12)] overflow-hidden">
                {(['english', 'hinglish'] as TargetLanguage[]).map((l) => (
                  <button key={l} type="button" onClick={() => setLanguage(l)}
                    className={`px-3 py-1.5 text-sm capitalize ${language === l ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'}`}>{l}</button>
                ))}
              </div>
            </div>
            <RemixVoicePicker onChange={setVoiceChoice} />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onGenerate} disabled={!newTopic.trim() || !transcript.trim() || busy}
              className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5">
              {phase === 'generating' ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {phase === 'generating' ? 'Generating…' : `Generate ${VARIATION_COUNT} scripts`}
            </button>
            <button type="button" onClick={onReset} className="text-sm text-secondary hover:text-primary">Start over</button>
          </div>
        </section>
      )}

      {/* Step 3 — Variations */}
      {(phase === 'generating' || phase === 'result') && slots.length > 0 && (
        <RemixResultPanel slots={slots} activeIndex={activeIndex} onSelect={setActiveIndex}
          regeneratingKey={regeneratingKey} onRegenerate={(f) => void onRegenerate(f)} onRetry={(i) => void onRetry(i)} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build** — `bun run build` → success. `bunx eslint src/pages/ScriptStudioPage.tsx`. If a type error surfaces (hook return shape, VoiceChoice, slot types), fix it against the real signatures — do not weaken types.

- [ ] **Step 3: Commit**
```bash
git add src/pages/ScriptStudioPage.tsx
git commit -m "feat(script-studio): library source, voice picker, 3 variations, per-field regen"
```

---

## Task 8: Gallery "Remix this" button

**Files:**
- Modify: `src/pages/GalleryPage.tsx`

- [ ] **Step 1: Add navigation + the button.**

(a) Add to imports at the top: change `import { useEffect, useRef, useState } from 'react'` to also import the router hook — add a new line:
```ts
import { useNavigate } from 'react-router-dom'
```
and add `Wand2` to the lucide import list (the existing `import { Clapperboard, Play, Eye, Heart, MessageCircle, ExternalLink, X } from 'lucide-react'`), i.e. append `, Wand2`.

(b) The card component `ReelGalleryCard` currently takes `{ reel, onExpand }`. Add a Remix button in its footer. Replace the `ReelGalleryCard` function with:
```tsx
function ReelGalleryCard({ reel, onExpand, onRemix }: { reel: ContentRecord; onExpand: () => void; onRemix: () => void }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.08)] rounded-xl overflow-hidden flex flex-col">
      <div className="relative aspect-[4/5] w-full bg-[var(--color-bg)] overflow-hidden">
        <ReelThumb reel={reel} />
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Expand reel by @${reel.creatorUsername}`}
          className="group absolute inset-0 flex items-center justify-center"
        >
          <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="relative inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-bg)] bg-[var(--color-accent)] px-3 py-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
            <Play size={13} /> Expand
          </span>
        </button>
      </div>

      <div className="p-3 flex flex-col gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">@{reel.creatorUsername}</span>
        <Metrics reel={reel} />
        {reel.hookArchetype && (
          <span className="self-start text-xs px-2 py-0.5 rounded-full bg-[rgba(var(--ai-rgb),0.10)] text-[var(--color-ai-tint)] border border-[rgba(var(--ai-rgb),0.20)]">
            {reel.hookArchetype}
          </span>
        )}
        {reel.caption && (
          <p className="text-xs text-[var(--color-text-secondary)] leading-snug line-clamp-2">{reel.caption}</p>
        )}
        <button
          type="button"
          onClick={onRemix}
          disabled={!reel.transcript || !reel.transcript.trim()}
          title={reel.transcript ? 'Remix this reel in Script Studio' : 'No transcript captured — cannot remix'}
          className="mt-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg border border-[rgba(var(--ai-rgb),0.30)] text-[var(--color-ai-tint)] px-3 py-1.5 hover:bg-[rgba(var(--ai-rgb),0.10)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Wand2 size={13} /> Remix this
        </button>
      </div>
    </div>
  )
}
```

(c) In `GalleryPage`, add `const navigate = useNavigate()` at the top of the component (next to the `useState` lines), and pass `onRemix` to the card. Replace the card render line:
```tsx
            <ReelGalleryCard key={reel.id} reel={reel} onExpand={() => setSelected(reel)} />
```
with:
```tsx
            <ReelGalleryCard
              key={reel.id}
              reel={reel}
              onExpand={() => setSelected(reel)}
              onRemix={() => navigate('/script-studio', { state: { shortCode: reel.id, transcript: reel.transcript } })}
            />
```

- [ ] **Step 2: Build** — `bun run build` → success. `bunx eslint src/pages/GalleryPage.tsx`.

- [ ] **Step 3: Commit**
```bash
git add src/pages/GalleryPage.tsx
git commit -m "feat(script-studio): 'Remix this' button on Gallery reel cards"
```

---

## Task 9: Full verification

**Files:** none.

- [ ] **Step 1: Full gate** — `bun run test && bun run build` → tests all pass, build clean. `bunx eslint src/lib/remixFields.ts src/components/RemixVoicePicker.tsx src/components/RemixLibraryPicker.tsx src/components/RemixResultPanel.tsx src/pages/ScriptStudioPage.tsx src/pages/GalleryPage.tsx src/hooks/useReelRemix.ts src/ai/prompts/reelRemix.ts` → clean.

- [ ] **Step 2: Manual (Vercel preview, since local `vite dev` has no serverless + is Clerk-gated)** — verify:
  - Gallery → "Remix this" on a reel with a transcript → Script Studio opens at the review step, transcript pre-filled.
  - In-Studio "Choose from library" → search → pick a reel → transcript seeds, no scrape.
  - Saved-voice dropdown lists Memory voices; picking one applies instantly.
  - Generate → 3 variation tabs stream in one at a time (sequential); each is distinct.
  - ↻ on hook / a beat / caption / an overlay → just that field changes; other fields + other variations unchanged.
  - Force one variation to fail (e.g. offline mid-run) → its tab shows Retry; others still render.

- [ ] **Step 3: Branch ready** — `git status` clean; branch `feat/script-studio-v1.1` ready for PR.

---

## Self-review

**Spec coverage:** library reference free/no-scrape ✅ (T3 `fromLibrary` + `buildLibrarySource`, T5 picker, T8 gallery button); saved-voice dropdown ✅ (T4); 3 sequential variations streaming ✅ (T3 `generateVariations`, T7 `onResult`/`onError`); regenerate any single-string field ✅ (T1 prompt, T2 `remixFields`, T3 `regenerateField`, T6 panel ↻); component split ✅ (T4/T5/T6); voice-built-once ✅ (T3); cache-miss transcript-only ✅ (T3 `buildLibrarySource`); fail-soft variations + retry ✅ (T3 `onError`, T7 `onRetry`, T6 tab); router-state cleared ✅ (T7). Edge cases from spec §7 all mapped.

**Placeholder scan:** none — every step has full code. (T5's `rec` test helper carries a note to add any extra required `ContentRecord` fields — that's a concrete instruction, not a placeholder.)

**Type consistency:** `FieldRef`/`fieldKey`/`fieldLabel`/`applyFieldValue` (T2) used identically in T3/T6/T7. `VariationSlot` defined in T6, imported in T7. `VoiceChoice` defined in T4, consumed in T7. `generateVariations` return `{ results, voice }` + `onResult`/`onError` callbacks match T7's usage. `buildReelRemixPrompt` 5th arg `variationAngle` (T1) matches the T3 call. `regenerateField(RegenerateArgs)` fields match T7's call object.
