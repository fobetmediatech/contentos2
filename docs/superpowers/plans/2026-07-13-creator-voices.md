# Creator Voices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Choose a creator" mode to Script Studio — browse a curated, team-shared creator directory by category, pick a creator + type an idea → get an original script in that creator's tone, generated voice-first (no reference reel).

**Architecture:** A new team-shared Supabase table `creator_directory` (RLS: any authenticated teammate reads + edits) with a repo + Zustand store + a code seed; a new voice-first prompt `buildCreatorScriptPrompt`; a `useCreatorScript` hook reusing `buildVoiceProfile` + the existing `REEL_REWRITE_SCHEMA`; and a self-contained `CreatorMode` component wired as a third source mode in `ScriptStudioPage`. `reelRewrite.ts` and the v1/v1.1 remix flow stay untouched.

**Tech Stack:** React 18 + Vite + TS, Supabase (Postgres + RLS, Clerk JWT), Zustand, Gemini via `/api/gemini`, vitest, Tailwind (DESIGN.md tokens).

---

## Spec
`docs/superpowers/specs/2026-07-13-creator-voices-design.md`. Branch: `feat/creator-voices` (stacked on `feat/script-studio-v1.1`).

## Deviations from the spec (deliberate)
- **Dedicated read-only result component** (`CreatorScriptResult.tsx`) instead of adding a `readOnly` prop to `RemixResultPanel` — keeps the just-shipped v1.1 component untouched (lower regression risk); ~40 lines of isolated JSX.
- **No `update` repo method** — an "edit" in the directory editor = remove old + add new (the row id is `${category}:${handle}`, so changing either implies a new id; a display-name-only edit is an idempotent `add` upsert on the same id).

## File map
**New:** `supabase/migrations/20260713000000_creator_directory.sql`; `src/lib/creatorDirectory.ts` (+test); `src/data/creatorDirectorySeed.ts` (+test); `src/store/creatorDirectoryStore.ts`; `src/ai/prompts/creatorScript.ts` (+test); `src/hooks/useCreatorScript.ts`; `src/components/CreatorScriptResult.tsx`; `src/components/CreatorDirectoryEditor.tsx`; `src/components/CreatorMode.tsx`.
**Modified:** `src/pages/ScriptStudioPage.tsx` (third mode).

Test cmd: `bunx vitest run <file>`. Build: `bun run build`. Project has `noUnusedLocals`.

---

## Task 1: Migration — `creator_directory` table + RLS

**Files:** Create `supabase/migrations/20260713000000_creator_directory.sql`

Context: Team-shared table. RLS pattern copied from `supabase/migrations/20260625000000_voice_profiles.sql`, BUT this table allows any authenticated user to INSERT/UPDATE/**DELETE** (anyone edits) — unlike the voice-profiles table which revokes delete and scopes writes to the owner. There is no unit test for a `.sql` file; verification is applying it (deploy-time).

- [ ] **Step 1: Create the migration**
```sql
-- Curated, team-shared creator directory for Script Studio "Choose a creator" mode.
-- Any authenticated teammate can read AND edit (add / update / remove) — a shared resource.
create table if not exists creator_directory (
  id            text        primary key,            -- stable `${category}:${handle}` (idempotent seeding)
  category      text        not null,
  handle        text        not null,               -- Instagram handle, no leading @
  display_name  text        not null,
  created_by    text,                               -- Clerk sub of whoever added it (audit; not enforced)
  created_at    timestamptz not null default now()
);

create index if not exists creator_directory_category_idx on creator_directory (category);

alter table creator_directory enable row level security;

create policy creator_directory_select on creator_directory for select
  using (auth.role() = 'authenticated');
create policy creator_directory_insert on creator_directory for insert
  with check (auth.role() = 'authenticated');
create policy creator_directory_update on creator_directory for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy creator_directory_delete on creator_directory for delete
  using (auth.role() = 'authenticated');
```

- [ ] **Step 2: Sanity-check the SQL** — confirm the filename timestamp `20260713000000` sorts AFTER the latest existing migration (it does — latest is `20260625000000_voice_profiles.sql`). Do NOT attempt to run `supabase db push` here unless the Supabase CLI is linked + authed; that's a deploy step (Task 11 notes it).

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260713000000_creator_directory.sql
git commit -m "feat(creator-voices): creator_directory table + team-shared RLS"
```

---

## Task 2: Repository + pure helpers (`creatorDirectory.ts`)

**Files:** Create `src/lib/creatorDirectory.ts` + test `src/lib/creatorDirectory.test.ts`

Context: Mirrors the corpus repo pattern (`src/lib/supabaseCorpus.ts`). Uses `supabase` from `./supabaseClient` and the Clerk-user-id resolver the same way `supabaseCorpus.ts` does (READ `supabaseCorpus.ts` to copy the exact import — it's `getClerkUserId` from `./clerkToken` or similar; match it). The pure helpers (`directoryId`, `groupByCategory`) are unit-tested.

- [ ] **Step 1: Write the failing test** — create `src/lib/creatorDirectory.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { directoryId, groupByCategory, type DirectoryEntry } from './creatorDirectory'

describe('directoryId', () => {
  it('is stable + normalizes handle/category', () => {
    expect(directoryId('Fitness', '@JeffNippard')).toBe('fitness:jeffnippard')
    expect(directoryId('finance', 'humphreytalks')).toBe('finance:humphreytalks')
  })
})

describe('groupByCategory', () => {
  it('groups entries by category preserving order', () => {
    const e = (id: string, category: string): DirectoryEntry => ({ id, category, handle: id, displayName: id })
    const grouped = groupByCategory([e('a', 'tech'), e('b', 'fitness'), e('c', 'tech')])
    expect(Object.keys(grouped).sort()).toEqual(['fitness', 'tech'])
    expect(grouped.tech.map((x) => x.id)).toEqual(['a', 'c'])
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run src/lib/creatorDirectory.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/lib/creatorDirectory.ts`. FIRST read `src/lib/supabaseCorpus.ts` to copy the exact `supabase` client import and the Clerk-user-id helper import; use the same ones below (shown as `getClerkUserId` — replace if the real name differs):
```ts
/**
 * Creator directory — team-shared curated list of top creators by category, backing
 * Script Studio's "Choose a creator" mode. Mirrors the corpus Supabase-repo pattern.
 */
import { supabase } from './supabaseClient'
import { getClerkUserId } from './clerkToken'

export interface DirectoryEntry {
  id: string          // `${category}:${handle}` (lowercased) — stable, idempotent
  category: string
  handle: string      // Instagram handle, no leading @
  displayName: string
}

/** Stable id from category + handle (both normalized). */
export function directoryId(category: string, handle: string): string {
  return `${category.trim().toLowerCase()}:${handle.replace(/^@/, '').trim().toLowerCase()}`
}

/** Pure: group entries by category, preserving input order within a category. */
export function groupByCategory(entries: DirectoryEntry[]): Record<string, DirectoryEntry[]> {
  const map: Record<string, DirectoryEntry[]> = {}
  for (const e of entries) (map[e.category] ??= []).push(e)
  return map
}

export interface CreatorDirectoryRepository {
  list(): Promise<DirectoryEntry[]>
  /** Insert the seed only when the table is empty (idempotent — safe under concurrent first-loads). Returns the final list. */
  seedIfEmpty(seed: DirectoryEntry[]): Promise<DirectoryEntry[]>
  add(entry: DirectoryEntry): Promise<void>       // upsert on id (also serves display-name edits)
  remove(id: string): Promise<void>
}

interface Row { id: string; category: string; handle: string; display_name: string }
const toEntry = (r: Row): DirectoryEntry => ({ id: r.id, category: r.category, handle: r.handle, displayName: r.display_name })

export function createSupabaseCreatorDirectory(): CreatorDirectoryRepository {
  return {
    async list() {
      const { data, error } = await supabase
        .from('creator_directory')
        .select('id, category, handle, display_name')
        .order('category')
      if (error) throw error
      return ((data ?? []) as Row[]).map(toEntry)
    },
    async seedIfEmpty(seed) {
      const existing = await this.list()
      if (existing.length > 0) return existing
      const userId = await getClerkUserId()
      const rows = seed.map((e) => ({
        id: e.id, category: e.category, handle: e.handle, display_name: e.displayName, created_by: userId,
      }))
      const { error } = await supabase
        .from('creator_directory')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw error
      return this.list()
    },
    async add(entry) {
      const userId = await getClerkUserId()
      const { error } = await supabase
        .from('creator_directory')
        .upsert(
          { id: entry.id, category: entry.category, handle: entry.handle, display_name: entry.displayName, created_by: userId },
          { onConflict: 'id' },
        )
      if (error) throw error
    },
    async remove(id) {
      const { error } = await supabase.from('creator_directory').delete().eq('id', id)
      if (error) throw error
    },
  }
}

/** Runtime instance bound to the Supabase-backed repo. */
export const creatorDirectory = createSupabaseCreatorDirectory()
```

- [ ] **Step 4: Verify** — `bunx vitest run src/lib/creatorDirectory.test.ts` → PASS. `bunx tsc -b` → clean (confirms the `supabase`/`getClerkUserId` imports resolve; if `getClerkUserId` has a different name, fix it to match `supabaseCorpus.ts` — do not invent). `bunx eslint src/lib/creatorDirectory.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/creatorDirectory.ts src/lib/creatorDirectory.test.ts
git commit -m "feat(creator-voices): directory repo + pure helpers (id/group)"
```

---

## Task 3: Seed (`creatorDirectorySeed.ts`)

**Files:** Create `src/data/creatorDirectorySeed.ts` + test `src/data/creatorDirectorySeed.test.ts`

Context: The starter directory. Handles are AI-suggested and MUST be verified (a wrong @handle → the voice scrape returns nothing; the in-app editor fixes them). The `id` uses `directoryId(category, handle)` so seeding is idempotent.

- [ ] **Step 1: Write the failing test** — create `src/data/creatorDirectorySeed.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { DIRECTORY_SEED } from './creatorDirectorySeed'
import { directoryId } from '../lib/creatorDirectory'

describe('DIRECTORY_SEED', () => {
  it('every entry has a matching stable id and no @ in handle', () => {
    for (const e of DIRECTORY_SEED) {
      expect(e.id).toBe(directoryId(e.category, e.handle))
      expect(e.handle.startsWith('@')).toBe(false)
      expect(e.displayName.length).toBeGreaterThan(0)
    }
  })
  it('has no duplicate ids', () => {
    const ids = DIRECTORY_SEED.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('covers several categories', () => {
    expect(new Set(DIRECTORY_SEED.map((e) => e.category)).size).toBeGreaterThanOrEqual(5)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run src/data/creatorDirectorySeed.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/data/creatorDirectorySeed.ts`. Build each entry through `directoryId` so ids always match:
```ts
/**
 * Starter creator directory (Script Studio → Choose a creator).
 *
 * ⚠️ HANDLES ARE AI-SUGGESTED — VERIFY before relying on them. A wrong @handle makes the
 * voice-profile scrape return nothing. Fix/extend via the in-app editor (anyone can edit).
 * These are Instagram handles (voice profiles are synthesized from IG reels).
 */
import { directoryId, type DirectoryEntry } from '../lib/creatorDirectory'

const seed: Array<{ category: string; handle: string; displayName: string }> = [
  // Tech
  { category: 'tech', handle: 'mkbhd', displayName: 'Marques Brownlee' },
  { category: 'tech', handle: 'mrwhosetheboss', displayName: 'Arun Maini' },
  { category: 'tech', handle: 'unboxtherapy', displayName: 'Unbox Therapy' },
  { category: 'tech', handle: 'austinevans', displayName: 'Austin Evans' },
  // Business
  { category: 'business', handle: 'garyvee', displayName: 'Gary Vaynerchuk' },
  { category: 'business', handle: 'hormozi', displayName: 'Alex Hormozi' },
  { category: 'business', handle: 'thedankoe', displayName: 'Dan Koe' },
  { category: 'business', handle: 'codiesanchez', displayName: 'Codie Sanchez' },
  // Fitness
  { category: 'fitness', handle: 'jeffnippard', displayName: 'Jeff Nippard' },
  { category: 'fitness', handle: 'chrisheria', displayName: 'Chris Heria' },
  { category: 'fitness', handle: 'mrandmrsmuscle', displayName: 'Mr & Mrs Muscle' },
  { category: 'fitness', handle: 'syattfitness', displayName: 'Jordan Syatt' },
  // Finance
  { category: 'finance', handle: 'humphreytalks', displayName: 'Humphrey Yang' },
  { category: 'finance', handle: 'herfirst100k', displayName: 'Tori Dunlap' },
  { category: 'finance', handle: 'personalfinanceclub', displayName: 'Personal Finance Club' },
  // Food
  { category: 'food', handle: 'joshuaweissman', displayName: 'Joshua Weissman' },
  { category: 'food', handle: 'thefoodranger', displayName: 'The Food Ranger' },
  { category: 'food', handle: 'nick.digiovanni', displayName: 'Nick DiGiovanni' },
  // Comedy
  { category: 'comedy', handle: 'zachking', displayName: 'Zach King' },
  { category: 'comedy', handle: 'kingbach', displayName: 'King Bach' },
  { category: 'comedy', handle: 'brentrivera', displayName: 'Brent Rivera' },
]

export const DIRECTORY_SEED: DirectoryEntry[] = seed.map((e) => ({
  id: directoryId(e.category, e.handle),
  category: e.category,
  handle: e.handle,
  displayName: e.displayName,
}))
```

- [ ] **Step 4: Verify** — `bunx vitest run src/data/creatorDirectorySeed.test.ts` → PASS. `bunx eslint src/data/creatorDirectorySeed.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/data/creatorDirectorySeed.ts src/data/creatorDirectorySeed.test.ts
git commit -m "feat(creator-voices): starter directory seed (handles need verification)"
```

---

## Task 4: Store (`creatorDirectoryStore.ts`)

**Files:** Create `src/store/creatorDirectoryStore.ts`

Context: Mirrors `makeCorpusStore(repo)` (`src/store/corpusStore.ts`) — a factory taking the repo (so tests can inject a fake), hydrate-once from the repo (seeding if empty), and mirror writes into synchronous state. No test here (thin store; the repo + helpers are tested).

- [ ] **Step 1: Implement** — create `src/store/creatorDirectoryStore.ts`:
```ts
/**
 * Creator directory store — synchronous Zustand mirror over the team-shared directory repo.
 * Mirrors makeCorpusStore: factory takes the repo (injectable in tests), hydrate-once, mirror writes.
 */
import { create } from 'zustand'
import { creatorDirectory, type CreatorDirectoryRepository, type DirectoryEntry } from '../lib/creatorDirectory'
import { DIRECTORY_SEED } from '../data/creatorDirectorySeed'

interface DirectoryState {
  entries: DirectoryEntry[]
  hydrated: boolean
  loading: boolean
  hydrate: () => Promise<void>
  add: (entry: DirectoryEntry) => Promise<void>
  remove: (id: string) => Promise<void>
}

function upsertById(entries: DirectoryEntry[], entry: DirectoryEntry): DirectoryEntry[] {
  const rest = entries.filter((e) => e.id !== entry.id)
  return [...rest, entry]
}

export function makeCreatorDirectoryStore(repo: CreatorDirectoryRepository) {
  return create<DirectoryState>((set, get) => ({
    entries: [],
    hydrated: false,
    loading: false,
    hydrate: async () => {
      if (get().hydrated || get().loading) return
      set({ loading: true })
      try {
        const list = await repo.seedIfEmpty(DIRECTORY_SEED)
        set({ entries: list, hydrated: true, loading: false })
      } catch {
        // Table missing (migration not applied) or offline → empty directory, don't crash.
        set({ entries: [], hydrated: true, loading: false })
      }
    },
    add: async (entry) => {
      await repo.add(entry)
      set({ entries: upsertById(get().entries, entry) })
    },
    remove: async (id) => {
      await repo.remove(id)
      set({ entries: get().entries.filter((e) => e.id !== id) })
    },
  }))
}

export const useCreatorDirectoryStore = makeCreatorDirectoryStore(creatorDirectory)
```

- [ ] **Step 2: Verify** — `bunx tsc -b` → clean. `bunx eslint src/store/creatorDirectoryStore.ts`. `bun run test` → existing suite still green.

- [ ] **Step 3: Commit**
```bash
git add src/store/creatorDirectoryStore.ts
git commit -m "feat(creator-voices): directory Zustand store (hydrate + seed + mirror)"
```

---

## Task 5: Voice-first prompt (`creatorScript.ts`)

**Files:** Create `src/ai/prompts/creatorScript.ts` + test `src/ai/prompts/creatorScript.test.ts`

Context: The core new LLM path — write an ORIGINAL script about an idea, in a creator's voice, with NO reference reel. Grounds on the `VoiceProfile` (built from real reels) + its verbatim `exemplars`. Reuses `REEL_REWRITE_SCHEMA` (imported here only as a re-export convenience is NOT needed — the hook imports it from reelRewrite). Imports `TargetLanguage` + `ReelRewriteResult`? No — this file only builds a prompt string; it imports `VoiceProfile` from `./voiceProfile` and `TargetLanguage` from `./reelRewrite`.

- [ ] **Step 1: Write the failing test** — create `src/ai/prompts/creatorScript.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildCreatorScriptPrompt } from './creatorScript'
import type { VoiceProfile } from './voiceProfile'

const VOICE: VoiceProfile = {
  handle: 'jeffnippard', displayName: 'Jeff Nippard', fromScripts: false,
  vocabulary: ['science-based'], language: 'English', formality: 'casual-expert',
  sentenceRhythm: 'measured', audienceAddress: 'you', toneDescriptors: ['nerdy', 'precise'],
  hookHabits: ['Here are 3 myths...'], emotionalRegister: 'calm authority',
  structuralPattern: 'hook → myth → evidence → takeaway', personaConsistencyScore: 9,
  reelCount: 8, builtAt: 0, exemplars: ['Let me settle this debate once and for all.'],
}

describe('buildCreatorScriptPrompt', () => {
  it('injects the idea + creator handle + language directive', () => {
    const p = buildCreatorScriptPrompt('how to build your first pull-up', VOICE, 'english')
    expect(p).toContain('how to build your first pull-up')
    expect(p).toContain('@jeffnippard')
    expect(p).toContain('ENGLISH')
  })
  it('anchors on the creator exemplars', () => {
    const p = buildCreatorScriptPrompt('idea', VOICE, 'english')
    expect(p).toContain('Let me settle this debate once and for all.')
  })
  it('honors the hinglish toggle', () => {
    const p = buildCreatorScriptPrompt('idea', VOICE, 'hinglish')
    expect(p).toContain('HINGLISH')
  })
  it('handles a profile with no exemplars', () => {
    const p = buildCreatorScriptPrompt('idea', { ...VOICE, exemplars: [] }, 'english')
    expect(p).toContain('idea')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run src/ai/prompts/creatorScript.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/ai/prompts/creatorScript.ts`:
```ts
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
```

- [ ] **Step 4: Verify** — `bunx vitest run src/ai/prompts/creatorScript.test.ts` → PASS. `bunx eslint src/ai/prompts/creatorScript.ts`. `bunx tsc -b` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/ai/prompts/creatorScript.ts src/ai/prompts/creatorScript.test.ts
git commit -m "feat(creator-voices): voice-first creator-script prompt"
```

---

## Task 6: Generation hook (`useCreatorScript.ts`)

**Files:** Create `src/hooks/useCreatorScript.ts`

Context: Reuses `useRepurposeReel().buildVoiceProfile` (cache-or-build; instant if the profile is saved, else scrape+transcribe+synthesize ~50s) and the shared schema/parser. `useKeysStore` returns `{ geminiKeys }`. `callGeminiWithSchema` + `PREMIUM_MODEL` from `../ai/gemini`. No test (hook wiring; the prompt is tested and `buildVoiceProfile` is already covered).

- [ ] **Step 1: Implement** — create `src/hooks/useCreatorScript.ts`:
```ts
/**
 * useCreatorScript — Script Studio "Choose a creator": handle + idea → an original script in
 * the creator's voice. Reuses buildVoiceProfile (cache-or-build) + REEL_REWRITE_SCHEMA/parser.
 */
import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useRepurposeReel } from './useRepurposeReel'
import { callGeminiWithSchema, PREMIUM_MODEL } from '../ai/gemini'
import { REEL_REWRITE_SCHEMA, parseReelRewrite, type ReelRewriteResult, type TargetLanguage } from '../ai/prompts/reelRewrite'
import { buildCreatorScriptPrompt } from '../ai/prompts/creatorScript'

export interface CreatorScriptArgs {
  handle: string
  idea: string
  language: TargetLanguage
}

export function useCreatorScript() {
  const { buildVoiceProfile } = useRepurposeReel()
  const { geminiKeys } = useKeysStore()

  const generate = useCallback(
    async (args: CreatorScriptArgs, signal?: AbortSignal): Promise<ReelRewriteResult> => {
      const handle = args.handle.replace(/^@/, '').trim()
      const voice = await buildVoiceProfile({ sourceReelUrl: '', clientHandle: handle }, signal)
      const raw = await callGeminiWithSchema<ReelRewriteResult>(
        geminiKeys,
        buildCreatorScriptPrompt(args.idea, voice, args.language),
        REEL_REWRITE_SCHEMA,
        { temperature: 0.8, thinkingBudget: 3000, model: PREMIUM_MODEL, signal },
      )
      return parseReelRewrite(raw)
    },
    [buildVoiceProfile, geminiKeys],
  )

  return { generate }
}
```

- [ ] **Step 2: Verify** — `bunx tsc -b` → clean (confirms `buildVoiceProfile` is exported from `useRepurposeReel` and its args accept `{ sourceReelUrl, clientHandle }`; confirms `callGeminiWithSchema` opts). `bunx eslint src/hooks/useCreatorScript.ts`.

- [ ] **Step 3: Commit**
```bash
git add src/hooks/useCreatorScript.ts
git commit -m "feat(creator-voices): useCreatorScript hook (voice-profile → script)"
```

---

## Task 7: Read-only result (`CreatorScriptResult.tsx`)

**Files:** Create `src/components/CreatorScriptResult.tsx`

Context: Renders one `ReelRewriteResult` read-only with copy buttons (violet AI-tint tokens). Self-contained (keeps v1.1's `RemixResultPanel` untouched). `ReelRewriteResult` fields: `spokenHook`, `beatScript: {beatLabel,script,onScreenText}[]`, `caption`, `cta`, `onScreenText: string[]`, `altHooks: string[]`.

- [ ] **Step 1: Implement** — create `src/components/CreatorScriptResult.tsx`:
```tsx
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

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

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">{label}</span>
        <CopyButton text={text} />
      </div>
      <p className="mt-1 text-sm text-primary whitespace-pre-wrap">{text}</p>
    </div>
  )
}

export function CreatorScriptResult({ result }: { result: ReelRewriteResult }) {
  return (
    <section className="rounded-xl border border-[rgba(var(--ai-rgb),0.30)] bg-[rgba(var(--ai-rgb),0.06)] p-4 space-y-4">
      <Field label="Hook" text={result.spokenHook} />
      {result.altHooks.some((h) => h.trim()) && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">Alt hooks</span>
          <ul className="mt-1 space-y-1 text-sm text-primary list-disc list-inside">
            {result.altHooks.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">Script</span>
        <ol className="mt-1 space-y-2">
          {result.beatScript.map((b, i) => (
            <li key={i} className="text-sm">
              <span className="text-[var(--color-ai-tint)] font-medium">{b.beatLabel}</span>
              <p className="text-primary">{b.script}</p>
              {b.onScreenText && <p className="text-muted text-xs mt-0.5">On-screen: {b.onScreenText}</p>}
            </li>
          ))}
        </ol>
      </div>
      <Field label="Caption" text={result.caption} />
      <Field label="CTA" text={result.cta} />
      {result.onScreenText.length > 0 && <Field label="On-screen text" text={result.onScreenText.join('\n')} />}
    </section>
  )
}
```

- [ ] **Step 2: Verify** — `bun run build` → clean. `bunx eslint src/components/CreatorScriptResult.tsx`.

- [ ] **Step 3: Commit**
```bash
git add src/components/CreatorScriptResult.tsx
git commit -m "feat(creator-voices): read-only creator-script result"
```

---

## Task 8: Directory editor (`CreatorDirectoryEditor.tsx`)

**Files:** Create `src/components/CreatorDirectoryEditor.tsx`

Context: Inline editor (anyone can edit the team-shared directory): add a creator (display name, @handle, category — new or existing) and remove one. An "edit" is remove+add (handled by the parent). Reads/writes via `useCreatorDirectoryStore`. Uses `directoryId` to build the id. Categories offered = existing categories + free-text new.

- [ ] **Step 1: Implement** — create `src/components/CreatorDirectoryEditor.tsx`:
```tsx
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useCreatorDirectoryStore } from '../store/creatorDirectoryStore'
import { directoryId, groupByCategory } from '../lib/creatorDirectory'

export function CreatorDirectoryEditor({ onClose }: { onClose: () => void }) {
  const entries = useCreatorDirectoryStore((s) => s.entries)
  const add = useCreatorDirectoryStore((s) => s.add)
  const remove = useCreatorDirectoryStore((s) => s.remove)

  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)

  const cleanHandle = handle.replace(/^@/, '').trim()
  const canAdd = !!name.trim() && !!cleanHandle && !!category.trim() && !busy
  const grouped = groupByCategory(entries)

  const onAdd = async () => {
    if (!canAdd) return
    setBusy(true)
    try {
      await add({
        id: directoryId(category, cleanHandle),
        category: category.trim().toLowerCase(),
        handle: cleanHandle,
        displayName: name.trim(),
      })
      setName(''); setHandle('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(var(--border-rgb),0.12)] bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-primary">Edit directory</h3>
        <button type="button" onClick={onClose} className="text-sm text-secondary hover:text-primary">Done</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name"
          className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle"
          className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="category" list="creator-categories"
          className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
        <datalist id="creator-categories">
          {Object.keys(grouped).map((c) => <option key={c} value={c} />)}
        </datalist>
        <button type="button" onClick={() => void onAdd()} disabled={!canAdd}
          className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-3 py-1.5 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
          <Plus size={14} /> Add
        </button>
      </div>

      <div className="max-h-56 overflow-y-auto space-y-1">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised">
            <span className="text-sm text-primary truncate">
              {e.displayName} <span className="text-muted">@{e.handle}</span> <span className="text-xs text-secondary">· {e.category}</span>
            </span>
            <button type="button" onClick={() => void remove(e.id)} aria-label={`Remove ${e.displayName}`}
              className="text-secondary hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `bun run build` → clean. `bunx eslint src/components/CreatorDirectoryEditor.tsx`.

- [ ] **Step 3: Commit**
```bash
git add src/components/CreatorDirectoryEditor.tsx
git commit -m "feat(creator-voices): in-app directory editor (add/remove)"
```

---

## Task 9: CreatorMode (`CreatorMode.tsx`)

**Files:** Create `src/components/CreatorMode.tsx`

Context: The self-contained "Choose a creator" experience: hydrate the directory, render category-grouped lean cards, pick a creator → idea + language + Generate → `CreatorScriptResult`. Toggle the editor. Uses `useCreatorScript().generate`, `useCreatorDirectoryStore`, `groupByCategory`, `friendlyError`, `CreatorScriptResult`, `CreatorDirectoryEditor`. `TargetLanguage` from `../ai/prompts/reelRewrite`.

- [ ] **Step 1: Implement** — create `src/components/CreatorMode.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import { Wand2, Loader2, Pencil, ArrowLeft } from 'lucide-react'
import { useCreatorDirectoryStore } from '../store/creatorDirectoryStore'
import { groupByCategory, type DirectoryEntry } from '../lib/creatorDirectory'
import { useCreatorScript } from '../hooks/useCreatorScript'
import { friendlyError } from '../lib/errorMessages'
import { CreatorScriptResult } from './CreatorScriptResult'
import { CreatorDirectoryEditor } from './CreatorDirectoryEditor'
import type { TargetLanguage } from '../ai/prompts/reelRewrite'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

export function CreatorMode() {
  const { generate } = useCreatorScript()
  const entries = useCreatorDirectoryStore((s) => s.entries)
  const hydrated = useCreatorDirectoryStore((s) => s.hydrated)
  const abortRef = useRef<AbortController | null>(null)

  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<DirectoryEntry | null>(null)
  const [idea, setIdea] = useState('')
  const [language, setLanguage] = useState<TargetLanguage>('english')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<ReelRewriteResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void useCreatorDirectoryStore.getState().hydrate() }, [])

  const onGenerate = async () => {
    if (!picked || !idea.trim()) return
    setError(null); setResult(null)
    abortRef.current?.abort()
    const ac = new AbortController(); abortRef.current = ac
    setGenerating(true)
    try {
      const r = await generate({ handle: picked.handle, idea: idea.trim(), language }, ac.signal)
      if (ac.signal.aborted) return
      setResult(r)
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, `Couldn't build @${picked.handle}'s voice — check the handle.`))
    } finally {
      setGenerating(false)
    }
  }

  const back = () => { abortRef.current?.abort(); setPicked(null); setIdea(''); setResult(null); setError(null); setGenerating(false) }

  const grouped = groupByCategory(entries)

  // Detail: a creator is picked → idea + generate + result.
  if (picked) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={back} className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary">
          <ArrowLeft size={14} /> All creators
        </button>
        <div className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 space-y-4">
          <div className="text-sm text-primary font-medium">{picked.displayName} <span className="text-muted">@{picked.handle}</span></div>
          <input type="text" value={idea} onChange={(e) => setIdea(e.target.value)}
            placeholder="Your video idea — e.g. why most people fail their first month at the gym"
            className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
          <div className="flex items-center gap-4">
            <div className="inline-flex rounded-lg border border-[rgba(var(--border-rgb),0.12)] overflow-hidden">
              {(['english', 'hinglish'] as TargetLanguage[]).map((l) => (
                <button key={l} type="button" onClick={() => setLanguage(l)}
                  className={`px-3 py-1.5 text-sm capitalize ${language === l ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'}`}>{l}</button>
              ))}
            </div>
            <button type="button" onClick={() => void onGenerate()} disabled={!idea.trim() || generating}
              className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5">
              {generating ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {generating ? 'Writing…' : 'Generate script'}
            </button>
          </div>
          {generating && <p className="text-xs text-muted">First time with this creator can take ~a minute while we learn their voice.</p>}
          {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 text-sm px-3 py-2">{error}</div>}
        </div>
        {result && <CreatorScriptResult result={result} />}
      </div>
    )
  }

  // Directory: category-grouped lean cards.
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-secondary">Pick a creator, then write in their voice.</span>
        <button type="button" onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary">
          <Pencil size={13} /> {editing ? 'Close editor' : 'Edit directory'}
        </button>
      </div>

      {editing && <CreatorDirectoryEditor onClose={() => setEditing(false)} />}

      {!hydrated ? (
        <p className="text-sm text-muted">Loading creators…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">No creators yet. Add some with “Edit directory”.</p>
      ) : (
        Object.keys(grouped).sort().map((category) => (
          <div key={category}>
            <h3 className="text-xs font-mono uppercase tracking-wide text-muted mb-2">{category}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {grouped[category].map((e) => (
                <button key={e.id} type="button" onClick={() => setPicked(e)}
                  className="text-left rounded-lg border border-[rgba(var(--border-rgb),0.12)] bg-surface-raised px-3 py-2 hover:border-[rgba(var(--accent-rgb),0.4)] transition-colors">
                  <span className="block text-sm text-primary font-medium truncate">{e.displayName}</span>
                  <span className="block text-xs text-secondary truncate">@{e.handle}</span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `bun run build` → clean. `bunx eslint src/components/CreatorMode.tsx`.

- [ ] **Step 3: Commit**
```bash
git add src/components/CreatorMode.tsx
git commit -m "feat(creator-voices): CreatorMode (directory + pick + generate)"
```

---

## Task 10: Wire the third mode into ScriptStudioPage

**Files:** Modify `src/pages/ScriptStudioPage.tsx`

Context: Add a third source-mode button "Choose a creator". When `sourceMode === 'creator'`, render `<CreatorMode/>` and skip the URL/library → review → variations blocks entirely.

- [ ] **Step 1: Read the file** to confirm exact anchors (the `sourceMode` state, the two mode buttons, the review/result blocks).

- [ ] **Step 2: Widen the sourceMode type + import** — add the import near the other component imports:
```ts
import { CreatorMode } from '../components/CreatorMode'
import { Users } from 'lucide-react'
```
(Add `Users` to the existing lucide-react import instead of a second import if you prefer; ensure no duplicate import of `lucide-react`.)

Change the state type from `'url' | 'library'` to include `'creator'`:
```ts
  const [sourceMode, setSourceMode] = useState<'url' | 'library' | 'creator'>('url')
```

- [ ] **Step 3: Add the third mode button** — after the "Choose from library" button (inside the mode-toggle row), add:
```tsx
          <button type="button" onClick={() => setSourceMode('creator')} disabled={phase !== 'input'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${sourceMode === 'creator' ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'}`}>
            <Users size={14} /> Choose a creator
          </button>
```

- [ ] **Step 4: Branch the body.** Inside the Step-1 `<section>`, the source input currently is `{sourceMode === 'url' ? (<url input>) : (<RemixLibraryPicker .../>)}`. Change it to a three-way so creator mode replaces the picker:
```tsx
        {sourceMode === 'url' ? (
          <div className="flex gap-2">
            {/* ...existing URL input + Fetch & Transcribe button unchanged... */}
          </div>
        ) : sourceMode === 'library' ? (
          <RemixLibraryPicker onPick={(reel) => void seedFromLibrary(reel)} />
        ) : (
          <CreatorMode />
        )}
```

- [ ] **Step 5: Hide the remix-only blocks in creator mode.** The Step-2 review `<section>` and the Step-3 `RemixResultPanel` belong to the URL/library remix flow. Gate BOTH so they never render in creator mode — change their leading conditions:
  - Review section: `{(phase === 'review' || phase === 'generating' || phase === 'result') && ref_ && sourceMode !== 'creator' && (`
  - Result panel: `{(phase === 'generating' || phase === 'result') && slots.length > 0 && sourceMode !== 'creator' && (`

- [ ] **Step 6: Build** — `bun run build` → clean. `bunx eslint src/pages/ScriptStudioPage.tsx`. `bun run test` → green. Manually confirm (read the diff) that switching to creator mode renders only the mode toggle + `<CreatorMode/>`, and url/library still work.

- [ ] **Step 7: Commit**
```bash
git add src/pages/ScriptStudioPage.tsx
git commit -m "feat(creator-voices): third 'Choose a creator' mode in Script Studio"
```

---

## Task 11: Verification

**Files:** none.

- [ ] **Step 1: Full gate** — `bun run test && bun run build` → tests pass, build clean. Lint all new/changed files: `bunx eslint src/lib/creatorDirectory.ts src/data/creatorDirectorySeed.ts src/store/creatorDirectoryStore.ts src/ai/prompts/creatorScript.ts src/hooks/useCreatorScript.ts src/components/CreatorScriptResult.tsx src/components/CreatorDirectoryEditor.tsx src/components/CreatorMode.tsx src/pages/ScriptStudioPage.tsx` → clean.

- [ ] **Step 2: Apply the migration (deploy env — NOT runnable in the sandbox).** On a machine with the Supabase project linked + authed: `supabase db push` (per the repo's reconciled migration workflow). Confirm the `creator_directory` table + 4 RLS policies exist. Until applied, the directory hydrate fails gracefully to an empty list (Task 4) — so the app builds/runs, it just shows no creators.

- [ ] **Step 3: Manual E2E (Vercel preview — needs serverless `/api/*` + Clerk + the migration applied):**
  - Script Studio → "Choose a creator" → categories render with seeded creators.
  - "Edit directory" → add a creator (name, @handle, category) → it appears; remove one → it disappears; reload → persists (team-shared).
  - Pick a creator with a *correct* handle → enter an idea → Generate → a full script in their tone (first time ~50s; instant on a second idea for the same creator).
  - Pick a creator with a *wrong* handle (or edit one to be wrong) → clear "couldn't build @handle's voice — check the handle" error; fix it in the editor.
  - Hinglish toggle → script comes out in Hinglish.

- [ ] **Step 4: Branch ready** — `git status` clean; `feat/creator-voices` ready for a stacked PR.

---

## Self-review

**Spec coverage:** curated team-shared directory ✅ (T1 table+RLS, T2 repo, T3 seed, T4 store); anyone edits ✅ (T1 RLS allows authenticated CRUD, T8 editor); seeded + in-app editor ✅ (T3, T8); voice-first grounded generation ✅ (T5 prompt on voice+exemplars, T6 hook); inside Script Studio as 3rd mode ✅ (T9 CreatorMode, T10 wiring); one script, read-only + copy ✅ (T7); reuse buildVoiceProfile + schema + friendlyError ✅ (T6); edge cases (wrong handle, first-pick slow, empty directory, concurrent seed idempotent) ✅ (T4 graceful, T6/T9 error, T1 on-conflict); `reelRewrite.ts` untouched ✅.

**Placeholder scan:** none — every step has full code. (T2's `getClerkUserId` import carries an explicit instruction to match `supabaseCorpus.ts`; T3's handles carry an explicit VERIFY note — both are concrete instructions, not placeholders.)

**Type consistency:** `DirectoryEntry`/`directoryId`/`groupByCategory` (T2) used in T3/T4/T8/T9. `CreatorDirectoryRepository` (T2) injected in T4. `DIRECTORY_SEED` (T3) consumed in T4. `buildCreatorScriptPrompt(idea, voice, language)` (T5) called in T6. `useCreatorScript().generate({handle, idea, language})` (T6) called in T9. `CreatorScriptResult({result})` (T7) + `CreatorDirectoryEditor({onClose})` (T8) rendered in T9. `CreatorMode` (T9) rendered in T10. `sourceMode` widened to include `'creator'` consistently in T10.
