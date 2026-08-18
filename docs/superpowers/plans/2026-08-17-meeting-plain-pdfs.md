# Meeting Plain PDFs Implementation Plan (PR 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print two plain documents from any ingested call — a generated meeting summary (discussion, decisions, action items, key numbers, all timestamped) and the full raw transcript.

**Architecture:** A new `summary` action on `api/strategy-ai.ts` generates the summary once and caches it on `cb_transcripts`. A single print page renders either view using the print CSS the app already has. No PDF library — `window.print()` plus the existing `@media print` rules, matching how the report and deck already export.

**Tech Stack:** React 19 + react-router-dom, Tailwind, Vercel serverless functions (Node ESM), Supabase Postgres, Gemini 2.5 Flash, vitest, bun.

Spec: `docs/superpowers/specs/2026-08-17-meeting-chat-bot-design.md`

**Independent of PR 1.** The only overlap is `src/App.tsx` (a different route line), `src/lib/reviewRepo.ts` (a different appended function), and `src/pages/StrategyMeetingPage.tsx` (Task 6). Either PR can land first; Task 6 says what to do in each order.

## Global Constraints

- **Do NOT add a file to `api/`.** It holds 11 files; Vercel's Hobby cap is 12 Serverless Functions per deployment. Exceeding it fails at "Deploying outputs…" with an otherwise clean build. The summary is a new **action on `strategy-ai.ts`**, with its body in `api/_lib/`.
- **`api/_lib/` modules must not import from `../src`.** Server-side, ESM, self-contained; import paths carry `.js`.
- **Never read the Gemini key from `process.env` directly** — always `pickGeminiKey()` from `./geminiJson.js`. `GEMINI_API_KEY` is a comma-separated pool; reading it raw caused a production 401. `api/_lib/geminiKeyUsage.test.ts` guards this.
- **No new dependency.** `package.json` has no PDF library and needs none. Printing is `window.print()` + the existing `.report-printable` / `.no-print` classes in `src/index.css`.
- **Render the summary from `full_text`, never from `cb_transcript_chunks`.** The chunks carry deliberate overlap for retrieval quality, so concatenating them duplicates text at every boundary.
- **Design system:** read `DESIGN.md` before any visual work. The existing print rules force dark-on-white inside `.report-printable`; do not fight them with new colours.
- **Commands:** `bun run build`, `bun run lint`, `bunx vitest run <path>`, `bun run test`.
- **Migrations are applied by a human.** `supabase db push` from inside Claude Code is blocked by the permission classifier on production DDL.

---

### Task 1: Migration — cache the generated summary

**Files:**
- Create: `supabase/migrations/20260817000001_transcript_summary.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `cb_transcripts.summary jsonb` and `cb_transcripts.summary_generated_at timestamptz`, both nullable.

**Why cache:** a summary is one Gemini call over a 60-minute transcript, and the whole team views the same meeting repeatedly. Regenerating per view spends real money for an identical result. Nullable with no default, so an ungenerated summary is distinguishable from an empty one.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260817000001_transcript_summary.sql`:

```sql
-- Cached plain-text meeting summary, for the printable minutes.
--
-- One Gemini call over a full transcript, viewed repeatedly by the whole team — so it is generated
-- once and stored. Both columns are NULLABLE with no default: null means "never generated", which
-- must stay distinguishable from a summary that genuinely found no action items.
--
-- No RLS change. These columns inherit cb_transcripts' existing policies (open to any signed-in
-- member since 20260810000000).
--
-- Run in the Supabase SQL editor, or `supabase db push --linked`.

alter table cb_transcripts add column if not exists summary jsonb;
alter table cb_transcripts add column if not exists summary_generated_at timestamptz;
```

- [ ] **Step 2: Verify the column-drift guard picks up the new columns**

`api/_lib/cbColumnDrift.test.ts` parses migrations for existing columns and cross-checks every column the app references. It already handles `alter table … add column`, so these two are registered automatically.

Run: `bunx vitest run api/_lib/cbColumnDrift.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260817000001_transcript_summary.sql
git commit -m "feat(summary): cache the generated meeting summary on cb_transcripts"
```

- [ ] **Step 4: Hand off to a human for application**

Say to the user, verbatim:

> Migration `20260817000001_transcript_summary.sql` is committed but NOT applied — I can't run `supabase db push` (the permission classifier blocks production DDL). Please apply it before Task 3's code ships, or the summary write will fail on an unknown column.

---

### Task 2: Summary prompt, schema, and a pure normaliser

**Files:**
- Create: `api/_lib/summaryPrompt.ts`
- Test: `api/_lib/summaryPrompt.test.ts`

**Interfaces:**
- Consumes: nothing (pure module — no network, no env).
- Produces:
  - `export interface SummaryItem { text: string; timestamp: string }`
  - `export interface ActionItem { text: string; owner: string | null; timestamp: string }`
  - `export interface KeyNumber { label: string; value: string; timestamp: string }`
  - `export interface MeetingSummary { discussion: SummaryItem[]; decisions: SummaryItem[]; actionItems: ActionItem[]; keyNumbers: KeyNumber[] }`
  - `export const SUMMARY_SCHEMA: unknown`
  - `export function buildSummaryPrompt(title: string | null, fullText: string): string`
  - `export function normaliseSummary(raw: unknown): MeetingSummary`

**Why a normaliser:** `responseSchema` constrains the model but does not make the response trustworthy — truncation from MAX_TOKENS or safety filtering can still yield partial objects, and this value goes straight into a `jsonb` column that the print page then renders. Normalising at the boundary means malformed entries are dropped once, here, instead of crashing a print view later.

- [ ] **Step 1: Write the failing tests**

Create `api/_lib/summaryPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSummaryPrompt, normaliseSummary } from './summaryPrompt.js'

describe('buildSummaryPrompt', () => {
  it('includes the title and the transcript', () => {
    const out = buildSummaryPrompt('Onboarding Call - Abhijeet', 'Speaker A: hello')
    expect(out).toContain('Onboarding Call - Abhijeet')
    expect(out).toContain('Speaker A: hello')
  })

  it('survives a null title', () => {
    expect(buildSummaryPrompt(null, 'text')).toContain('text')
  })

  // A 60-minute call is well within the model's context, but an unbounded slice is how a runaway
  // row turns one request into a timeout.
  it('caps the transcript length', () => {
    const out = buildSummaryPrompt(null, 'x'.repeat(300_000))
    expect(out.length).toBeLessThan(220_000)
  })
})

describe('normaliseSummary', () => {
  it('returns empty sections for junk input', () => {
    expect(normaliseSummary(null)).toEqual({ discussion: [], decisions: [], actionItems: [], keyNumbers: [] })
    expect(normaliseSummary('nope')).toEqual({ discussion: [], decisions: [], actionItems: [], keyNumbers: [] })
  })

  it('keeps well-formed entries', () => {
    const out = normaliseSummary({
      discussion: [{ text: 'Budget discussed', timestamp: '4:12' }],
      decisions: [{ text: 'Go with plan B', timestamp: '18:00' }],
      action_items: [{ text: 'Send the deck', owner: 'Aditya', timestamp: '55:30' }],
      key_numbers: [{ label: 'Monthly retainer', value: '80,000', timestamp: '21:05' }],
    })
    expect(out.discussion).toEqual([{ text: 'Budget discussed', timestamp: '4:12' }])
    expect(out.decisions).toEqual([{ text: 'Go with plan B', timestamp: '18:00' }])
    expect(out.actionItems).toEqual([{ text: 'Send the deck', owner: 'Aditya', timestamp: '55:30' }])
    expect(out.keyNumbers).toEqual([{ label: 'Monthly retainer', value: '80,000', timestamp: '21:05' }])
  })

  it('drops entries with no text and defaults a missing owner to null', () => {
    const out = normaliseSummary({
      discussion: [{ text: '', timestamp: '1:00' }, { text: 'Kept', timestamp: '2:00' }],
      action_items: [{ text: 'No owner named', timestamp: '3:00' }],
    })
    expect(out.discussion).toEqual([{ text: 'Kept', timestamp: '2:00' }])
    expect(out.actionItems).toEqual([{ text: 'No owner named', owner: null, timestamp: '3:00' }])
  })

  it('defaults a missing timestamp to an empty string rather than inventing one', () => {
    const out = normaliseSummary({ decisions: [{ text: 'Agreed' }] })
    expect(out.decisions).toEqual([{ text: 'Agreed', timestamp: '' }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run api/_lib/summaryPrompt.test.ts`
Expected: FAIL — cannot resolve `./summaryPrompt.js`.

- [ ] **Step 3: Implement it**

Create `api/_lib/summaryPrompt.ts`:

```ts
/**
 * Plain meeting summary — prompt, response schema, and a normaliser (SERVER-SIDE, ESM,
 * self-contained).
 *
 * This is the unstyled counterpart to the FOBET deck: minutes a human can read and print.
 *
 * The normaliser exists because responseSchema constrains the model without making its output
 * trustworthy — MAX_TOKENS and safety filtering can still truncate a response into a partial object.
 * That value goes straight into a jsonb column and is then rendered by the print page, so malformed
 * entries are dropped once, here, rather than crashing a print view later.
 *
 * Timestamps are `m:ss`, matching fmtTime in handlerAsk.ts. A MISSING timestamp becomes an empty
 * string, never a guess: a fabricated timestamp in printed minutes is worse than an absent one,
 * because it looks verifiable.
 */

/** Deliberate cap. A 60-minute call is far inside the model's context; an unbounded slice is how one
 *  runaway row turns a request into a timeout. */
const MAX_TRANSCRIPT_CHARS = 200_000

export interface SummaryItem {
  text: string
  timestamp: string
}

export interface ActionItem {
  text: string
  owner: string | null
  timestamp: string
}

export interface KeyNumber {
  label: string
  value: string
  timestamp: string
}

export interface MeetingSummary {
  discussion: SummaryItem[]
  decisions: SummaryItem[]
  actionItems: ActionItem[]
  keyNumbers: KeyNumber[]
}

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    discussion: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, timestamp: { type: 'string' } },
        required: ['text', 'timestamp'],
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, timestamp: { type: 'string' } },
        required: ['text', 'timestamp'],
      },
    },
    action_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          owner: { type: 'string', nullable: true },
          timestamp: { type: 'string' },
        },
        required: ['text', 'timestamp'],
      },
    },
    key_numbers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
          timestamp: { type: 'string' },
        },
        required: ['label', 'value', 'timestamp'],
      },
    },
  },
  required: ['discussion', 'decisions', 'action_items', 'key_numbers'],
} as const

const SYSTEM = `You write plain, factual minutes for a client call, using ONLY the transcript below.

RULES:
- Never invent a number, date, name or commitment. If a figure is not stated in the transcript, it
  does not exist. These minutes get printed and sent; an invented figure is worse than a gap.
- Give every entry a timestamp in m:ss form, taken from the transcript. If you cannot locate one,
  use an empty string — do NOT guess.
- action_items: only things someone actually committed to. owner is the person named, or null.
- key_numbers: figures the client stated — budget, retainer, ticket size, timelines, volumes.
- Be brief. Prefer the client's own phrasing.
- Write in LATIN script only. Romanise any Hindi as Hinglish; never output Devanagari.`

export function buildSummaryPrompt(title: string | null, fullText: string): string {
  return `${SYSTEM}\n\nMEETING: ${title ?? 'Untitled call'}\n\nTRANSCRIPT:\n${fullText.slice(0, MAX_TRANSCRIPT_CHARS)}`
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    : []

/** Drop anything without content; never fabricate a timestamp or an owner. */
export function normaliseSummary(raw: unknown): MeetingSummary {
  const r = (Boolean(raw) && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const items = (v: unknown): SummaryItem[] =>
    arr(v)
      .map((x) => ({ text: str(x.text), timestamp: str(x.timestamp) }))
      .filter((x) => x.text !== '')

  return {
    discussion: items(r.discussion),
    decisions: items(r.decisions),
    actionItems: arr(r.action_items)
      .map((x) => ({ text: str(x.text), owner: str(x.owner) || null, timestamp: str(x.timestamp) }))
      .filter((x) => x.text !== ''),
    keyNumbers: arr(r.key_numbers)
      .map((x) => ({ label: str(x.label), value: str(x.value), timestamp: str(x.timestamp) }))
      .filter((x) => x.label !== '' || x.value !== ''),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run api/_lib/summaryPrompt.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/summaryPrompt.ts api/_lib/summaryPrompt.test.ts
git commit -m "feat(summary): meeting-minutes prompt, schema and boundary normaliser"
```

---

### Task 3: The `summary` action

**Files:**
- Create: `api/_lib/handlerSummary.ts`
- Modify: `api/strategy-ai.ts` (one import, one `case`, one entry in the `allowed` array, one line in the header comment)

**Interfaces:**
- Consumes: `requireClerkUser` from `./auth.js`; `geminiGenerateJson` + `pickGeminiKey` from `./geminiJson.js`; `buildSummaryPrompt`, `SUMMARY_SCHEMA`, `normaliseSummary`, `MeetingSummary` from `./summaryPrompt.js` (Task 2).
- Produces: `POST /api/strategy-ai` with `{ action: 'summary', transcriptId: string, force?: boolean }` returning `{ summary: MeetingSummary, cached: boolean, title: string | null, meetingDate: string | null, generatedAt: string | null }`.

**Follow the existing shape:** copy the `bearer()` + `rest()` helpers from `handlerAsk.ts`. The caller's token is forwarded to PostgREST so RLS still applies — do not use a service key.

- [ ] **Step 1: Write the handler**

Create `api/_lib/handlerSummary.ts`:

```ts
/**
 * POST /api/strategy-ai { action: 'summary' } — plain meeting minutes for one transcript.
 *
 * Generated once and cached on cb_transcripts.summary: one Gemini call over a full transcript, and
 * the whole team opens the same meeting repeatedly. `force: true` regenerates.
 *
 * Reads full_text, NOT cb_transcript_chunks — the chunks overlap on purpose for retrieval quality,
 * so concatenating them duplicates text at every boundary.
 *
 * AUTH: the caller's token is forwarded to PostgREST, so RLS decides what is readable. No service key.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './auth.js'
import { geminiGenerateJson, pickGeminiKey } from './geminiJson.js'
import { buildSummaryPrompt, SUMMARY_SCHEMA, normaliseSummary, type MeetingSummary } from './summaryPrompt.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

const bearer = (req: VercelRequest): string => {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

async function rest(
  path: string,
  token: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  let json: unknown = null
  try { json = await res.json() } catch { /* 204 */ }
  return { ok: res.ok, json }
}

interface TranscriptRow {
  id: string
  title: string | null
  meeting_date: string | null
  full_text: string | null
  summary: unknown
  summary_generated_at: string | null
}

export async function handleSummary(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await requireClerkUser(req, res)
  if (!user) return
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const body = req.body as { transcriptId?: unknown; force?: unknown } | undefined
  const transcriptId =
    typeof body?.transcriptId === 'string' && body.transcriptId.trim() ? body.transcriptId.trim() : ''
  const force = body?.force === true
  if (!transcriptId) {
    res.status(400).json({ error: 'transcriptId required' })
    return
  }

  const token = bearer(req)

  try {
    const r = await rest(
      `cb_transcripts?select=id,title,meeting_date,full_text,summary,summary_generated_at&id=eq.${transcriptId}&limit=1`,
      token,
      { method: 'GET' },
    )
    const row = Array.isArray(r.json) ? (r.json as TranscriptRow[])[0] : undefined
    if (!row) {
      // Indistinguishable from "RLS hid it", which is why the message says both.
      res.status(404).json({ error: 'transcript_not_found', detail: 'No such transcript, or it is not readable by you.' })
      return
    }

    if (!force && row.summary) {
      res.status(200).json({
        summary: normaliseSummary(row.summary),
        cached: true,
        title: row.title,
        meetingDate: row.meeting_date,
        generatedAt: row.summary_generated_at,
      })
      return
    }

    if (!row.full_text || !row.full_text.trim()) {
      res.status(422).json({
        error: 'no_transcript_text',
        detail: 'This call has no transcript text ingested, so there is nothing to summarise.',
      })
      return
    }

    const parsed = await geminiGenerateJson(
      buildSummaryPrompt(row.title, row.full_text),
      SUMMARY_SCHEMA,
      pickGeminiKey(),
    )
    const summary: MeetingSummary = normaliseSummary(parsed)
    const generatedAt = new Date().toISOString()

    // A failed write is not fatal — the summary is still returned, just uncached. Losing the cache
    // costs a repeat call; failing the request costs the user their document.
    await rest(`cb_transcripts?id=eq.${transcriptId}`, token, {
      method: 'PATCH',
      body: { summary, summary_generated_at: generatedAt },
    })

    res.status(200).json({
      summary,
      cached: false,
      title: row.title,
      meetingDate: row.meeting_date,
      generatedAt,
    })
  } catch {
    res.status(502).json({ error: 'summary_failed' })
  }
}
```

- [ ] **Step 2: Register the action**

In `api/strategy-ai.ts`: add the import, add the `case`, and extend `allowed`.

```ts
import { handleSummary } from './_lib/handlerSummary.js'
```

```ts
    case 'summary': return handleSummary(req, res)
```

```ts
      res.status(400).json({ error: 'unknown action', allowed: ['extract', 'deck-slots', 'ask', 'summary'] })
```

Also add one line to the file's header comment beside the other actions:

```
 *   summary     -> plain printable minutes for one transcript (cached on cb_transcripts)
```

- [ ] **Step 3: Confirm the function count is still legal**

Run: `ls api/*.ts | grep -v '\.test\.ts$' | wc -l`
Expected: `11`. Note the `grep -v` — `api/` also contains `*.test.ts` files, which are NOT deployed as functions, so a bare `ls api/*.ts | wc -l` prints 17 and means nothing. This task added a file to `api/_lib/`, not to `api/`. If this prints 12 or more, a file was created in the wrong directory — move it to `_lib/` before going further.

- [ ] **Step 4: Typecheck and run the full suite**

Run: `bun run typecheck:api && bun run test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/handlerSummary.ts api/strategy-ai.ts
git commit -m "feat(summary): 'summary' action generating cached meeting minutes"
```

---

### Task 4: Browser data layer

**Files:**
- Modify: `src/lib/meetingsClient.ts` (append `meetingSummary`)
- Modify: `src/lib/reviewRepo.ts` (append `getTranscriptText`)

**Interfaces:**
- Consumes: `getClerkSessionToken` from `./clerkToken`; `supabase` from `./supabaseClient`.
- Produces:
  - `meetingSummary(transcriptId: string, force?: boolean): Promise<SummaryResponse>` where `interface SummaryResponse { summary: MeetingSummaryView; cached: boolean; title: string | null; meetingDate: string | null; generatedAt: string | null }`
  - `interface MeetingSummaryView { discussion: Array<{ text: string; timestamp: string }>; decisions: Array<{ text: string; timestamp: string }>; actionItems: Array<{ text: string; owner: string | null; timestamp: string }>; keyNumbers: Array<{ label: string; value: string; timestamp: string }> }`
  - `getTranscriptText(id: string): Promise<{ title: string | null; meetingDate: number | null; fullText: string | null } | null>`

The view type is declared in `src/` rather than imported from `api/_lib` — the browser bundle must not import server modules, and this is the same duplication the codebase already accepts between `api/_lib/deckSlots.ts` and its `src` counterpart (with a drift test).

- [ ] **Step 1: Append to `src/lib/meetingsClient.ts`**

```ts
export interface MeetingSummaryView {
  discussion: Array<{ text: string; timestamp: string }>
  decisions: Array<{ text: string; timestamp: string }>
  actionItems: Array<{ text: string; owner: string | null; timestamp: string }>
  keyNumbers: Array<{ label: string; value: string; timestamp: string }>
}

export interface SummaryResponse {
  summary: MeetingSummaryView
  cached: boolean
  title: string | null
  meetingDate: string | null
  generatedAt: string | null
}

/** Plain printable minutes. Cached server-side; `force` regenerates. */
export async function meetingSummary(transcriptId: string, force = false): Promise<SummaryResponse> {
  const token = await getClerkSessionToken()
  const res = await fetch('/api/strategy-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: 'summary', transcriptId, force }),
  })
  const json = (await res.json().catch(() => null)) as (SummaryResponse & { error?: string; detail?: string }) | null
  if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `summary ${res.status}`)
  if (!json) throw new Error('summary returned no body')
  return json
}
```

- [ ] **Step 2: Append to `src/lib/reviewRepo.ts`**

```ts
/**
 * The raw transcript text for the printable view.
 *
 * full_text, NOT the chunks: chunks overlap on purpose for retrieval quality, so concatenating them
 * duplicates text at every boundary.
 */
export async function getTranscriptText(
  id: string,
): Promise<{ title: string | null; meetingDate: number | null; fullText: string | null } | null> {
  const { data, error } = await supabase
    .from('cb_transcripts')
    .select('title,meeting_date,full_text')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  const r = data as Record<string, unknown>
  return {
    title: (r.title as string | null) ?? null,
    meetingDate: r.meeting_date ? new Date(r.meeting_date as string).getTime() : null,
    fullText: (r.full_text as string | null) ?? null,
  }
}
```

- [ ] **Step 3: Verify the column guard**

Run: `bunx vitest run api/_lib/cbColumnDrift.test.ts`
Expected: PASS. `title`, `meeting_date`, `full_text`, `summary` and `summary_generated_at` must all resolve against the migrations. A failure here means a column name is wrong — fix the query, not the test.

- [ ] **Step 4: Typecheck**

Run: `bun run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meetingsClient.ts src/lib/reviewRepo.ts
git commit -m "feat(summary): browser data layer for minutes and raw transcript"
```

---

### Task 5: The print page and its routes

**Files:**
- Create: `src/pages/MeetingPrintPage.tsx`
- Modify: `src/App.tsx` (one import, one route)

**Interfaces:**
- Consumes: `meetingSummary`, `MeetingSummaryView` (Task 4); `getTranscriptText` (Task 4).
- Produces: a route at `/print/meeting/:transcriptId` reading `?view=summary|transcript` (default `summary`).

**Route placement:** inside the `ProtectedRoute` block but **outside** `AppLayout`, so no nav chrome renders on the page. The existing print CSS hides everything (`body * { visibility: hidden }`) except `.report-printable`, so the printable region must carry that class and the on-screen controls must carry `.no-print`.

- [ ] **Step 1: Create the page**

Create `src/pages/MeetingPrintPage.tsx`:

```tsx
/**
 * /print/meeting/:transcriptId — plain printable documents for one call.
 *
 *   ?view=summary     generated minutes (cached server-side)
 *   ?view=transcript  the raw transcript, no model call at all
 *
 * Printing reuses the app's existing rules: `@media print` hides everything except
 * `.report-printable` and drops `.no-print`. No PDF library — the browser's own print-to-PDF is the
 * export, exactly as the report and deck already do it.
 *
 * Rendered OUTSIDE AppLayout so no nav chrome appears on the page.
 */
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { meetingSummary, type MeetingSummaryView } from '../lib/meetingsClient'
import { getTranscriptText } from '../lib/reviewRepo'

const fmtDate = (v: string | number | null): string => {
  if (v === null) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function MeetingPrintPage() {
  const { transcriptId = '' } = useParams()
  const [params] = useSearchParams()
  const view = params.get('view') === 'transcript' ? 'transcript' : 'summary'

  const [title, setTitle] = useState<string | null>(null)
  const [dateLabel, setDateLabel] = useState('')
  const [summary, setSummary] = useState<MeetingSummaryView | null>(null)
  const [fullText, setFullText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let live = true
    setBusy(true)
    setError(null)

    const load = async () => {
      if (view === 'transcript') {
        const t = await getTranscriptText(transcriptId)
        if (!live) return
        if (!t) { setError('No such transcript, or it is not readable by you.'); return }
        setTitle(t.title)
        setDateLabel(fmtDate(t.meetingDate))
        setFullText(t.fullText)
        if (!t.fullText?.trim()) setError('This call has no transcript text ingested.')
        return
      }
      const r = await meetingSummary(transcriptId)
      if (!live) return
      setTitle(r.title)
      setDateLabel(fmtDate(r.meetingDate))
      setSummary(r.summary)
    }

    load()
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load this document.') })
      .finally(() => { if (live) setBusy(false) })

    return () => { live = false }
  }, [transcriptId, view])

  const regenerate = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await meetingSummary(transcriptId, true)
      setSummary(r.summary)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not regenerate.')
    } finally {
      setBusy(false)
    }
  }

  const section = (heading: string, rows: Array<{ left: string; right: string }>) =>
    rows.length === 0 ? null : (
      <section className="mt-6">
        <h2 className="text-lg mb-2" style={{ fontFamily: 'Instrument Serif, serif' }}>{heading}</h2>
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-sm shrink-0" style={{ fontFamily: 'DM Mono, monospace' }}>
                {r.right || '—'}
              </span>
              <span>{r.left}</span>
            </li>
          ))}
        </ul>
      </section>
    )

  return (
    <div className="min-h-[100dvh] px-6 py-8">
      <div className="no-print flex items-center gap-2 mb-6">
        <button
          onClick={() => window.print()}
          disabled={busy}
          className="text-sm rounded-md px-3 py-1.5 border border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary disabled:opacity-40"
        >
          Print / Save as PDF
        </button>
        {view === 'summary' && (
          <button
            onClick={() => void regenerate()}
            disabled={busy}
            className="text-sm rounded-md px-3 py-1.5 border border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary disabled:opacity-40"
          >
            Regenerate
          </button>
        )}
        {busy && <span className="text-sm text-secondary">Working…</span>}
        {error && <span className="text-sm text-secondary">{error}</span>}
      </div>

      <article className="report-printable max-w-3xl">
        <h1 className="text-3xl" style={{ fontFamily: 'Instrument Serif, serif' }}>
          {title ?? 'Untitled call'}
        </h1>
        {dateLabel && <p className="text-sm text-secondary mt-1">{dateLabel}</p>}
        <p className="text-sm text-secondary mt-1">
          {view === 'transcript' ? 'Full transcript' : 'Meeting summary'}
        </p>

        {view === 'transcript' ? (
          <pre className="mt-6 whitespace-pre-wrap text-sm" style={{ fontFamily: 'inherit' }}>
            {fullText ?? ''}
          </pre>
        ) : (
          summary && (
            <>
              {section('Discussed', summary.discussion.map((d) => ({ left: d.text, right: d.timestamp })))}
              {section('Decisions', summary.decisions.map((d) => ({ left: d.text, right: d.timestamp })))}
              {section(
                'Action items',
                summary.actionItems.map((a) => ({
                  left: a.owner ? `${a.text} — ${a.owner}` : a.text,
                  right: a.timestamp,
                })),
              )}
              {section(
                'Key numbers',
                summary.keyNumbers.map((k) => ({ left: `${k.label}: ${k.value}`, right: k.timestamp })),
              )}
              {summary.discussion.length === 0 &&
                summary.decisions.length === 0 &&
                summary.actionItems.length === 0 &&
                summary.keyNumbers.length === 0 && (
                  <p className="mt-6 text-secondary">
                    Nothing could be summarised from this transcript.
                  </p>
                )}
            </>
          )
        )}
      </article>
    </div>
  )
}
```

- [ ] **Step 2: Add the route**

In `src/App.tsx`, import `MeetingPrintPage` in the file's existing import style, then add this route inside the `<Route element={<ProtectedRoute />}>` block but **outside** every `<Route element={<AppLayout … />}>` block:

```tsx
              <Route path="print/meeting/:transcriptId" element={<MeetingPrintPage />} />
```

Place it before the catch-all `<Route path="*" …>` if that catch-all is a sibling; otherwise position does not matter.

- [ ] **Step 3: Verify it builds and lints**

Run: `bun run build && bun run lint`
Expected: both clean.

- [ ] **Step 4: Verify both views by hand**

With a real ingested transcript id:
1. `/print/meeting/<id>?view=transcript` shows the transcript with no nav chrome.
2. `/print/meeting/<id>` generates the summary, then a reload returns instantly — that is the cache.
3. "Regenerate" produces a fresh summary.
4. Browser print preview shows the document only, with the buttons gone.
5. A transcript with no `full_text` shows the "no transcript text ingested" sentence rather than a blank page.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MeetingPrintPage.tsx src/App.tsx
git commit -m "feat(summary): printable meeting minutes and raw transcript views"
```

---

### Task 6: Entry points

**Files:**
- Modify: `src/pages/StrategyMeetingPage.tsx`
- Modify: `src/pages/AskPage.tsx` — **only if PR 1 has already landed.** If `AskPage.tsx` does not exist, skip that half and note it in the PR body.

**Interfaces:**
- Consumes: the `/print/meeting/:transcriptId` route (Task 5).

**Why this task exists at all:** four separate features in this area shipped fully working and unreachable. A route with no link is not a feature.

**The blocker to fix first:** `ingestMeeting` returns `{ transcriptId, joinStatus, clientId, chunks }`, but `StrategyMeetingPage` stores only three of those — `transcriptId` is **discarded** at all three `setResult` call sites (`src/pages/StrategyMeetingPage.tsx:20`, `:32`, `:41`, `:50`). There is nothing to link to until that is fixed.

- [ ] **Step 1: Carry `transcriptId` in the page's state**

**If PR 1 has already landed, this step is done — verify and skip.** Otherwise, in `src/pages/StrategyMeetingPage.tsx` widen the state type on line 20:

```tsx
  const [result, setResult] = useState<{
    transcriptId: string
    joinStatus: string
    clientId: string | null
    chunks: number
  } | null>(null)
```

Then update **all three** `onSuccess` handlers (`ingest`, `assign`, `createAndAssign`) to keep it. Each currently reads `setResult({ joinStatus: r.joinStatus, clientId: r.clientId, chunks: r.chunks })`; each becomes:

```tsx
      setResult({ transcriptId: r.transcriptId, joinStatus: r.joinStatus, clientId: r.clientId, chunks: r.chunks })
```

`createAndAssign`'s handler also calls `void clients.refetch()` — leave that line in place.

- [ ] **Step 2: Add both links to the meeting page**

Beside the existing post-ingest actions (near the "review" button around line 264):

```tsx
{result?.transcriptId && (
  <>
    <a
      href={`/print/meeting/${result.transcriptId}`}
      className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
    >
      Summary PDF
    </a>
    <a
      href={`/print/meeting/${result.transcriptId}?view=transcript`}
      className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
    >
      Transcript PDF
    </a>
  </>
)}
```

Plain `<a>` rather than `navigate()` so the print view can be opened in a new tab, which is how people actually print.

- [ ] **Step 3: Add the same links to `AskPage` (only if it exists)**

In the `AskPage` header, inside the scope row, rendered only when `scope.kind === 'meeting'` and `scope.transcriptId` is non-empty:

```tsx
{scope.kind === 'meeting' && scope.transcriptId && (
  <>
    <a
      href={`/print/meeting/${scope.transcriptId}`}
      className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
    >
      Summary PDF
    </a>
    <a
      href={`/print/meeting/${scope.transcriptId}?view=transcript`}
      className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
    >
      Transcript PDF
    </a>
  </>
)}
```

- [ ] **Step 4: Verify it builds and the links work**

Run: `bun run build && bun run lint`
Expected: both clean. If typecheck complains about a missing `transcriptId` on `result`, one of the three `onSuccess` handlers in Step 1 was missed.

Then click each link from the meeting page and confirm the correct document opens.

- [ ] **Step 5: Commit and open the PR**

```bash
git add src/pages/StrategyMeetingPage.tsx src/pages/AskPage.tsx
git commit -m "feat(summary): link the printable documents from the meeting page"
```

The PR body must state that `20260817000001_transcript_summary.sql` **must be applied before merge**, or every summary write fails on an unknown column.
