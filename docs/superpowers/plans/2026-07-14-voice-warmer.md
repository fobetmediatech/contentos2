# Voice-profile Warmer (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A secret-gated Vercel serverless endpoint (`api/warm-voice-profile.ts`), fired by a scheduled GitHub Action, that proactively builds voice profiles for directory creators who lack one — 1–2 per run, backoff-aware — so Creator Voices is instant at 100+ creators.

**Architecture:** Node serverless in `api/` reusing the app's tested transcription (`getTranscript`) + a copied pure voice prompt + a Node port of `tracking-cron`'s Apify `run-sync` helper + a Supabase service-role write. A small migration adds backoff columns to `creator_directory`. A GitHub Action (Hobby plan → no Vercel Cron) triggers it.

**Tech Stack:** Vercel Node serverless (`api/`, nodenext ESM — imports need `.js`), `@supabase/supabase-js`, Apify `run-sync-get-dataset-items`, Gemini REST, vitest.

---

## Spec
`docs/superpowers/specs/2026-07-14-voice-warmer-design.md`. Branch: `feat/voice-warmer`.

## Key facts (verified from current code)
- `api/` is a self-contained ESM island (`nodenext`) — **cannot import `src/` at runtime**; imports use `.js` extensions (e.g. `./_lib/geminiFiles.js`). Duplicate the pure voice prompt into `api/_lib/`.
- `getTranscript(input, geminiApiKey)` is **exported** from `api/get-transcript.ts` → `{ transcript, segments }`; takes the Apify `downloadedVideo` URL. Reuse it.
- `tracking-cron`'s Deno `apifyRunSync(actorId, input, ring)` (`supabase/functions/tracking-cron/index.ts:85`) is the reference for the Node port (`run-sync-get-dataset-items?token=`, round-robin ring, `ROTATE_STATUSES` failover).
- `getApifyKeys()` (`api/apify.ts:42`): `APIFY_KEY_1..10` + `APIFY_KEYS`. `pickGeminiKey()` pattern (`api/get-transcript.ts:40`): `GEMINI_API_KEY` + `GEMINI_KEYS`.
- Client build (for parity): `apify~instagram-scraper` `{ directUrls:['https://www.instagram.com/<h>/'], resultsType:'posts', resultsLimit:8 }` → reel list; then `apify~instagram-reel-scraper` `{ username:[reelUrls], includeDownloadedVideo:true }` → `downloadedVideo` per shortCode.
- `corpus_voice_profiles` columns: `handle` (pk), `owner_user_id`, `display_name`, `voice_data` jsonb, `reel_count`, `updated_at`.

Test cmd: `bunx vitest run <file>`. api typecheck: `bun run typecheck:api`. Full: `bun run build`.

---

## Task 1: Backoff migration

**Files:** Create `supabase/migrations/20260714000000_creator_directory_warm.sql`

Context: Adds warm-state columns so a bad handle backs off instead of retrying forever. No new RLS (only the service-role warmer writes them; existing select policy exposes them read-only). No unit test for `.sql`.

- [ ] **Step 1: Create the migration**
```sql
-- Warm-state for the voice-profile warmer (api/warm-voice-profile.ts). Only the service-role
-- warmer writes these; the existing select policy already exposes creator_directory read-only.
alter table creator_directory
  add column if not exists warm_attempts        int         not null default 0,
  add column if not exists warm_last_attempt_at  timestamptz,
  add column if not exists warm_last_error       text;
```

- [ ] **Step 2: Sanity-check** the filename sorts newest (after `20260713000000_creator_directory.sql`). Do NOT apply (deploy step).

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260714000000_creator_directory_warm.sql
git commit -m "feat(warmer): creator_directory warm-state columns"
```

---

## Task 2: Copy the pure voice prompt into api/_lib

**Files:** Create `api/_lib/voiceProfilePrompt.ts` + test `api/_lib/voiceProfilePrompt.test.ts`

Context: The api/ boundary can't import `src/`, so copy the pure exports **verbatim**. Source: `src/ai/prompts/voiceProfile.ts` (all of it — `VOICE_PROFILE_PROMPT_VERSION`, `VoiceLanguageMode`, `VoiceProfile`, `VoiceProfileDraft`, `VOICE_PROFILE_SCHEMA`, `buildVoiceProfilePrompt`, `parseVoiceProfile`, and the private `strArr`/`str` helpers) PLUS `pickExemplars` from `src/lib/repurposeHelpers.ts:21`. Both are dependency-free (zero imports) — copy exactly, add nothing.

- [ ] **Step 1: Create the copy** — `api/_lib/voiceProfilePrompt.ts`:
  1. Copy the ENTIRE contents of `src/ai/prompts/voiceProfile.ts` verbatim (it has no imports).
  2. Append the `pickExemplars` function copied verbatim from `src/lib/repurposeHelpers.ts` (the `EXEMPLAR_MAX_CHARS` const + the `export function pickExemplars(samples, max=4)` — lines 14–40), so it's exported from this file too.
  3. Add a one-line header comment: `// COPY of src/ai/prompts/voiceProfile.ts + pickExemplars — api/ can't import src/. Keep in sync (drift test guards VERSION + SCHEMA).`

- [ ] **Step 2: Write the drift-guard test** — `api/_lib/voiceProfilePrompt.test.ts` (tests CAN cross the boundary):
```ts
import { describe, it, expect } from 'vitest'
import * as apiCopy from './voiceProfilePrompt'
import * as srcOrig from '../../src/ai/prompts/voiceProfile'

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
  it('pickExemplars is exported and pure', () => {
    expect(apiCopy.pickExemplars(['Hello there. Second sentence.'])).toEqual(['Hello there. Second sentence.'])
  })
})
```

- [ ] **Step 3: Verify** — `bunx vitest run api/_lib/voiceProfilePrompt.test.ts` → PASS. `bun run typecheck:api` → clean. `bunx eslint api/_lib/voiceProfilePrompt.ts`.

- [ ] **Step 4: Commit**
```bash
git add api/_lib/voiceProfilePrompt.ts api/_lib/voiceProfilePrompt.test.ts
git commit -m "feat(warmer): copy pure voice prompt into api/_lib (drift-tested)"
```

---

## Task 3: Apify run-sync helper (`api/_lib/apifyRun.ts`)

**Files:** Create `api/_lib/apifyRun.ts` + test `api/_lib/apifyRun.test.ts`

Context: Node port of `tracking-cron`'s Deno `apifyRunSync` + `getApifyKeys` (from `api/apify.ts`). `run-sync-get-dataset-items` blocks until the actor finishes and returns items in one call.

- [ ] **Step 1: Write the failing test** — `api/_lib/apifyRun.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { getApifyKeys } from './apifyRun'

const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })

describe('getApifyKeys', () => {
  it('collects numbered + csv keys, trimmed, non-empty', () => {
    process.env.APIFY_KEY_1 = 'a'
    process.env.APIFY_KEY_2 = ''
    process.env.APIFY_KEYS = ' b , c ,'
    expect(getApifyKeys()).toEqual(['a', 'b', 'c'])
  })
  it('empty when nothing set', () => {
    delete process.env.APIFY_KEY_1; delete process.env.APIFY_KEYS
    expect(getApifyKeys()).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run api/_lib/apifyRun.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `api/_lib/apifyRun.ts`:
```ts
/**
 * Apify run-sync helper for server-side background jobs (the voice warmer). Node port of
 * tracking-cron's Deno apifyRunSync: run-sync-get-dataset-items with a round-robin key ring
 * + failover on auth/quota/transient statuses. Self-contained (no browser keyRotator).
 */
const APIFY_BASE = 'https://api.apify.com/v2'
const ACTOR_TIMEOUT_MS = 90_000
const ROTATE_STATUSES = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504])

/** APIFY_KEY_1..10 (numbered) + APIFY_KEYS (comma-separated), trimmed, non-empty. */
export function getApifyKeys(): string[] {
  return [
    ...Array.from({ length: 10 }, (_, i) => process.env[`APIFY_KEY_${i + 1}`] ?? ''),
    ...String(process.env.APIFY_KEYS ?? '').split(','),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
}

export interface KeyRing { keys: string[]; i: number }

/** Run an Apify actor synchronously, rotating the key ring with failover. Throws on hard failure. */
export async function apifyRunSync<T>(
  actorId: string,
  input: Record<string, unknown>,
  ring: KeyRing,
): Promise<T[]> {
  let lastErr = 'no keys configured'
  for (let attempt = 0; attempt < ring.keys.length; attempt++) {
    const token = ring.keys[ring.i % ring.keys.length]
    ring.i++
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ACTOR_TIMEOUT_MS)
    let permanent: string | null = null
    try {
      const res = await fetch(
        `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${token}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: ctrl.signal },
      )
      if (res.ok) {
        const data = (await res.json()) as unknown
        if (Array.isArray(data)) return data as T[]
        const errMsg = (data as { error?: { message?: string } } | null)?.error?.message
        lastErr = errMsg || 'non-array response'
      } else if (ROTATE_STATUSES.has(res.status)) {
        lastErr = `HTTP ${res.status}`
      } else {
        permanent = `HTTP ${res.status} ${res.statusText}`
      }
    } catch (e) {
      lastErr = e instanceof Error ? (e.name === 'AbortError' ? `timeout after ${ACTOR_TIMEOUT_MS}ms` : e.message) : String(e)
    } finally {
      clearTimeout(timer)
    }
    if (permanent) throw new Error(`Apify ${actorId} failed: ${permanent}`)
  }
  throw new Error(`Apify ${actorId}: all ${ring.keys.length} key(s) failed (${lastErr})`)
}
```

- [ ] **Step 4: Verify** — `bunx vitest run api/_lib/apifyRun.test.ts` → PASS. `bun run typecheck:api` → clean. `bunx eslint api/_lib/apifyRun.ts`.

- [ ] **Step 5: Commit**
```bash
git add api/_lib/apifyRun.ts api/_lib/apifyRun.test.ts
git commit -m "feat(warmer): Node Apify run-sync helper + key pool"
```

---

## Task 4: Gemini JSON synthesis helper (`api/_lib/geminiJson.ts`)

**Files:** Create `api/_lib/geminiJson.ts`

Context: A text→JSON Gemini call for voice synthesis (transcripts → profile), mirroring `get-transcript`'s inline call but text-only. Plus `pickGeminiKey`. No unit test (network) — typecheck covers it.

- [ ] **Step 1: Implement** — `api/_lib/geminiJson.ts`:
```ts
/**
 * Text→JSON Gemini call for server-side synthesis (voice-profile build). Mirrors
 * get-transcript's inline generateContent but with a text prompt + responseSchema.
 */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const GEMINI_MODEL = 'gemini-2.5-flash'

/** GEMINI_API_KEY + GEMINI_KEYS (comma-separated), random pick. */
export function pickGeminiKey(): string {
  const keys = [
    ...String(process.env.GEMINI_API_KEY ?? '').split(','),
    ...String(process.env.GEMINI_KEYS ?? '').split(','),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
  return keys[Math.floor(Math.random() * keys.length)] ?? ''
}

/** Generate a JSON object from a text prompt + response schema. Throws on failure. */
export async function geminiGenerateJson(prompt: string, schema: unknown, apiKey: string): Promise<unknown> {
  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Gemini synthesis failed (${res.status})`)
  const parsed = JSON.parse(text) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const out = parsed.candidates?.[0]?.content?.parts?.[0]?.text
  if (!out) throw new Error('Gemini returned no content')
  return JSON.parse(out) as unknown
}
```

- [ ] **Step 2: Verify** — `bun run typecheck:api` → clean. `bunx eslint api/_lib/geminiJson.ts`.

- [ ] **Step 3: Commit**
```bash
git add api/_lib/geminiJson.ts
git commit -m "feat(warmer): Gemini text->JSON synthesis helper"
```

---

## Task 5: Warm selector (`api/_lib/warmSelector.ts`)

**Files:** Create `api/_lib/warmSelector.ts` + test `api/_lib/warmSelector.test.ts`

Context: The pure "which handles to warm next" logic — the unit-testable heart. No existing profile, under attempt cap, past backoff, oldest-first, capped.

- [ ] **Step 1: Write the failing test** — `api/_lib/warmSelector.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { pickHandlesToWarm, type DirectoryRow } from './warmSelector'

const row = (o: Partial<DirectoryRow>): DirectoryRow => ({
  id: o.handle ?? 'x', handle: o.handle ?? 'x', display_name: 'n',
  warm_attempts: o.warm_attempts ?? 0, warm_last_attempt_at: o.warm_last_attempt_at ?? null,
})
const NOW = Date.parse('2026-07-14T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

describe('pickHandlesToWarm', () => {
  it('excludes handles that already have a profile', () => {
    const rows = [row({ handle: 'a' }), row({ handle: 'b' })]
    expect(pickHandlesToWarm(rows, new Set(['a']), NOW, 5).map((r) => r.handle)).toEqual(['b'])
  })
  it('excludes handles at the attempt cap', () => {
    const rows = [row({ handle: 'a', warm_attempts: 5 }), row({ handle: 'b', warm_attempts: 4 })]
    expect(pickHandlesToWarm(rows, new Set(), NOW, 5).map((r) => r.handle)).toEqual(['b'])
  })
  it('excludes handles that failed within the 24h backoff', () => {
    const rows = [row({ handle: 'a', warm_last_attempt_at: hoursAgo(2) }), row({ handle: 'b', warm_last_attempt_at: hoursAgo(30) })]
    expect(pickHandlesToWarm(rows, new Set(), NOW, 5).map((r) => r.handle)).toEqual(['b'])
  })
  it('orders never-attempted first, then oldest attempt, and caps to limit', () => {
    const rows = [
      row({ handle: 'old', warm_last_attempt_at: hoursAgo(48) }),
      row({ handle: 'new' }), // never attempted
      row({ handle: 'older', warm_last_attempt_at: hoursAgo(72) }),
    ]
    expect(pickHandlesToWarm(rows, new Set(), NOW, 2).map((r) => r.handle)).toEqual(['new', 'older'])
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run api/_lib/warmSelector.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `api/_lib/warmSelector.ts`:
```ts
/** Pure selector for the voice warmer — which directory handles to build next. Unit-tested. */
export interface DirectoryRow {
  id: string
  handle: string
  display_name: string
  warm_attempts: number
  warm_last_attempt_at: string | null
}

const MAX_ATTEMPTS = 5
const BACKOFF_MS = 24 * 60 * 60 * 1000

/** Handles with no profile, under the attempt cap, past backoff — never-attempted first, oldest next, capped. */
export function pickHandlesToWarm(
  rows: DirectoryRow[],
  existingHandles: Set<string>,
  nowMs: number,
  limit: number,
): DirectoryRow[] {
  const at = (r: DirectoryRow) => (r.warm_last_attempt_at == null ? -1 : Date.parse(r.warm_last_attempt_at))
  return rows
    .filter((r) => !existingHandles.has(r.handle))
    .filter((r) => r.warm_attempts < MAX_ATTEMPTS)
    .filter((r) => r.warm_last_attempt_at == null || nowMs - Date.parse(r.warm_last_attempt_at) >= BACKOFF_MS)
    .sort((a, b) => at(a) - at(b))
    .slice(0, limit)
}
```

- [ ] **Step 4: Verify** — `bunx vitest run api/_lib/warmSelector.test.ts` → PASS. `bun run typecheck:api` → clean. `bunx eslint api/_lib/warmSelector.ts`.

- [ ] **Step 5: Commit**
```bash
git add api/_lib/warmSelector.ts api/_lib/warmSelector.test.ts
git commit -m "feat(warmer): pure warm-selector (backoff + ordering)"
```

---

## Task 6: The warmer handler (`api/warm-voice-profile.ts`)

**Files:** Create `api/warm-voice-profile.ts`

Context: Orchestrates: secret auth → service-role Supabase → select 1–2 → per-handle build (Apify reel list → Apify video resolve → `getTranscript` per reel → `geminiGenerateJson` synthesis → upsert) → backoff update. Imports use `.js` (nodenext). `@supabase/supabase-js` is already a dependency.

- [ ] **Step 1: Implement** — `api/warm-voice-profile.ts`:
```ts
/**
 * POST /api/warm-voice-profile — Vercel serverless (Node). SECRET-gated background warmer.
 *
 * Triggered by a scheduled GitHub Action (Authorization: Bearer $CRON_SECRET). Builds voice
 * profiles for a few directory creators that don't have one yet — scrape reels (Apify) →
 * transcribe (reused getTranscript) → synthesize (Gemini) → upsert corpus_voice_profiles
 * (service-role). Backoff-aware so a bad handle doesn't retry forever. Team-shared cache →
 * each creator built once, ever. Never logs research-target data (C3): counts/handles only.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getTranscript } from './get-transcript.js'
import { getApifyKeys, apifyRunSync, type KeyRing } from './_lib/apifyRun.js'
import { pickGeminiKey, geminiGenerateJson } from './_lib/geminiJson.js'
import {
  buildVoiceProfilePrompt, VOICE_PROFILE_SCHEMA, parseVoiceProfile, pickExemplars,
} from './_lib/voiceProfilePrompt.js'
import { pickHandlesToWarm, type DirectoryRow } from './_lib/warmSelector.js'

export const config = { maxDuration: 300 }

const MAX_HANDLES_PER_RUN = 2
const REEL_LIMIT = 8

interface ReelListItem { shortCode?: string; url?: string; caption?: string | null }
interface ReelVideoItem { shortCode?: string; downloadedVideo?: string }

/** Build + upsert ONE creator's voice profile. Throws on any failure (caller records backoff). */
async function warmHandle(supabase: SupabaseClient, entry: DirectoryRow, geminiKey: string, ring: KeyRing): Promise<void> {
  const handle = entry.handle.replace(/^@/, '')

  const posts = await apifyRunSync<ReelListItem>('apify~instagram-scraper', {
    directUrls: [`https://www.instagram.com/${handle}/`], resultsType: 'posts', resultsLimit: REEL_LIMIT,
  }, ring)
  const reels = posts.filter((p) => p.shortCode).slice(0, REEL_LIMIT)
  if (reels.length === 0) throw new Error('no reels')
  const reelUrls = reels.map((r) => r.url ?? `https://www.instagram.com/reel/${r.shortCode}/`)
  const captions = reels.map((r) => r.caption ?? '').filter((c): c is string => !!c)

  const videos = await apifyRunSync<ReelVideoItem>('apify~instagram-reel-scraper', {
    username: reelUrls, includeDownloadedVideo: true,
  }, ring)
  const videoByCode = new Map<string, string>()
  for (const v of videos) if (v.shortCode && v.downloadedVideo) videoByCode.set(v.shortCode, v.downloadedVideo)

  const transcripts: string[] = []
  for (const r of reels) {
    const vurl = r.shortCode ? videoByCode.get(r.shortCode) : undefined
    if (!vurl || !r.shortCode) continue
    try {
      const { transcript } = await getTranscript({ downloadedVideoUrl: vurl, shortCode: r.shortCode }, geminiKey)
      if (transcript && transcript.trim()) transcripts.push(transcript)
    } catch { /* skip this reel */ }
  }
  if (transcripts.length === 0) throw new Error('no transcripts')

  const raw = await geminiGenerateJson(buildVoiceProfilePrompt(handle, transcripts, captions), VOICE_PROFILE_SCHEMA, geminiKey)
  const profile = parseVoiceProfile(raw, {
    handle, displayName: entry.display_name, reelCount: transcripts.length,
    builtAt: Date.now(), fromScripts: false, exemplars: pickExemplars(transcripts),
  })

  const { error } = await supabase.from('corpus_voice_profiles').upsert({
    handle, owner_user_id: 'system:warmer', display_name: profile.displayName,
    voice_data: profile, reel_count: profile.reelCount, updated_at: new Date().toISOString(),
  }, { onConflict: 'handle' })
  if (error) throw new Error(error.message)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: 'Unauthorized' }); return }

  const apifyKeys = getApifyKeys()
  const geminiKey = pickGeminiKey()
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!apifyKeys.length || !geminiKey || !supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Server misconfigured (APIFY/GEMINI/SUPABASE env)' }); return
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const [dirRes, profRes] = await Promise.all([
    supabase.from('creator_directory').select('id, handle, display_name, warm_attempts, warm_last_attempt_at'),
    supabase.from('corpus_voice_profiles').select('handle'),
  ])
  if (dirRes.error || profRes.error) {
    res.status(500).json({ error: (dirRes.error ?? profRes.error)?.message ?? 'read failed' }); return
  }
  const existing = new Set(((profRes.data ?? []) as { handle: string }[]).map((p) => p.handle))
  const rows = (dirRes.data ?? []) as DirectoryRow[]
  const toWarm = pickHandlesToWarm(rows, existing, Date.now(), MAX_HANDLES_PER_RUN)

  const ring: KeyRing = { keys: apifyKeys, i: 0 }
  const warmed: string[] = []
  const failed: string[] = []
  for (const entry of toWarm) {
    const nowIso = new Date().toISOString()
    try {
      await warmHandle(supabase, entry, geminiKey, ring)
      warmed.push(entry.handle)
      await supabase.from('creator_directory').update({ warm_last_attempt_at: nowIso, warm_last_error: null }).eq('id', entry.id)
    } catch (err) {
      failed.push(entry.handle)
      const msg = err instanceof Error ? err.message : String(err)
      await supabase.from('creator_directory')
        .update({ warm_attempts: entry.warm_attempts + 1, warm_last_attempt_at: nowIso, warm_last_error: msg.slice(0, 200) })
        .eq('id', entry.id)
    }
  }

  res.status(200).json({ warmed, failed, eligible: toWarm.length, directory: rows.length, profiled: existing.size })
}
```

- [ ] **Step 2: Verify** — `bun run typecheck:api` → clean (this is the real gate: confirms `getTranscript`'s exported type, the `.js` imports resolve, the supabase-js types, and the voice-prompt copy's exports line up). `bunx eslint api/warm-voice-profile.ts`. `bun run build` → clean. `bun run test` → existing suite green (this file adds no failing tests).

  If typecheck flags the `parseVoiceProfile(raw, …)` first-arg type (it expects `unknown` → fine) or a supabase generic, fix against the real types — do NOT weaken with `any` beyond the documented item interfaces.

- [ ] **Step 3: Commit**
```bash
git add api/warm-voice-profile.ts
git commit -m "feat(warmer): warm-voice-profile endpoint (scrape->transcribe->synthesize->upsert)"
```

---

## Task 7: The GitHub Action trigger

**Files:** Create `.github/workflows/voice-warmer.yml`

Context: Clone of `.github/workflows/tracking-cron.yml`. Hobby plan → GitHub Action (not Vercel Cron). Every 15 min, `curl` the deployed endpoint with the shared secret. Uses repo secrets `CRON_SECRET` + `WARMER_URL`.

- [ ] **Step 1: Create** — `.github/workflows/voice-warmer.yml`:
```yaml
name: Voice Profile Warmer

on:
  schedule:
    # Every 15 min — the endpoint warms 1-2 uncached directory creators per run.
    - cron: '*/15 * * * *'
  workflow_dispatch: # Manual trigger for testing

jobs:
  warm:
    name: Warm voice profiles
    runs-on: ubuntu-latest
    steps:
      - name: Call the warmer endpoint
        run: |
          curl -fsSL \
            -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.WARMER_URL }}"
```

- [ ] **Step 2: Sanity-check** the YAML (2-space indent, valid `on.schedule.cron`). No test.

- [ ] **Step 3: Commit**
```bash
git add .github/workflows/voice-warmer.yml
git commit -m "feat(warmer): scheduled GitHub Action trigger (every 15 min)"
```

---

## Task 8: Verification

**Files:** none.

- [ ] **Step 1: Full gate** — `bun run test && bun run build` → pass + clean. `bun run typecheck:api` → clean. `bunx eslint api/_lib/voiceProfilePrompt.ts api/_lib/apifyRun.ts api/_lib/geminiJson.ts api/_lib/warmSelector.ts api/warm-voice-profile.ts` → clean.

- [ ] **Step 2: Drift guard proven** — `bunx vitest run api/_lib/voiceProfilePrompt.test.ts` passes (the api/ voice-prompt copy == src). If it ever fails later, someone changed `src/ai/prompts/voiceProfile.ts` without updating the copy.

- [ ] **Step 3: Manual E2E (deploy env — NOT runnable in sandbox).** After merge + the deploy steps (migration applied; Vercel env `CRON_SECRET`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_URL`; GitHub secrets `CRON_SECRET`/`WARMER_URL`): `curl -X POST -H "Authorization: Bearer $CRON_SECRET" $WARMER_URL` → expect `{ warmed:[…], failed:[…], … }`; confirm a `corpus_voice_profiles` row appeared for a warmed handle and Creator Voices shows that creator as instant (no ~50s build). Confirm a deliberately-wrong handle increments `warm_attempts` + sets `warm_last_error` (backoff).

- [ ] **Step 4: Branch ready** — `git status` clean; `feat/voice-warmer` ready for PR.

---

## Self-review

**Spec coverage:** secret-gated Vercel endpoint ✅ (T6); Vercel-serverless reusing `getTranscript` ✅ (T6); scrape→transcribe→synthesize→upsert ✅ (T6 `warmHandle`); service-role write w/ `owner_user_id: 'system:warmer'` ✅ (T6); 1–2/run + backoff selector ✅ (T5, T6); backoff migration ✅ (T1); copied voice prompt + drift guard ✅ (T2); Apify run-sync + key pool ✅ (T3); Gemini synthesis ✅ (T4); GitHub Action trigger ✅ (T7); edge cases (no reels/no transcripts/bad handle → backoff; capped/run) ✅ (T6). Deploy steps captured for the final consolidated checklist.

**Placeholder scan:** none — full code, except T2's verbatim-copy instruction (the content IS the existing `voiceProfile.ts` + `pickExemplars`, fully specified by source path + "copy exactly, no imports").

**Type consistency:** `KeyRing`/`apifyRunSync`/`getApifyKeys` (T3) used in T6. `pickGeminiKey`/`geminiGenerateJson` (T4) used in T6. `buildVoiceProfilePrompt`/`VOICE_PROFILE_SCHEMA`/`parseVoiceProfile`/`pickExemplars` (T2 copy) used in T6. `pickHandlesToWarm`/`DirectoryRow` (T5) used in T6. `getTranscript` returns `{transcript,segments}` — T6 destructures `transcript`. The migration columns (T1: `warm_attempts`/`warm_last_attempt_at`/`warm_last_error`) match `DirectoryRow` (T5) + the T6 update calls.
