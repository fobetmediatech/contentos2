# Meeting Chat Bot + Plain PDF Export

**Date:** 2026-08-17
**Status:** Design approved, not implemented
**Supersedes nothing.** This is additive to the transcript intelligence layer.

## Why

The team wants to ask questions about a specific client call — "what happened in it", "what did they
say about pricing" — and to print plain documents out of a meeting. Today the transcript intelligence
layer only produces a cited brief and a styled FOBET deck.

The QnA engine for this **already exists and has never been reachable.** `api/_lib/handlerAsk.ts` is
a complete grounded QnA implementation wired into `api/strategy-ai.ts` as `action: 'ask'`, with dual
retrieval, a structural grounding guard and per-chunk citations. Nothing in `src/` calls it. This is
the fifth instance of the "built but unreachable" failure mode in this feature (previously: the
client-creation endpoint, the review UI, the FOBET deck, and the meeting-page client assignment).

The work here is therefore mostly **a surface plus three targeted server extensions**, not a new
feature.

## Decisions

| Decision | Choice | Consequence |
| --- | --- | --- |
| Pivot scope | **Additive** | The review page, `handlerExtract`, `verifyExtraction`, `handlerDeckSlots` and the FOBET deck are untouched. Nothing verified in prod gets deleted. |
| Chat scope | **Meeting / client / all**, via a switcher | Needs a `transcript_id` filter that does not exist yet → one migration. |
| PDFs | **Meeting summary + raw transcript** | Chat-thread export was explicitly declined. Do not build it. |
| Follow-ups | **Rewrite-then-retrieve** | One cheap model call per follow-up. Grounding guard unchanged. |
| Surface | **New `/ask` nav section** | Rejected: a panel on the meeting page (no home for client/all scope), and routing through `ChatPage` (see below). |

### Why not route it through `ChatPage`

`ChatPage` is CLAUDE.md's "single-surface conversational UX", so this was the architecturally
tempting option. Rejected for two reasons:

1. **Cost.** The project's own extension conventions make a new pipeline seven steps: tool def,
   dispatch branch, store with `version` + `migrate`, hook, result component, `PIPELINE_REGISTRY`
   entry, and an eval case in the agent golden-set.
2. **It weakens the grounding guarantee, which is the point of the feature.** `handleAsk` returning
   `answer: null` is a deliberate outcome, not an error. Inside the agent loop a `null` tool result
   becomes just another observation the model narrates around — "I couldn't find specifics, but
   clients in this space typically…". The structural guard only holds while its output reaches the
   user unmediated. These transcripts contain margins and ticket sizes; a plausible invented figure
   is the worst possible failure here.

## Architecture

```
/ask  (AskPage.tsx)
  │  scope: meeting | client | all          history: in component state
  ▼
POST /api/strategy-ai?action=ask   { question, clientId?, transcriptId?, history? }
                                   (Scope is a client-side type; it flattens to these fields)
  │
  ├─ history non-empty? ──► rewriteFollowup()  ──► standalone question
  │                         (skipped entirely on the first turn)
  ▼
planQuery(standalone)  ──► metadata | semantic          [UNCHANGED, pure]
  │
  ├─ metadata: cb_transcripts filtered by id / client / type / date
  └─ semantic: cb_match_chunks(..., p_transcript_id)
  │
  ▼
THE GUARD — zero relevant excerpts ⇒ return "nothing relevant", never call the model  [UNCHANGED]
  │
  ▼
answer + citations (meeting, speaker, timestamp, quote, similarity)


POST /api/strategy-ai?action=summary   { transcriptId }
  └─ handlerSummary → one Gemini call over full_text → cached in cb_transcripts.summary
```

### 1. Surface — `src/pages/AskPage.tsx`

- One `NAV_SECTIONS` entry in `AppLayout.tsx` after Strategy:
  `{ path: '/ask', label: 'Ask', icon: HelpCircle, fullBleed: true }`.
  `fullBleed` matches the Chat section — this is a chat surface, not a padded content page.
- One route in `App.tsx` under the `<Route element={<AppLayout />}>` block.
- Deep-linkable: `/ask?transcript=<id>` and `/ask?client=<id>` pre-set the scope.
- `StrategyMeetingPage` gets an **"Ask about this call"** button that navigates in with the scope set.

**The entry point ships in the same diff as the feature.** Tests prove code works; they never prove
a user can reach it. Five prior bugs in this feature were exactly that.

Chat history is component state. **No persistence table** — add one when someone asks to keep a
thread, not before.

### 2. Scope — one param, not three code paths

```ts
type Scope =
  | { kind: 'meeting'; transcriptId: string }
  | { kind: 'client';  clientId: string }
  | { kind: 'all' }
```

`handleAsk` already treats `clientId: null` as "every client", so `all` needs no new branch.

The meeting picker reads `cb_transcripts` (title, `meeting_date`, `meeting_type`, `client_id`) —
**ingested rows from Supabase, never the Fireflies API.** Fireflies is 500 req/day on the team's
tier and `/strategy` already spends one request per visit with no caching; a picker that called it
would multiply that by every question asked. A useful side effect: the picker is an honest answer to
"is this call in the bot yet?"

### 3. Server — extend `handleAsk`

Request body gains two optional fields:

```ts
{ question: string, clientId?: string, transcriptId?: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }> }
```

Both retrieval paths take the same filter:

- **metadata path** — add `id=eq.<transcriptId>` to the existing filter chain in `handlerAsk.ts`.
- **semantic path** — `cb_match_chunks` gains `p_transcript_id uuid default null`.

**Rejected alternative: post-filter in Node.** `cb_match_chunks` already returns `transcript_id`, so
we could drop non-matching rows after the call and skip the migration entirely. This is wrong for the
same reason it was wrong in location discovery: the function returns the global top `match_count`
(12), so post-filtering can yield **zero** rows for a meeting that contains plenty of relevant
content — it simply lost the ranking race to other calls. The filter must be inside the query.

### 4. Migration — `supabase/migrations/20260817000000_ask_transcript_scope.sql`

1. `drop function cb_match_chunks(vector, int, uuid, text);`
2. Recreate with `p_transcript_id uuid default null` and a `where (p_transcript_id is null or
   c.transcript_id = p_transcript_id)` clause added to the existing predicates.
3. **`revoke` / `grant` must be re-issued against the new signature**
   `(vector, int, uuid, text, uuid)`. The existing statements name the old arg list; missing this
   leaves the function un-executable by `authenticated` and every semantic query fails.
4. **Stays `SECURITY INVOKER`.** It must keep inheriting the RLS policies. Never make it definer.
**Split across two migrations during planning**, because the work ships as two independent PRs:
`20260817000000_ask_transcript_scope.sql` carries steps 1–4 (chat), and
`20260817000001_transcript_summary.sql` adds `cb_transcripts.summary jsonb` +
`summary_generated_at timestamptz` for §6 (PDFs). Either can be applied first.

**Deploy order: migration first, then the code.** The drop-and-recreate briefly leaves no function
matching the old signature, so shipping code that passes the new arg before the migration lands
fails every semantic query. Per project history, `supabase db push` from inside Claude Code is
blocked by the permission classifier — a human runs it.

### 5. Follow-ups — `api/_lib/rewriteFollowup.ts`

When `history` is non-empty, one Gemini call turns the last ~4 turns plus the new question into a
standalone question. When it is empty, **no call and no cost**. The rewrite is conservative: an
already-self-contained question comes back unchanged.

`planQuery` then runs on the **rewritten** question. This is the whole point:

```
turn 1  "what happened in the Oct 12 onboarding call"   → metadata, Oct 12
turn 2  "and pricing?"                                   → rewritten to
        "what did they say about pricing in the Oct 12 onboarding call"
        → still scoped to Oct 12, now a topic query
```

Without the rewrite, turn 2 embeds as a bare two-word question and retrieves near-nothing, which the
guard correctly reports as "nothing relevant" — reading to the user as a broken bot rather than as
a short question.

The guard itself is untouched and still sits between retrieval and the answering model.

### 6. The two PDFs

**Raw transcript** — no model call at all. Renders `cb_transcripts.full_text` into a print-styled
view. It **must** use `full_text`, not `cb_transcript_chunks`: the chunks carry deliberate overlap
for retrieval quality, so concatenating them duplicates text at every boundary.

**Meeting summary** — new `summary` action on `api/strategy-ai.ts`, body in
`api/_lib/handlerSummary.ts`. One Gemini call over `full_text` under the existing "never invent a
figure" rule, with a `responseSchema` fixing the stored shape:

```ts
{
  discussion:   Array<{ text: string; timestamp: string }>
  decisions:    Array<{ text: string; timestamp: string }>
  action_items: Array<{ text: string; owner: string | null; timestamp: string }>
  key_numbers:  Array<{ label: string; value: string; timestamp: string }>
}
```

`text` rather than `point`/`decision`/`item` so one normaliser handles three of the four sections.
A missing timestamp becomes `''`, never a guess — a fabricated timestamp in printed minutes is
worse than an absent one, because it looks verifiable.

That exact object is what lands in `cb_transcripts.summary`. Timestamps are `m:ss`, matching
`fmtTime` in `handlerAsk.ts`. Cached with a **Regenerate** button, because summaries are viewed
repeatedly by a whole team and a 60-minute transcript is not a cheap call.

**No new `api/` file for either.** `api/` holds 11 files and Vercel's Hobby cap is 12 serverless
functions per deployment; exceeding it fails at "Deploying outputs…" with an otherwise clean build.
Handler bodies in `_lib/` do not count.

Both print via `window.print()` + `@media print`, matching `StrategyClientPage.tsx:92` and
`StrategyPage.tsx:340`. **No PDF dependency** — `package.json` has none today and needs none.

## Error handling

| Case | Behaviour |
| --- | --- |
| Nothing clears `MIN_SIMILARITY` | Existing `no_relevant_content` response. The UI renders it as a normal assistant message, **not** an error toast — it is a legitimate answer. |
| Retrieval succeeded, excerpts don't answer | Existing `not_covered_by_transcripts`. Same treatment. |
| Transcript has `full_text = null` | Both PDFs report "this call has no transcript text ingested" rather than printing blank. |
| Rewrite call fails | Fall through to the raw question. A degraded retrieval beats a dead chat. |
| Summary call fails | Existing `502` shape; the cached summary (if any) stays readable. |

## Testing

- `rewriteFollowup` — history windowing and the rewrite-or-not decision (pure parts).
- Transcript-scope filter construction for the metadata path.
- Summary response shape validation.
- **The PostgREST column guard already exists** — `api/_lib/cbColumnDrift.test.ts` parses the
  migrations for the columns that exist and cross-checks every column the app references, so the two
  columns added here are covered automatically. No new test needed; just keep it green. (Corrected
  during planning: this section previously called for building it.)

## Prerequisite — verify before shipping

**Is `20260810000000_transcript_brain_open_access.sql` applied to prod?** PR #98's commit body says
NOT APPLIED. If it never landed, RLS is still `is_admin()`-only while the server-side gates have all
been removed — so `/ask` returns empty results for every non-admin, which is the entire audience for
this bot. Confirm before any of this ships.

Related stale doc: CLAUDE.md still describes the `cb_` tables as "admin-only RLS".

## Explicitly out of scope

- Chat-thread PDF export (declined).
- Persisted chat threads.
- Per-client access scoping. `cb_transcripts.owner_user_id` exists and is unused, so this can be
  added later without a migration — but note that today **every signed-in member can read every
  transcript, including margins and ticket sizes, with no record of who read what.**
- Any change to `useContentStrategy.ts` or the 4-stage pipeline.
