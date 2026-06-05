# Supabase Data Sync — Design Spec

**Date:** 2026-06-05
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/supabase-data-sync`

## Goal

Move all browser-local app state (creator/content corpus, conversations, reel
analysis runs) from IndexedDB/localStorage into Supabase Postgres, tied to the
logged-in Clerk user, so data persists across devices. Auth stays with Clerk;
Supabase is **storage only**.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Data ownership | **Corpus shared** (team brain); **conversations + reels private** per user |
| Read/write model | **Cloud-first** — Supabase is the single source of truth; localStorage/IndexedDB dropped (no local cache) |
| Existing local data | **Start fresh** — no migration of current browser data |
| Auth ↔ DB bridge | **Clerk native third-party auth + Supabase RLS** (direct browser client, no API proxy) |
| Corpus concurrency | **Normalized sightings** child table (append-only, race-free) |

## Architecture

```
Browser
 ├─ Clerk session  →  session.getToken()  →  JWT { sub: clerkUserId, role: "authenticated" }
 └─ Supabase client (anon key + accessToken callback returning the Clerk JWT)
       └─ Postgres + Row-Level Security
            ├─ corpus_creators / corpus_sightings / corpus_content  → any authenticated user (shared)
            └─ conversations + reels (user_state)                   → (select auth.jwt()->>'sub') = user_id  (private)
```

### Clerk ↔ Supabase bridge (CRITICAL — current API)

The legacy **JWT-template** approach (`getToken({ template: 'supabase' })`) was
**deprecated April 1, 2025**. This design uses Clerk's **native third-party
auth** integration:

- **Clerk dashboard:** enable the Supabase integration, save the Clerk domain.
- **Supabase dashboard:** Authentication → Sign In / Providers → add Clerk as a
  third-party provider, paste the Clerk domain.
- The `role: "authenticated"` claim is injected into the session token
  automatically by the integration — no manual claim config.
- Client uses `session.getToken()` with **no template argument**.

### Client singleton + token wiring

`src/lib/supabaseClient.ts` exports one client:

```ts
import { createClient } from '@supabase/supabase-js'

let getClerkToken: (() => Promise<string | null>) | null = null
export function setClerkTokenGetter(fn: () => Promise<string | null>) {
  getClerkToken = fn
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { accessToken: async () => (getClerkToken ? await getClerkToken() : null) },
)
```

`setClerkTokenGetter` is called once from `App.tsx` after Clerk loads, so the
Zustand stores (module-level singletons, not React components) can import
`supabase` and issue authenticated requests without using React hooks. This is
safe because every store call happens behind the `<Show when="signed-in">`
gate — Clerk is always loaded and a token is available first.

## Schema

### Shared "team brain" — RLS = any authenticated user

```sql
create table corpus_creators (
  username            text primary key,
  full_name           text,
  profile_pic_url     text,
  verified            boolean default false,
  is_business_account boolean default false,
  followers_count     integer default 0,
  follows_count       integer default 0,
  posts_count         integer default 0,
  avg_likes           numeric default 0,
  avg_comments        numeric default 0,
  engagement_rate     numeric,                 -- nullable
  top_hashtags        jsonb default '[]'::jsonb,
  last_post_date      text,
  first_seen_at       timestamptz default now(),
  last_seen_at        timestamptz default now(),
  times_seen          integer default 0,       -- atomic SET = times_seen + 1, no race
  feedback            text,                    -- 'saved' | 'dismissed' (shared, team-wide)
  feedback_at         timestamptz
);

create table corpus_sightings (               -- append-only → race-free
  id                  uuid primary key default gen_random_uuid(),
  creator_username    text references corpus_creators(username) on delete cascade,
  at                  timestamptz default now(),
  pipeline            text not null,           -- 'competitor' | 'discovery'
  niche               text,
  city                text,
  category            text,                    -- 'top' | 'trending'
  rank                integer,
  rationale           text,
  specialties         jsonb,
  content_focus       text,
  partnership_ready   boolean,
  location_confidence text,                    -- 'confirmed' | 'likely' | 'unknown'
  created_by          text                     -- Clerk sub of the contributor (attribution)
);
create index corpus_sightings_creator_idx on corpus_sightings(creator_username);

create table corpus_content (                  -- analyzed reels per creator
  id                  text primary key,        -- reel shortCode
  creator_username    text references corpus_creators(username) on delete cascade,
  payload             jsonb not null,          -- ContentRecord minus the FK fields
  updated_at          timestamptz default now()
);
create index corpus_content_creator_idx on corpus_content(creator_username);
```

**Sightings cap:** the in-memory model capped `sightings[]` at N most-recent.
The DB keeps all sighting rows (append-only); `listSightingsFor` applies
`order by at desc limit N` at read time so callers still see the capped, recent
view. `times_seen` remains the lifetime count (a column, atomically incremented).

### Private per-user — RLS = `(select auth.jwt()->>'sub') = user_id`

```sql
create table user_state (
  user_id    text not null,
  key        text not null,           -- 'contentos-conversations' | 'contentos-reels'
  value      jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);
```

### RLS policies

```sql
alter table corpus_creators  enable row level security;
alter table corpus_sightings enable row level security;
alter table corpus_content   enable row level security;
alter table user_state       enable row level security;

-- Shared: any signed-in user reads + writes the team corpus
create policy corpus_creators_all  on corpus_creators  for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- (same shape for corpus_sightings, corpus_content)

-- Private: a user only sees / writes their own rows
create policy user_state_rw on user_state for all
  using  ((select auth.jwt()->>'sub') = user_id)
  with check ((select auth.jwt()->>'sub') = user_id);
```

`(select auth.jwt()…)` is wrapped in a sub-select so Postgres evaluates it once
per query (initplan), not once per row.

## Components / file changes

| File | Change |
|---|---|
| **New** `src/lib/supabaseClient.ts` | Client singleton + `setClerkTokenGetter()` |
| **New** `src/store/supabaseStorage.ts` | Zustand `StateStorage` adapter → `user_state` (replaces `safePersistStorage` for the two private stores) |
| **New** `src/lib/supabaseCorpus.ts` | `CorpusRepository` impl over the 3 corpus tables |
| **Edit** `src/store/conversationsStore.ts` | Swap storage adapter; add `skipHydration: true` |
| **Edit** `src/store/reelAnalysisStore.ts` | Swap storage adapter; add `skipHydration: true` |
| **Edit** `src/lib/corpusIdb.ts` | Default `corpus` export → `supabaseCorpus`; drop the IDB impl (or keep behind a flag for tests) |
| **Edit** `src/App.tsx` | On sign-in: wire token getter → rehydrate both stores + `corpus.hydrate()`. On sign-out: reset stores |
| **Edit** `.env.example` | Document `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

### CorpusRepository mapping (interface unchanged)

The existing async `CorpusRepository` interface is preserved; only the impl
changes. Mapping from IDB ops to SQL:

- `remember(inputs)` → per creator: `upsert` identity+freshest-metrics into
  `corpus_creators` (freshest-wins on conflict) with `times_seen = times_seen + 1`
  and `last_seen_at = now()`; `insert` one `corpus_sightings` row. Batched.
- `get(username)` → `select … where username = ?` (+ join/2nd query for sightings).
- `getMany(usernames)` → **single** `select … where username in (…)` (fixes N+1).
- `setFeedback(username, fb, at)` → `update corpus_creators set feedback…` ;
  returns undefined if the creator row doesn't exist (never mint from a verdict).
- `list({sort, limit})` → `select … order by <sort> limit <limit>` (server-side).
- `count()` → `select count(*)`.
- `rememberContent(records)` → `upsert` into `corpus_content`.
- `listContentFor(username)` → `select … where creator_username = ?`.

The pure logic in `corpus.ts` (`mergeCreator`, `sortCreators`, `applyFeedback`,
`createMemoryCorpus`) stays for unit tests and the in-memory test double.

## Data flow & lifecycle

1. App boots → `<Show when="signed-out">` redirects to `/sign-in`.
2. User signs in → `<Show when="signed-in">` mounts the app.
3. `App.tsx` effect (signed-in): `setClerkTokenGetter(() => getToken())`, then
   `useConversationsStore.persist.rehydrate()`,
   `useReelAnalysisStore.persist.rehydrate()`, and `corpusStore.hydrate()`.
4. Reads/writes go straight to Supabase (RLS scopes them).
5. Sign-out → reset in-memory stores so the next user on a shared machine never
   sees the previous user's private data.

**Why `skipHydration: true`:** Zustand `persist` hydrates eagerly at module
import — before Clerk has issued a token. Deferring rehydration to the signed-in
effect guarantees the token getter is wired and a valid JWT exists before the
first DB read.

## Error handling

- **Offline = degraded, by design.** Cloud-first with no local cache (explicit
  decision). A failed write surfaces a toast and is **not** silently shadowed to
  localStorage. Reads fall back to empty state and can be retried.
- **No silent failures.** Supabase errors are mapped to fixed, user-safe strings
  via the existing `errorMessages.ts` pattern (code-keyed; never raw API bodies).
- **Sign-out store reset** prevents cross-user data leakage on shared browsers.

## Testing

- Pure `corpus.ts` logic tests stay green (unchanged).
- `supabaseCorpus.ts` and `supabaseStorage.ts` are tested against a **mocked
  Supabase client** (mirrors how `gemini.rotation.test.ts` mocks `fetch`): assert
  the right table/columns/filters are used and results map back to the domain
  types. No live Supabase project needed — `tsc`, vitest, lint all go green
  offline.
- Existing store tests updated for `skipHydration` + the new adapter.

## Operator / setup steps (not code)

1. Create (or reuse) a Supabase project; copy `VITE_SUPABASE_URL` +
   `VITE_SUPABASE_ANON_KEY`.
2. Run the schema + RLS SQL (migration file in the repo, applied via Supabase
   CLI `supabase db push` or the SQL editor).
3. Clerk dashboard → enable Supabase integration → save Clerk domain.
4. Supabase dashboard → Auth → Third-Party → add Clerk (paste domain).
5. Add the two `VITE_SUPABASE_*` env vars to Vercel (Production + Preview) and
   to local `.env`; redeploy.

## Out of scope

- Realtime subscriptions / live multi-user cursors.
- Edge Function key-proxy (moving Gemini/Apify keys out of the bundle) — a
  separate future phase.
- Migrating existing browser-local data (start-fresh decision).
- Conflict resolution beyond last-write-wins for private single-writer data.
