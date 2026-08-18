# Meeting Chat Bot Implementation Plan (PR 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the team a reachable `/ask` chat surface that answers questions about a specific meeting, a client, or every call — with working follow-ups.

**Architecture:** The QnA engine already exists (`api/_lib/handlerAsk.ts`, wired as `strategy-ai` action `ask`) and has never had a caller. This PR adds the missing UI, a `p_transcript_id` filter so a single meeting can be scoped, and a rewrite-then-retrieve step so follow-ups resolve. The grounding guard between retrieval and the model is not touched.

**Tech Stack:** React 19 + react-router-dom, Tailwind, Vercel serverless functions (Node ESM), Supabase Postgres + pgvector, Gemini 2.5 Flash, vitest, bun.

Spec: `docs/superpowers/specs/2026-08-17-meeting-chat-bot-design.md`

## Global Constraints

- **Do NOT add a file to `api/`.** It holds 11 files; Vercel's Hobby cap is 12 Serverless Functions per deployment. Exceeding it fails at "Deploying outputs…" with an otherwise clean build. Files under `api/_lib/` do not count.
- **`api/_lib/` modules must not import from `../src`.** They are server-side, ESM, self-contained. Import paths inside `_lib` carry the `.js` extension (e.g. `./askQuery.js`).
- **`cb_match_chunks` stays `SECURITY INVOKER`.** It must keep inheriting RLS. Never make it `security definer`.
- **Never read the Gemini key from `process.env` directly** — always `pickGeminiKey()` from `./geminiJson.js`. `GEMINI_API_KEY` holds a comma-separated pool; reading it raw caused a production 401. `api/_lib/geminiKeyUsage.test.ts` guards this.
- **Do not modify `useContentStrategy.ts` or the 4-stage pipeline.**
- **Do not touch the grounding guard** in `handlerAsk.ts` (the `excerpts.length === 0` early return) or `MIN_SIMILARITY`.
- **Design system:** read `DESIGN.md` before any visual work. Fonts Instrument Serif / Outfit / DM Mono. Background `#1A1410`. Accent `#E07B3A`. No Inter, no Tailwind slate, no indigo. AI-generated content uses the violet tint `--color-ai-tint` only.
- **Commands:** `bun run build` (typecheck app + api + vite build), `bun run lint`, `bunx vitest run <path>` for one file, `bun run test` for all.
- **Migrations are applied by a human.** `supabase db push` from inside Claude Code is blocked by the permission classifier on production DDL.

---

### Task 1: Migration — scope semantic search to one transcript

**Files:**
- Create: `supabase/migrations/20260817000000_ask_transcript_scope.sql`
- Reference (do not edit): `supabase/migrations/20260804000001_transcript_brain_search.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `cb_match_chunks(query_embedding vector(768), match_count int, p_client_id uuid, p_meeting_type text, p_transcript_id uuid)` returning the same 10 columns as before (`chunk_id, transcript_id, client_id, chunk_text, speaker, start_sec, similarity, title, meeting_date, meeting_type`).

**Why a migration rather than filtering in Node:** `cb_match_chunks` already returns `transcript_id`, so results could be filtered after the call. That is wrong. The function returns the global top `match_count` (12) across all transcripts, so post-filtering can yield **zero** rows for a meeting containing plenty of relevant content — it simply lost the ranking race to other calls. The filter must be inside the query.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260817000000_ask_transcript_scope.sql`:

```sql
-- Ask scope: a single meeting.
--
-- The /ask chat lets the team pick ONE meeting and ask about it. That needs the filter INSIDE the
-- query. Filtering the results in Node looks cheaper and is wrong: this function returns the global
-- top match_count rows, so a meeting full of relevant content can come back empty simply because
-- other calls outranked it. Same failure mode as post-filtering in location discovery.
--
-- Adding a defaulted argument creates a NEW function signature, so the old one is dropped and the
-- grants are re-issued — grants bind to an exact argument list and do not carry over. Missing that
-- leaves the function existing but un-executable by `authenticated`, and every semantic query fails.
--
-- STILL SECURITY INVOKER (the default). It must keep running as the caller so RLS on
-- cb_transcript_chunks and cb_transcripts applies. A definer function here would hand transcript
-- content — margins, ticket sizes, closed-deal detail — to anyone who can call it.
--
-- Run in the Supabase SQL editor, or `supabase db push --linked`.

drop function if exists cb_match_chunks(vector, int, uuid, text);

create or replace function cb_match_chunks(
  query_embedding  vector(768),
  match_count      int  default 12,
  p_client_id      uuid default null,
  p_meeting_type   text default null,
  p_transcript_id  uuid default null
)
returns table (
  chunk_id     uuid,
  transcript_id uuid,
  client_id    uuid,
  chunk_text   text,
  speaker      text,
  start_sec    numeric,
  similarity   double precision,
  title        text,
  meeting_date timestamptz,
  meeting_type text
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    c.id,
    c.transcript_id,
    t.client_id,
    c.text,
    c.speaker,
    c.start_sec,
    (1 - (c.embedding <=> query_embedding))::double precision as similarity,
    t.title,
    t.meeting_date,
    t.meeting_type
  from cb_transcript_chunks c
  join cb_transcripts t on t.id = c.transcript_id
  where c.embedding is not null
    and (p_client_id is null or t.client_id = p_client_id)
    and (p_meeting_type is null or t.meeting_type = p_meeting_type)
    and (p_transcript_id is null or c.transcript_id = p_transcript_id)
  -- Order by DISTANCE (not similarity) so the HNSW index is actually used.
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

revoke all on function cb_match_chunks(vector, int, uuid, text, uuid) from public;
grant execute on function cb_match_chunks(vector, int, uuid, text, uuid) to authenticated;
```

- [ ] **Step 2: Verify the existing column-drift guard still passes**

`api/_lib/cbColumnDrift.test.ts` parses every migration for the columns that exist and cross-checks them against columns the app references. It must stay green.

Run: `bunx vitest run api/_lib/cbColumnDrift.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260817000000_ask_transcript_scope.sql
git commit -m "feat(ask): scope semantic search to a single transcript"
```

- [ ] **Step 4: Hand off to a human for application**

Say to the user, verbatim:

> Migration `20260817000000_ask_transcript_scope.sql` is committed but NOT applied. I can't run `supabase db push` — the permission classifier blocks production DDL. Please apply it before Task 4's code ships, because the drop-and-recreate leaves no function matching the old signature. Also please confirm whether `20260810000000_transcript_brain_open_access.sql` was ever applied — if it wasn't, `/ask` returns nothing for every non-admin.

---

### Task 2: Pure metadata-filter builder

**Files:**
- Modify: `api/_lib/askQuery.ts` (append; do not change `planQuery`, `parseDate`, `MIN_SIMILARITY` or `relevantChunks`)
- Test: `api/_lib/askQuery.test.ts` (append to the existing file)

**Interfaces:**
- Consumes: `QueryPlan` from `askQuery.ts` (already exported).
- Produces: `export interface AskScope { clientId: string | null; transcriptId: string | null }` and `export function metadataFilters(plan: QueryPlan, scope: AskScope): string` returning a PostgREST query-string fragment such as `client_id=eq.abc&meeting_type=eq.onboarding`.

**The decision this task encodes:** when the user has explicitly picked a meeting, that selection **wins over** the date and meeting-type parsed out of their question text. The `transcriptId` came from clicking a row; the date came from a regex guess on a sentence. Keeping both means "what happened on the 12th?" returns nothing while the user is staring at the 5th's transcript — a dead end with no visible cause.

- [ ] **Step 1: Write the failing tests**

Append to `api/_lib/askQuery.test.ts`, and add `metadataFilters` plus `type AskScope` to the existing import at the top of that file:

```ts
describe('metadataFilters', () => {
  const plan = (over: Partial<QueryPlan> = {}): QueryPlan => ({
    mode: 'metadata', meetingType: null, dateFrom: null, dateTo: null, ...over,
  })

  it('returns an empty string when nothing is scoped', () => {
    expect(metadataFilters(plan(), { clientId: null, transcriptId: null })).toBe('')
  })

  it('filters by client', () => {
    expect(metadataFilters(plan(), { clientId: 'c1', transcriptId: null })).toBe('client_id=eq.c1')
  })

  it('combines client, type and date with &', () => {
    const out = metadataFilters(
      plan({ meetingType: 'onboarding', dateFrom: '2026-10-12T00:00:00.000Z', dateTo: '2026-10-13T00:00:00.000Z' }),
      { clientId: 'c1', transcriptId: null },
    )
    expect(out).toBe(
      'client_id=eq.c1&meeting_type=eq.onboarding' +
      '&meeting_date=gte.2026-10-12T00:00:00.000Z&meeting_date=lt.2026-10-13T00:00:00.000Z',
    )
  })

  // An explicit pick beats a regex guess. Otherwise asking "what happened on the 12th" while the
  // 5th's transcript is selected filters itself down to nothing, with no visible reason.
  it('an explicit transcript wins over date and type parsed from the question', () => {
    const out = metadataFilters(
      plan({ meetingType: 'sales', dateFrom: '2026-10-12T00:00:00.000Z', dateTo: '2026-10-13T00:00:00.000Z' }),
      { clientId: 'c1', transcriptId: 't9' },
    )
    expect(out).toBe('id=eq.t9')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run api/_lib/askQuery.test.ts`
Expected: FAIL — `metadataFilters is not a function`, or a TS resolution error on the import.

- [ ] **Step 3: Implement it**

Append to `api/_lib/askQuery.ts`:

```ts
/** What the USER selected, as opposed to what their question implies. */
export interface AskScope {
  clientId: string | null
  transcriptId: string | null
}

/**
 * Build the PostgREST filter fragment for the metadata path.
 *
 * An explicitly selected transcript WINS over the date and meeting type parsed out of the question
 * text: the transcriptId came from the user picking a row, the date came from a regex guess on a
 * sentence. Applying both lets "what happened on the 12th" filter itself to nothing while the user
 * is looking at the 5th's transcript — an empty result with no visible cause.
 */
export function metadataFilters(plan: QueryPlan, scope: AskScope): string {
  if (scope.transcriptId) return `id=eq.${scope.transcriptId}`
  return [
    scope.clientId ? `client_id=eq.${scope.clientId}` : '',
    plan.meetingType ? `meeting_type=eq.${plan.meetingType}` : '',
    plan.dateFrom ? `meeting_date=gte.${plan.dateFrom}` : '',
    plan.dateTo ? `meeting_date=lt.${plan.dateTo}` : '',
  ]
    .filter(Boolean)
    .join('&')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run api/_lib/askQuery.test.ts`
Expected: PASS, including the pre-existing `planQuery` / `parseDate` / `relevantChunks` tests.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/askQuery.ts api/_lib/askQuery.test.ts
git commit -m "feat(ask): pure metadata-filter builder with explicit-scope precedence"
```

---

### Task 3: Follow-up rewriting

**Files:**
- Create: `api/_lib/rewriteFollowup.ts`
- Test: `api/_lib/rewriteFollowup.test.ts`

**Interfaces:**
- Consumes: `geminiGenerateJson(prompt, schema, apiKey)` from `./geminiJson.js`.
- Produces:
  - `export interface Turn { role: 'user' | 'assistant'; content: string }`
  - `export function recentTurns(history: Turn[], n?: number): Turn[]`
  - `export function needsRewrite(history: Turn[]): boolean`
  - `export async function rewriteFollowup(question: string, history: Turn[], apiKey: string): Promise<string>`

**Why:** `handleAsk` is single-shot. A follow-up like *"and pricing?"* embedded on its own retrieves nothing useful, because its subject only exists in the previous turn. The guard then correctly reports "nothing relevant" — which reads to the team as a broken bot. Rewriting happens **before** `planQuery`, so a date established in turn 1 survives into turn 2.

- [ ] **Step 1: Write the failing tests**

Create `api/_lib/rewriteFollowup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { recentTurns, needsRewrite, type Turn } from './rewriteFollowup.js'

const turn = (i: number): Turn => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `t${i}` })

describe('recentTurns', () => {
  it('returns an empty array for no history', () => {
    expect(recentTurns([])).toEqual([])
  })

  it('keeps the last 4 turns by default, oldest first', () => {
    const out = recentTurns([0, 1, 2, 3, 4, 5].map(turn))
    expect(out.map((t) => t.content)).toEqual(['t2', 't3', 't4', 't5'])
  })

  it('returns everything when history is shorter than the window', () => {
    expect(recentTurns([turn(0), turn(1)]).map((t) => t.content)).toEqual(['t0', 't1'])
  })

  it('honours an explicit window', () => {
    expect(recentTurns([0, 1, 2, 3].map(turn), 2).map((t) => t.content)).toEqual(['t2', 't3'])
  })
})

describe('needsRewrite', () => {
  // The first question has nothing to resolve against, so it must cost no model call at all.
  it('is false with no history', () => {
    expect(needsRewrite([])).toBe(false)
  })

  it('is true once there is a prior turn', () => {
    expect(needsRewrite([turn(0)])).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run api/_lib/rewriteFollowup.test.ts`
Expected: FAIL — cannot resolve `./rewriteFollowup.js`.

- [ ] **Step 3: Implement it**

Create `api/_lib/rewriteFollowup.ts`:

```ts
/**
 * Turn a follow-up into a standalone question BEFORE retrieval (SERVER-SIDE, ESM, self-contained).
 *
 * handleAsk retrieves on the question it is given. "and pricing?" embedded alone matches almost
 * nothing, because its subject lives in the previous turn — and the grounding guard then honestly
 * reports "nothing relevant", which reads as a broken bot rather than as a short question.
 *
 * The rewrite runs BEFORE planQuery, which is the whole point: a date established in turn 1 has to
 * survive into turn 2, or "and pricing?" silently widens from one meeting to every call.
 *
 *   turn 1  "what happened in the Oct 12 onboarding call"  -> metadata, Oct 12
 *   turn 2  "and pricing?"  -> "what did they say about pricing in the Oct 12 onboarding call"
 *
 * The pure parts are exported separately so they are unit-tested without a network call.
 */
import { geminiGenerateJson } from './geminiJson.js'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

/** The last `n` turns, oldest first. Enough to resolve a pronoun; not enough to drift. */
export const recentTurns = (history: Turn[], n = 4): Turn[] => history.slice(-n)

/** No prior turn means nothing to resolve against — so no model call and no cost. */
export const needsRewrite = (history: Turn[]): boolean => recentTurns(history).length > 0

const REWRITE_SCHEMA = {
  type: 'object',
  properties: { question: { type: 'string' } },
  required: ['question'],
} as const

const REWRITE_SYSTEM = `Rewrite the user's LATEST question into a standalone question that can be
understood with no conversation history.

RULES:
- Resolve pronouns and omitted subjects using the conversation.
- PRESERVE any meeting name, date or meeting type established earlier — that is the scope of the
  question, and dropping it silently widens the search to every call.
- If the latest question is already standalone, return it UNCHANGED.
- Do NOT answer the question. Do NOT add facts that are not in the conversation.
- Write in LATIN script only. Romanise any Hindi as Hinglish; never output Devanagari.`

/**
 * Returns the standalone question, or the original when there is no history, when the model returns
 * nothing usable, or when the call fails. A degraded retrieval beats a dead chat — and the grounding
 * guard downstream still prevents an ungrounded answer either way.
 */
export async function rewriteFollowup(
  question: string,
  history: Turn[],
  apiKey: string,
): Promise<string> {
  if (!needsRewrite(history)) return question

  const convo = recentTurns(history)
    .map((t) => `${t.role}: ${t.content}`)
    .join('\n')

  try {
    const out = (await geminiGenerateJson(
      `${REWRITE_SYSTEM}\n\nCONVERSATION:\n${convo}\n\nLATEST QUESTION: ${question}`,
      REWRITE_SCHEMA,
      apiKey,
    )) as { question?: unknown }
    const rewritten = typeof out?.question === 'string' ? out.question.trim() : ''
    return rewritten || question
  } catch {
    return question
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run api/_lib/rewriteFollowup.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Verify the Gemini key guard still passes**

Run: `bunx vitest run api/_lib/geminiKeyUsage.test.ts`
Expected: PASS. This module takes the key as an argument and never reads `process.env`, which is what that guard enforces.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/rewriteFollowup.ts api/_lib/rewriteFollowup.test.ts
git commit -m "feat(ask): rewrite follow-ups into standalone questions before retrieval"
```

---

### Task 4: Wire scope + history into `handleAsk`

**Files:**
- Modify: `api/_lib/handlerAsk.ts`

**Interfaces:**
- Consumes: `metadataFilters`, `AskScope` (Task 2); `rewriteFollowup`, `Turn` (Task 3).
- Produces: the `ask` action now accepts `{ question, clientId?, transcriptId?, history? }` and its 200 response gains `interpretedAs: string | null` — the rewritten question when it differs from what was typed, else `null`.

**Do not touch:** the `excerpts.length === 0` early return, `MIN_SIMILARITY`, or the `SYSTEM` prompt.

- [ ] **Step 1: Extend the imports**

In `api/_lib/handlerAsk.ts`, replace the `askQuery.js` import line with these two lines:

```ts
import { planQuery, relevantChunks, metadataFilters, MIN_SIMILARITY, type RetrievedChunk, type AskScope } from './askQuery.js'
import { rewriteFollowup, type Turn } from './rewriteFollowup.js'
```

- [ ] **Step 2: Parse the two new body fields**

Replace the body-parsing block (from `const body = req.body as { question?: unknown; clientId?: unknown }` through the `if (!question)` guard) with:

```ts
  const body = req.body as
    | { question?: unknown; clientId?: unknown; transcriptId?: unknown; history?: unknown }
    | undefined
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  const clientId =
    typeof body?.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : null
  const transcriptId =
    typeof body?.transcriptId === 'string' && body.transcriptId.trim() ? body.transcriptId.trim() : null
  // Only well-formed turns survive; a malformed history must not reach the prompt.
  const history: Turn[] = Array.isArray(body?.history)
    ? (body.history as unknown[]).filter(
        (t): t is Turn =>
          Boolean(t) &&
          typeof t === 'object' &&
          typeof (t as Turn).content === 'string' &&
          ((t as Turn).role === 'user' || (t as Turn).role === 'assistant'),
      )
    : []
  if (!question) {
    res.status(400).json({ error: 'question required' })
    return
  }
```

- [ ] **Step 3: Rewrite before planning**

Replace the single line `const plan = planQuery(question, new Date())` with:

```ts
  // Rewrite BEFORE planning: planQuery must see the resolved question, or a date established in an
  // earlier turn is lost and a follow-up silently widens from one meeting to every call.
  const standalone = await rewriteFollowup(question, history, pickGeminiKey())
  const plan = planQuery(standalone, new Date())
  const scope: AskScope = { clientId, transcriptId }
```

- [ ] **Step 4: Use the filter builder on the metadata path**

Replace the inline `const filters = [ ... ].filter(Boolean).join('&')` block with:

```ts
      const filters = metadataFilters(plan, scope)
```

- [ ] **Step 5: Pass the transcript filter on the semantic path**

In the semantic branch, replace the `embedTexts` call and the RPC body with:

```ts
      const [queryVector] = await embedTexts([standalone], pickGeminiKey(), 'RETRIEVAL_QUERY')
      const r = await rest('rpc/cb_match_chunks', token, {
        method: 'POST',
        body: {
          query_embedding: `[${queryVector.join(',')}]`,
          match_count: 12,
          p_client_id: clientId,
          // An explicit meeting pick supersedes the type parsed from the question — a transcript has
          // exactly one type, so sending both can only ever narrow to nothing.
          p_meeting_type: transcriptId ? null : plan.meetingType,
          p_transcript_id: transcriptId,
        },
      })
```

- [ ] **Step 6: Report the rewrite in both responses**

In the `excerpts.length === 0` response object and in the final 200 response object, add this field, leaving every other field exactly as it is:

```ts
      interpretedAs: standalone === question ? null : standalone,
```

Also send the resolved question to the answering model: in the final `geminiGenerateJson` call, change `QUESTION: ${question}` to `QUESTION: ${standalone}`.

- [ ] **Step 7: Typecheck and run the full suite**

Run: `bun run typecheck:api && bun run test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add api/_lib/handlerAsk.ts
git commit -m "feat(ask): accept a transcript scope and conversation history"
```

---

### Task 5: Browser data layer

**Files:**
- Create: `src/lib/askClient.ts`
- Modify: `src/lib/reviewRepo.ts` (append `listIngestedTranscripts`; also fix the stale header comment)

**Interfaces:**
- Consumes: `getClerkSessionToken` from `./clerkToken`; `supabase` from `./supabaseClient`.
- Produces:
  - `askTranscripts(question: string, scope: { clientId?: string; transcriptId?: string }, history: Turn[]): Promise<AskResponse>`
  - `interface Turn { role: 'user' | 'assistant'; content: string }`
  - `interface AskCitation { chunkId: string; meeting: string | null; meetingDate: string | null; speaker: string | null; timestamp: string; quote: string; similarity: number }`
  - `interface AskResponse { answer: string | null; reason: string | null; message?: string; mode: 'metadata' | 'semantic'; transcriptsRead?: number; interpretedAs: string | null; citations: AskCitation[] }`
  - `listIngestedTranscripts(): Promise<IngestedTranscript[]>` where `interface IngestedTranscript { id: string; title: string | null; meetingDate: number | null; meetingType: string; clientId: string | null }`

**The picker reads Supabase, never Fireflies.** Fireflies is 500 req/day on the team's tier and `/strategy` already spends one request per visit with no caching. A picker calling it would multiply that by every question asked. Reading `cb_transcripts` also makes the list an honest answer to "is this call in the bot yet?"

- [ ] **Step 1: Write `askClient.ts`**

Create `src/lib/askClient.ts`:

```ts
/**
 * Browser -> /api/strategy-ai?action=ask. QnA over ingested transcripts.
 *
 * `answer: null` is a LEGITIMATE RESPONSE, not an error: the server refuses to call the model when
 * retrieval finds nothing above the similarity threshold. Callers must render it as an answer, not
 * as a failure — the whole value of this feature is that it does not invent figures.
 */
import { getClerkSessionToken } from './clerkToken'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskCitation {
  chunkId: string
  meeting: string | null
  meetingDate: string | null
  speaker: string | null
  timestamp: string
  quote: string
  similarity: number
}

export interface AskResponse {
  answer: string | null
  reason: string | null
  message?: string
  mode: 'metadata' | 'semantic'
  transcriptsRead?: number
  /** The rewritten question, when a follow-up was resolved into something standalone. */
  interpretedAs: string | null
  citations: AskCitation[]
}

export async function askTranscripts(
  question: string,
  scope: { clientId?: string; transcriptId?: string },
  history: Turn[],
): Promise<AskResponse> {
  const token = await getClerkSessionToken()
  const res = await fetch('/api/strategy-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: 'ask', question, ...scope, history }),
  })
  // Surface what the server actually said — collapsing every failure into one string is what hid a
  // missing FIREFLIES_API_KEY behind "could not reach Fireflies".
  const json = (await res.json().catch(() => null)) as
    | (AskResponse & { error?: string; detail?: string })
    | null
  if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `ask ${res.status}`)
  if (!json) throw new Error('ask returned no body')
  return json
}
```

- [ ] **Step 2: Append the transcript list to `reviewRepo.ts`**

```ts
export interface IngestedTranscript {
  id: string
  title: string | null
  meetingDate: number | null
  meetingType: string
  clientId: string | null
}

/**
 * Ingested calls, newest first — the source for the /ask meeting picker.
 *
 * Reads cb_transcripts, NOT the Fireflies API. Fireflies is rate-limited per day and /strategy
 * already spends a request per visit with no caching; a picker that called it would multiply that
 * by every question asked. Reading the table also makes this list an honest answer to "is this call
 * in the bot yet?".
 */
export async function listIngestedTranscripts(): Promise<IngestedTranscript[]> {
  const { data, error } = await supabase
    .from('cb_transcripts')
    .select('id,title,meeting_date,meeting_type,client_id')
    .order('meeting_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    title: (r.title as string | null) ?? null,
    meetingDate: r.meeting_date ? new Date(r.meeting_date as string).getTime() : null,
    meetingType: (r.meeting_type as string) ?? 'sales',
    clientId: (r.client_id as string | null) ?? null,
  }))
}
```

- [ ] **Step 3: Fix the stale header comment in `reviewRepo.ts`**

The file header still says RLS is admin-only. That stopped being true with `20260810000000_transcript_brain_open_access.sql`. Replace the header block with:

```ts
/**
 * Review data access — cb_clients + cb_extractions + cb_transcripts.
 *
 * RLS on these tables is open to any signed-in member (20260810000000), so an empty result means
 * there is genuinely nothing there rather than a permission problem.
 */
```

- [ ] **Step 4: Verify the column-drift guard covers the new query**

Run: `bunx vitest run api/_lib/cbColumnDrift.test.ts`
Expected: PASS. Every column named in Step 2 (`id`, `title`, `meeting_date`, `meeting_type`, `client_id`) exists in the migrations. If this fails, a column name is wrong — fix the query, not the test.

- [ ] **Step 5: Typecheck**

Run: `bun run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/askClient.ts src/lib/reviewRepo.ts
git commit -m "feat(ask): browser data layer for transcript QnA"
```

---

### Task 6: The `/ask` page, nav entry and route

**Files:**
- Create: `src/pages/AskPage.tsx`
- Modify: `src/components/AppLayout.tsx` (one `NAV_SECTIONS` entry + one icon import)
- Modify: `src/App.tsx` (one route + one import, following the file's existing import style)

**Interfaces:**
- Consumes: `askTranscripts`, `AskCitation`, `Turn` (Task 5); `listIngestedTranscripts`, `IngestedTranscript`, `listClients`, `ReviewClient` (Task 5 + existing).
- Produces: a route at `/ask` reading `?transcript=` and `?client=` from the query string.

**Read `DESIGN.md` before this task.** The assistant bubble uses `--color-ai-tint` (violet) because its content is AI-generated — that is the documented rule and the only place violet is allowed.

- [ ] **Step 1: Create the page**

Create `src/pages/AskPage.tsx`:

```tsx
/**
 * /ask — chat over ingested call transcripts.
 *
 * SCOPE is one discriminated value, not three code paths: a meeting, a client, or everything. The
 * server already treats a null clientId as "every client", so 'all' needs no special handling.
 *
 * `answer: null` is rendered as a normal assistant message, NOT an error toast. The server refuses
 * to call the model when nothing clears the similarity threshold, and that refusal is the feature —
 * these transcripts contain margins and ticket sizes, so a plausible invented figure is the worst
 * possible outcome.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send } from 'lucide-react'
import { askTranscripts, type AskCitation, type Turn } from '../lib/askClient'
import {
  listIngestedTranscripts,
  listClients,
  type IngestedTranscript,
  type ReviewClient,
} from '../lib/reviewRepo'

type Scope =
  | { kind: 'meeting'; transcriptId: string }
  | { kind: 'client'; clientId: string }
  | { kind: 'all' }

interface Msg {
  role: 'user' | 'assistant'
  content: string
  citations?: AskCitation[]
  interpretedAs?: string | null
  /** true when the server found nothing relevant — styled as information, not failure. */
  empty?: boolean
}

const fmtDate = (ms: number | null): string =>
  ms === null
    ? 'no date'
    : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export default function AskPage() {
  const [params, setParams] = useSearchParams()
  const [transcripts, setTranscripts] = useState<IngestedTranscript[]>([])
  const [clients, setClients] = useState<ReviewClient[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [scope, setScope] = useState<Scope>(() => {
    const t = params.get('transcript')
    const c = params.get('client')
    if (t) return { kind: 'meeting', transcriptId: t }
    if (c) return { kind: 'client', clientId: c }
    return { kind: 'all' }
  })

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([listIngestedTranscripts(), listClients()])
      .then(([t, c]) => {
        setTranscripts(t)
        setClients(c)
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load meetings'))
  }, [])

  // Changing scope starts a new thread. Follow-ups resolve against earlier turns, so carrying
  // history across a scope change would resolve a question against a meeting no longer selected.
  const changeScope = (next: Scope) => {
    setScope(next)
    setMessages([])
    setParams(
      next.kind === 'meeting'
        ? { transcript: next.transcriptId }
        : next.kind === 'client'
          ? { client: next.clientId }
          : {},
      { replace: true },
    )
  }

  const scopeLabel = useMemo(() => {
    if (scope.kind === 'meeting') {
      const t = transcripts.find((x) => x.id === scope.transcriptId)
      return t ? `${t.title ?? 'Untitled call'} — ${fmtDate(t.meetingDate)}` : 'this meeting'
    }
    if (scope.kind === 'client') {
      return clients.find((c) => c.id === scope.clientId)?.displayName ?? 'this client'
    }
    return 'every ingested call'
  }, [scope, transcripts, clients])

  async function send() {
    const question = input.trim()
    if (!question || busy) return
    setInput('')
    const history: Turn[] = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setBusy(true)
    try {
      const r = await askTranscripts(
        question,
        scope.kind === 'meeting'
          ? { transcriptId: scope.transcriptId }
          : scope.kind === 'client'
            ? { clientId: scope.clientId }
            : {},
        history,
      )
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: r.answer ?? r.message ?? 'Nothing in the ingested transcripts covers that.',
          citations: r.citations,
          interpretedAs: r.interpretedAs,
          empty: r.answer === null,
        },
      ])
    } catch (e: unknown) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: e instanceof Error ? e.message : 'The request failed.', empty: true },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-[100dvh]">
      <header className="px-6 py-4 border-b border-[rgba(var(--border-rgb),0.12)]">
        <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>Ask</h1>
        <p className="text-sm text-secondary mt-1">
          Answers come only from ingested call transcripts, with citations.
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {(['meeting', 'client', 'all'] as const).map((kind) => (
            <button
              key={kind}
              onClick={() =>
                changeScope(
                  kind === 'meeting'
                    ? { kind: 'meeting', transcriptId: transcripts[0]?.id ?? '' }
                    : kind === 'client'
                      ? { kind: 'client', clientId: clients[0]?.id ?? '' }
                      : { kind: 'all' },
                )
              }
              className={`text-sm rounded-md px-3 py-1.5 border ${
                scope.kind === kind
                  ? 'border-[var(--color-accent)] text-primary'
                  : 'border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary'
              }`}
            >
              {kind === 'meeting' ? 'One meeting' : kind === 'client' ? 'One client' : 'Everything'}
            </button>
          ))}

          {scope.kind === 'meeting' && (
            <select
              aria-label="Meeting"
              value={scope.transcriptId}
              onChange={(e) => changeScope({ kind: 'meeting', transcriptId: e.target.value })}
              className="text-sm rounded-md px-3 py-1.5 bg-transparent border border-[rgba(var(--border-rgb),0.12)]"
            >
              {transcripts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title ?? 'Untitled call'} — {fmtDate(t.meetingDate)}
                </option>
              ))}
            </select>
          )}

          {scope.kind === 'client' && (
            <select
              aria-label="Client"
              value={scope.clientId}
              onChange={(e) => changeScope({ kind: 'client', clientId: e.target.value })}
              className="text-sm rounded-md px-3 py-1.5 bg-transparent border border-[rgba(var(--border-rgb),0.12)]"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          )}
        </div>

        {loadError && <p className="text-sm text-secondary mt-2">Could not load meetings: {loadError}</p>}
        {!loadError && transcripts.length === 0 && (
          <p className="text-sm text-secondary mt-2">
            No calls ingested yet. Ingest one from Strategy first — this list only shows calls the bot can read.
          </p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && <p className="text-sm text-secondary">Ask anything about {scopeLabel}.</p>}
        {messages.map((m, i) => (
          <div key={i}>
            {m.role === 'user' ? (
              <p className="text-primary">{m.content}</p>
            ) : (
              <div
                className="border-l-2 pl-4"
                style={{ borderColor: m.empty ? 'rgba(var(--border-rgb),0.3)' : 'var(--color-ai-tint)' }}
              >
                {m.interpretedAs && <p className="text-xs text-secondary mb-1">Read as: {m.interpretedAs}</p>}
                <p className="whitespace-pre-wrap text-primary">{m.content}</p>
                {m.citations && m.citations.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {m.citations.map((c) => (
                      <li key={c.chunkId} className="text-xs text-secondary">
                        <span style={{ fontFamily: 'DM Mono, monospace' }}>{c.timestamp}</span>
                        {' · '}
                        {c.meeting ?? 'unknown call'}
                        {c.speaker ? ` · ${c.speaker}` : ''}
                        <span className="block opacity-80">“{c.quote}”</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-secondary">Reading the transcripts…</p>}
      </div>

      <div className="px-6 py-4 border-t border-[rgba(var(--border-rgb),0.12)] flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={`Ask about ${scopeLabel}`}
          aria-label="Your question"
          className="flex-1 bg-transparent border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-2 text-primary"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="rounded-md px-4 py-2 border border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary disabled:opacity-40"
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the nav entry**

In `src/components/AppLayout.tsx`, add `HelpCircle` to the existing `lucide-react` import, then add one entry to `NAV_SECTIONS` immediately after the Strategy line:

```ts
  { path: '/ask', label: 'Ask', icon: HelpCircle, fullBleed: true },
```

`fullBleed: true` matches the Chat section — this is a chat surface, not a padded content page.

- [ ] **Step 3: Add the route**

In `src/App.tsx`, import `AskPage` in the same style as the file's other page imports, then add a route inside the `<Route element={<AppLayout noPadding />}>` block (alongside `<Route index element={<ChatPage />} />`), because the page manages its own full-height layout:

```tsx
                <Route path="ask" element={<AskPage />} />
```

- [ ] **Step 4: Verify it builds and lints**

Run: `bun run build && bun run lint`
Expected: both clean. Pre-existing lint errors in the gitignored `video/` directory are unrelated.

- [ ] **Step 5: Verify the page is actually reachable**

Run the dev server and confirm, in this order:
1. "Ask" appears in the top nav.
2. Clicking it loads `/ask` with the scope buttons visible.
3. With no calls ingested, the empty-state sentence appears rather than a blank page.
4. `/ask?transcript=<a real cb_transcripts id>` opens with "One meeting" pre-selected.

This step is not optional. Four separate features in this area shipped fully working and unreachable; a passing test suite has never once caught that.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AskPage.tsx src/components/AppLayout.tsx src/App.tsx
git commit -m "feat(ask): /ask chat page with meeting/client/all scope"
```

---

### Task 7: Contextual entry from the meeting page

**Files:**
- Modify: `src/pages/StrategyMeetingPage.tsx`

**Interfaces:**
- Consumes: the `/ask?transcript=<id>` route (Task 6).
- Produces: the page's `result` state gains `transcriptId`, which PR 2 also needs.

**The blocker to fix first:** `ingestMeeting` returns `{ transcriptId, joinStatus, clientId, chunks }`, but `StrategyMeetingPage` stores only three of those — `transcriptId` is **discarded** at all three `setResult` call sites (`src/pages/StrategyMeetingPage.tsx:20`, `:32`, `:41`, `:50`). There is nothing to link to until that is fixed. `useNavigate` is already imported and `navigate` already exists at line 19.

- [ ] **Step 1: Carry `transcriptId` in the page's state**

In `src/pages/StrategyMeetingPage.tsx`, widen the state type on line 20:

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

Note `createAndAssign`'s handler also calls `void clients.refetch()` — leave that line in place.

- [ ] **Step 2: Add the button**

Beside the existing post-ingest actions (near the "review" button around line 264), add:

```tsx
{result?.transcriptId && (
  <button
    onClick={() => navigate(`/ask?transcript=${result.transcriptId}`)}
    className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
  >
    Ask about this call
  </button>
)}
```

It renders only after ingest, because before that there is no transcript to ask about.

- [ ] **Step 3: Verify it builds**

Run: `bun run build && bun run lint`
Expected: both clean. If typecheck complains about a missing `transcriptId` on `result`, one of the three `onSuccess` handlers in Step 1 was missed.

- [ ] **Step 4: Verify the round trip by hand**

Open a meeting that has been ingested, click "Ask about this call", and confirm `/ask` opens with that meeting pre-selected. Then ask two questions in sequence where the second is a bare follow-up (for example "what did they say about pricing?" then "and the timeline?") and confirm the second answer stays about the same call — that is the rewrite working.

- [ ] **Step 5: Commit and open the PR**

```bash
git add src/pages/StrategyMeetingPage.tsx
git commit -m "feat(ask): 'Ask about this call' deep-link from the meeting page"
```

Then open the PR. The body must state that `20260817000000_ask_transcript_scope.sql` **must be applied before merge**, and must repeat the open question about whether `20260810000000_transcript_brain_open_access.sql` was ever applied — if it was not, `/ask` returns nothing for every non-admin, which is the entire audience for this feature.
