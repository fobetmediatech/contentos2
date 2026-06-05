# Supabase Data Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all browser-local app state (shared creator/content corpus, private conversations + reel runs) into Supabase Postgres, scoped to the logged-in Clerk user via native third-party auth + RLS.

**Architecture:** A single browser Supabase client sends the Clerk session JWT on every request (`accessToken` callback). RLS makes the corpus tables readable/writable by any authenticated user (shared team brain) and the `user_state` KV table private per user. The corpus keeps its existing `CorpusRepository` interface (new Supabase impl); conversations + reels keep their Zustand `persist` config but swap the storage adapter to an async `PersistStorage` over `user_state`. Cloud-first: localStorage/IndexedDB are dropped; data starts fresh.

**Tech Stack:** React 19, TypeScript, Zustand (persist middleware), TanStack Query, Vite, Vitest, `@clerk/react` (live), `@supabase/supabase-js` (new), Supabase Postgres + RLS.

**Spec:** `docs/superpowers/specs/2026-06-05-supabase-data-sync-design.md`

**Conventions (enforce in every task):**
- Vitest `environment: 'node'` globally → component/jsdom test files need `// @vitest-environment jsdom` as the FIRST line + `afterEach(cleanup)`. (These tasks are all pure-logic/lib tests — node env, no jsdom needed.)
- NO `@testing-library/jest-dom`. Use `.toBeTruthy()` / `.toBeNull()` / `.toEqual()`.
- Zustand store factory pattern (`makeCorpusStore` is the model).
- DESIGN.md tokens for any UI (this plan touches almost no UI).
- Keep `errorMessages.ts` pattern for user-facing errors (fixed strings, never raw API bodies).

**Out of scope:** realtime subscriptions, Edge Function key-proxy, migrating existing browser-local data.

---

## File Structure

| File | Responsibility |
|---|---|
| **New** `src/lib/supabaseClient.ts` | The one Supabase client (anon key + `accessToken` callback) + `setClerkTokenGetter()` module setter |
| **New** `supabase/migrations/20260605000000_init_data_sync.sql` | Tables, view, RLS, policies, indexes |
| **New** `src/lib/supabaseCorpus.ts` | `CorpusRepository` over the corpus tables/view (zero-I/O construction) |
| **New** `src/lib/supabaseCorpus.test.ts` | Unit tests vs a mocked Supabase client |
| **New** `src/store/supabaseStorage.ts` | Async `PersistStorage<T>` adapter over `user_state.value` jsonb |
| **New** `src/store/supabaseStorage.test.ts` | Unit tests vs a mocked Supabase client |
| **New** `src/test/supabaseClientMock.ts` | Shared chainable fake query-builder for the two test files |
| **Edit** `src/lib/corpusIdb.ts` | Bind `corpus` export to `createSupabaseCorpus()`; drop the IndexedDB impl |
| **Delete** `src/lib/corpusIdb.test.ts` | Tested the removed IDB impl |
| **Edit** `src/store/conversationsStore.ts` | Swap storage → `supabaseStorage`; `skipHydration: true`; remove dead `onRehydrateStorage` legacy migration |
| **Edit** `src/store/reelAnalysisStore.ts` | Swap storage → `supabaseStorage`; `skipHydration: true`; KEEP `merge`/`isCleanReelRun` |
| **Edit** `src/App.tsx` | On sign-in: wire token getter → rehydrate stores + `corpus.hydrate()`; on sign-out: reset stores + corpus mirror |
| **Edit** `.env.example` | Document `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |
| **Edit** `package.json` | Add `@supabase/supabase-js` |

`src/store/corpusStore.ts` and `src/pages/MemoryPage.tsx` are **NOT** edited — they import `corpus` from `corpusIdb.ts`, whose export name we preserve.

---

## Chunk 1: Foundation (client + schema)

### Task 1: Supabase client singleton

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/lib/supabaseClient.ts`
- Test: `src/lib/supabaseClient.test.ts`

- [ ] **Step 1: Install the SDK**

Run: `npm install @supabase/supabase-js`
Expected: `package.json` dependencies gains `@supabase/supabase-js`. Commit this in Step 6.

- [ ] **Step 2: Write the failing test**

Create `src/lib/supabaseClient.test.ts`:

```ts
/**
 * The Supabase client must construct safely at import (placeholder env in tests) and
 * expose setClerkTokenGetter so module-level stores can supply the Clerk JWT lazily.
 */
import { describe, it, expect } from 'vitest'
import { supabase, setClerkTokenGetter } from './supabaseClient'

describe('supabaseClient', () => {
  it('constructs a client at import without throwing', () => {
    expect(supabase).toBeTruthy()
    expect(typeof supabase.from).toBe('function')
  })

  it('exposes setClerkTokenGetter as a function', () => {
    expect(typeof setClerkTokenGetter).toBe('function')
    // wiring a getter must not throw
    expect(() => setClerkTokenGetter(async () => 'tok')).not.toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/lib/supabaseClient.test.ts`
Expected: FAIL — `Cannot find module './supabaseClient'`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/supabaseClient.ts`:

```ts
/**
 * The one Supabase client for the whole app — storage only (auth is Clerk).
 *
 * Every request carries the Clerk session JWT via the `accessToken` callback, so
 * Supabase RLS can scope rows by the Clerk user id (auth.jwt()->>'sub'). The token
 * getter is wired ONCE from App.tsx after Clerk loads (setClerkTokenGetter), which
 * lets module-level Zustand stores use this client without React hooks. Safe because
 * every store call happens behind the signed-in gate, so a token always exists by
 * the first query.
 *
 * Placeholder env fallbacks keep construction from throwing under Vitest (node),
 * where VITE_* are undefined; real calls are always mocked in tests.
 */
import { createClient } from '@supabase/supabase-js'

let getClerkToken: (() => Promise<string | null>) | null = null

/** Wire the Clerk token source. Called once from App.tsx on sign-in. */
export function setClerkTokenGetter(fn: () => Promise<string | null>): void {
  getClerkToken = fn
}

const url = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const supabase = createClient(url, anonKey, {
  accessToken: async () => (getClerkToken ? await getClerkToken() : null),
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/lib/supabaseClient.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/supabaseClient.ts src/lib/supabaseClient.test.ts
git commit -m "feat(data): add Supabase client singleton + Clerk token getter"
```

---

### Task 2: SQL migration (schema + RLS)

**Files:**
- Create: `supabase/migrations/20260605000000_init_data_sync.sql`

No unit test (DB code). Verified by the operator apply step + a build at the end.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260605000000_init_data_sync.sql`:

```sql
-- Content OS 2.0 — data sync schema. Corpus = shared team brain; user_state = private.
-- Identity columns are camelCase-free (snake_case); the app maps to/from camelCase.

-- ---------- Shared corpus ----------
create table if not exists corpus_creators (
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
  engagement_rate     numeric,
  top_hashtags        jsonb default '[]'::jsonb,
  last_post_date      text,
  feedback            text,
  feedback_at         timestamptz
);

create table if not exists corpus_sightings (
  id                  uuid primary key default gen_random_uuid(),
  creator_username    text references corpus_creators(username) on delete cascade,
  at                  timestamptz default now(),
  pipeline            text not null,
  niche               text,
  city                text,
  category            text,
  rank                integer,
  rationale           text,
  specialties         jsonb,
  content_focus       text,
  partnership_ready   boolean,
  location_confidence text,
  created_by          text
);
create index if not exists corpus_sightings_creator_idx on corpus_sightings(creator_username);

-- Derived bookkeeping: times_seen = COUNT, first/last_seen_at = MIN/MAX(at).
create or replace view corpus_creators_view as
  select c.*,
         coalesce(s.times_seen, 0) as times_seen,
         s.first_seen_at,
         s.last_seen_at
  from corpus_creators c
  left join (
    select creator_username,
           count(*) as times_seen,
           min(at)  as first_seen_at,
           max(at)  as last_seen_at
    from corpus_sightings
    group by creator_username
  ) s on s.creator_username = c.username;

create table if not exists corpus_content (
  id               text primary key,
  creator_username text references corpus_creators(username) on delete cascade,
  analyzed_at      timestamptz default now(),
  payload          jsonb not null,
  updated_at       timestamptz default now()
);
create index if not exists corpus_content_creator_idx on corpus_content(creator_username);

-- ---------- Private per-user KV ----------
-- user_id auto-fills from the Clerk JWT 'sub' on insert, so the client never sends it.
create table if not exists user_state (
  user_id    text not null default (auth.jwt() ->> 'sub'),
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

-- ---------- Row-Level Security ----------
alter table corpus_creators  enable row level security;
alter table corpus_sightings enable row level security;
alter table corpus_content   enable row level security;
alter table user_state       enable row level security;

-- Shared: any signed-in user reads + writes the team corpus.
create policy corpus_creators_all on corpus_creators for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy corpus_sightings_all on corpus_sightings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy corpus_content_all on corpus_content for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Private: a user only sees / writes their own rows.
create policy user_state_rw on user_state for all
  using ((select auth.jwt() ->> 'sub') = user_id)
  with check ((select auth.jwt() ->> 'sub') = user_id);

-- The view runs with the querying user's privileges (security_invoker) so RLS on the
-- base tables still applies through it.
alter view corpus_creators_view set (security_invoker = on);
```

- [ ] **Step 2: (Operator) Apply the migration**

This needs a Supabase project + linked CLI. Two paths — pick one:

**CLI (preferred):**
```bash
supabase init          # only if supabase/config.toml doesn't exist; keep generated config
supabase link --project-ref <PROJECT_REF>   # needs SUPABASE_ACCESS_TOKEN in env
supabase db push       # applies migrations/*.sql
```

**Dashboard fallback:** open Supabase → SQL Editor → paste the file contents → Run.

Expected: four tables + one view + four policies created. Verify in Table Editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260605000000_init_data_sync.sql supabase/config.toml
git commit -m "feat(data): Supabase schema + RLS for corpus and user_state"
```

(If `supabase init` was not run, just commit the migration file.)

---

## Chunk 2: Repository + storage adapter

### Task 3: Shared test mock — chainable Supabase fake

**Files:**
- Create: `src/test/supabaseClientMock.ts`

This is a tiny test helper (no production code). It's exercised by Tasks 3-impl and 4 tests, so build it first. It has its own focused test to prove the fake behaves.

- [ ] **Step 1: Write the failing test**

Create `src/test/supabaseClientMock.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { makeSupabaseMock } from './supabaseClientMock'

describe('makeSupabaseMock', () => {
  it('returns queued select results and records the table + filters used', async () => {
    const mock = makeSupabaseMock({
      select: [[{ username: 'a' }]],          // one queued result for a select chain
    })
    const res = await mock.client.from('corpus_creators').select('*').in('username', ['a'])
    expect(res.data).toEqual([{ username: 'a' }])
    expect(mock.calls.from).toContain('corpus_creators')
    expect(mock.calls.in).toContainEqual(['username', ['a']])
  })

  it('records upsert payloads', async () => {
    const mock = makeSupabaseMock({})
    await mock.client.from('user_state').upsert({ key: 'k', value: { state: 1 } })
    expect(mock.calls.upsert[0]).toEqual([{ key: 'k', value: { state: 1 } }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/test/supabaseClientMock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the mock**

Create `src/test/supabaseClientMock.ts`:

```ts
/**
 * Minimal chainable fake of the Supabase JS query builder for unit tests.
 *
 * Mirrors the fetch-mock style used in gemini.rotation.test.ts: tests queue the
 * results each terminal call should resolve to, then assert which tables / filters /
 * payloads were used. Only the methods our repository + storage adapter actually call
 * are implemented (select, in, eq, order, limit, maybeSingle, upsert, insert, update,
 * delete). Terminal awaits resolve to { data, error }.
 */
import { vi } from 'vitest'

type Result = { data: unknown; error: unknown }

export interface MockConfig {
  /** FIFO queues of results, one entry consumed per matching terminal call. */
  select?: unknown[]   // each entry = the `data` a select chain resolves to
  maybeSingle?: unknown[]
  insert?: unknown[]
  upsert?: unknown[]
  update?: unknown[]
  delete?: unknown[]
  error?: unknown      // if set, every terminal call resolves { data: null, error }
}

export function makeSupabaseMock(cfg: MockConfig) {
  const calls = {
    from: [] as string[],
    select: [] as unknown[],
    in: [] as Array<[string, unknown]>,
    eq: [] as Array<[string, unknown]>,
    order: [] as unknown[],
    limit: [] as number[],
    insert: [] as unknown[],
    upsert: [] as unknown[],
    update: [] as unknown[],
    delete: [] as number[],
  }
  const queues: Record<string, unknown[]> = {
    select: [...(cfg.select ?? [])],
    maybeSingle: [...(cfg.maybeSingle ?? [])],
    insert: [...(cfg.insert ?? [])],
    upsert: [...(cfg.upsert ?? [])],
    update: [...(cfg.update ?? [])],
    delete: [...(cfg.delete ?? [])],
  }
  const take = (k: string): Result =>
    cfg.error ? { data: null, error: cfg.error } : { data: queues[k].shift() ?? null, error: null }

  // A chain is thenable: awaiting it resolves the pending terminal result.
  function chain(terminalKey: string) {
    let pending: Result = take(terminalKey)
    const api: Record<string, unknown> = {
      select: (..._a: unknown[]) => { calls.select.push(_a); pending = take('select'); return api },
      in: (col: string, vals: unknown) => { calls.in.push([col, vals]); return api },
      eq: (col: string, val: unknown) => { calls.eq.push([col, val]); return api },
      order: (..._a: unknown[]) => { calls.order.push(_a); return api },
      limit: (n: number) => { calls.limit.push(n); return api },
      maybeSingle: () => { pending = take('maybeSingle'); return api },
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(pending).then(res, rej),
    }
    return api
  }

  const client = {
    from: vi.fn((table: string) => {
      calls.from.push(table)
      return {
        select: (..._a: unknown[]) => { calls.select.push(_a); return chain('select') },
        insert: (payload: unknown) => { calls.insert.push(payload); return chain('insert') },
        upsert: (payload: unknown, _opts?: unknown) => { calls.upsert.push(payload); return chain('upsert') },
        update: (payload: unknown) => { calls.update.push(payload); return chain('update') },
        delete: () => { calls.delete.push(1); return chain('delete') },
      }
    }),
  }
  return { client, calls }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/test/supabaseClientMock.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/test/supabaseClientMock.ts src/test/supabaseClientMock.test.ts
git commit -m "test(data): chainable Supabase query-builder mock"
```

> **Note for the implementer:** if the real `supabaseCorpus`/`supabaseStorage` use a Supabase chain method this mock doesn't implement, extend the mock (add the method, returning `api`/`chain`) as part of that task — keep the fake in lock-step with the code it stands in for.

---

### Task 4: `supabaseCorpus` — CorpusRepository over Postgres

**Files:**
- Create: `src/lib/supabaseCorpus.ts`
- Test: `src/lib/supabaseCorpus.test.ts`

**Behavior to preserve (from `corpus.ts` / `corpusIdb.ts`):**
- `remember`: append a sighting; refresh metrics only when `followersCount > 0`; return fully-hydrated records.
- `get`/`getMany`: assemble `CreatorRecord` incl. derived `timesSeen`/`firstSeenAt`/`lastSeenAt` + recent `sightings` (cap `SIGHTINGS_CAP`, most recent).
- `setFeedback`: returns `undefined` for an unknown creator (never mints one).
- `list`: server-side sort (engagement_rate `nulls last`), optional limit.
- `clear`: **throws** on the Supabase impl (destructive on shared data; tests use the in-memory double).
- Construction does **zero I/O** (token read lazily per method).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/supabaseCorpus.test.ts`:

```ts
/**
 * supabaseCorpus maps the CorpusRepository contract onto the corpus tables/view.
 * Tested against the chainable Supabase mock (no live DB). Asserts the right
 * tables/filters are used and rows map back to camelCase CreatorRecords.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeSupabaseMock } from '../test/supabaseClientMock'

// Each test installs its own mock before importing the module under test.
let mock: ReturnType<typeof makeSupabaseMock>
vi.mock('./supabaseClient', () => ({ supabase: new Proxy({}, { get: (_t, p) => (mock.client as Record<string | symbol, unknown>)[p] }) }))

import { createSupabaseCorpus } from './supabaseCorpus'

beforeEach(() => { mock = makeSupabaseMock({}) })

const creatorRow = (over: Record<string, unknown> = {}) => ({
  username: 'foodie', full_name: 'Foodie', profile_pic_url: 'p', verified: true,
  is_business_account: false, followers_count: 1000, follows_count: 10, posts_count: 50,
  avg_likes: 100, avg_comments: 5, engagement_rate: 0.1, top_hashtags: ['#food'],
  last_post_date: null, feedback: null, feedback_at: null,
  times_seen: 3, first_seen_at: '2026-06-01T00:00:00Z', last_seen_at: '2026-06-03T00:00:00Z',
  ...over,
})

describe('supabaseCorpus construction', () => {
  it('does no I/O at construction', () => {
    createSupabaseCorpus()
    expect(mock.calls.from).toHaveLength(0) // nothing queried until a method runs
  })
})

describe('getMany', () => {
  it('uses a single .in() query on the view and maps rows to CreatorRecords', async () => {
    mock = makeSupabaseMock({ select: [[creatorRow()], []] }) // creators, then sightings
    const corpus = createSupabaseCorpus()
    const recs = await corpus.getMany(['foodie'])
    expect(mock.calls.from).toContain('corpus_creators_view')
    expect(mock.calls.in).toContainEqual(['username', ['foodie']])
    expect(recs[0].username).toBe('foodie')
    expect(recs[0].timesSeen).toBe(3)
    expect(recs[0].followersCount).toBe(1000)
    expect(typeof recs[0].firstSeenAt).toBe('number') // timestamptz → ms
  })
})

describe('setFeedback', () => {
  it('returns undefined when no creator row is updated', async () => {
    mock = makeSupabaseMock({ update: [[]] }) // update returns no rows
    const corpus = createSupabaseCorpus()
    const out = await corpus.setFeedback('ghost', 'saved', 123)
    expect(mock.calls.update[0]).toMatchObject({ feedback: 'saved' })
    expect(out).toBeUndefined()
  })
})

describe('clear', () => {
  it('throws (destructive on shared data)', async () => {
    const corpus = createSupabaseCorpus()
    await expect(corpus.clear()).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/supabaseCorpus.test.ts`
Expected: FAIL — `Cannot find module './supabaseCorpus'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/supabaseCorpus.ts`:

```ts
/**
 * Supabase-backed CorpusRepository (the shared team brain).
 *
 * Construction does ZERO I/O — every method goes through the module `supabase`
 * client, whose accessToken callback resolves the Clerk JWT lazily, so this is safe
 * to build at module import (corpusStore binds it before Clerk has a token).
 *
 * Bookkeeping (timesSeen / firstSeenAt / lastSeenAt) is derived in
 * corpus_creators_view; sightings are append-only (race-free). All dedupe/sort
 * SEMANTICS match corpus.ts so the in-memory double and this impl behave identically.
 */
import { supabase } from './supabaseClient'
import {
  SIGHTINGS_CAP,
  type CorpusRepository, type CreatorInput, type CreatorRecord,
  type ContentRecord, type Feedback, type Sighting, type CorpusSort,
} from './corpus'

const SORT_COLUMN: Record<CorpusSort, string> = {
  lastSeenAt: 'last_seen_at',
  timesSeen: 'times_seen',
  followersCount: 'followers_count',
  engagementRate: 'engagement_rate',
}

const ms = (t: string | null): number => (t ? new Date(t).getTime() : 0)

interface SightingRow {
  creator_username: string; at: string; pipeline: string; niche: string | null
  city: string | null; category: string | null; rank: number | null
  rationale: string | null; specialties: string[] | null; content_focus: string | null
  partnership_ready: boolean | null; location_confidence: string | null
}

function rowToSighting(r: SightingRow): Sighting {
  return {
    at: ms(r.at), pipeline: r.pipeline as Sighting['pipeline'],
    niche: r.niche ?? undefined, city: r.city ?? undefined,
    category: (r.category as Sighting['category']) ?? undefined,
    rank: r.rank ?? undefined, rationale: r.rationale ?? undefined,
    specialties: r.specialties ?? undefined, contentFocus: r.content_focus ?? undefined,
    partnershipReady: r.partnership_ready ?? undefined,
    locationConfidence: (r.location_confidence as Sighting['locationConfidence']) ?? undefined,
  }
}

function rowToCreator(r: Record<string, unknown>, sightings: Sighting[]): CreatorRecord {
  return {
    username: r.username as string,
    fullName: (r.full_name as string) ?? '',
    profilePicUrl: (r.profile_pic_url as string) ?? '',
    verified: !!r.verified,
    isBusinessAccount: !!r.is_business_account,
    followersCount: (r.followers_count as number) ?? 0,
    followsCount: (r.follows_count as number) ?? 0,
    postsCount: (r.posts_count as number) ?? 0,
    avgLikes: (r.avg_likes as number) ?? 0,
    avgComments: (r.avg_comments as number) ?? 0,
    engagementRate: (r.engagement_rate as number | null) ?? null,
    topHashtags: (r.top_hashtags as string[]) ?? [],
    lastPostDate: (r.last_post_date as string) ?? undefined,
    firstSeenAt: ms(r.first_seen_at as string | null),
    lastSeenAt: ms(r.last_seen_at as string | null),
    timesSeen: (r.times_seen as number) ?? 0,
    sightings,
    feedback: (r.feedback as Feedback | null) ?? undefined,
    feedbackAt: r.feedback_at ? ms(r.feedback_at as string) : undefined,
  }
}

/** Fetch recent sightings for a set of usernames, grouped + capped per creator. */
async function fetchSightings(usernames: string[]): Promise<Record<string, Sighting[]>> {
  const grouped: Record<string, Sighting[]> = {}
  if (usernames.length === 0) return grouped
  const { data, error } = await supabase
    .from('corpus_sightings')
    .select('*')
    .in('creator_username', usernames)
    .order('at', { ascending: false })
  if (error) throw error
  for (const row of (data ?? []) as SightingRow[]) {
    const list = (grouped[row.creator_username] ??= [])
    if (list.length < SIGHTINGS_CAP) list.push(rowToSighting(row))
  }
  // sightings[] in the domain type is oldest→newest (mergeCreator appends); reverse the
  // desc-capped slice so order matches the in-memory impl.
  for (const u of Object.keys(grouped)) grouped[u].reverse()
  return grouped
}

export function createSupabaseCorpus(): CorpusRepository {
  return {
    async remember(inputs: CreatorInput[]) {
      for (const { profile, sighting } of inputs) {
        const hasData = profile.followersCount > 0
        const row = {
          username: profile.username,
          full_name: profile.fullName,
          profile_pic_url: profile.profilePicUrl,
          verified: profile.verified,
          is_business_account: profile.isBusinessAccount,
          followers_count: profile.followersCount,
          follows_count: profile.followsCount,
          posts_count: profile.postsCount,
          avg_likes: profile.avgLikes,
          avg_comments: profile.avgComments,
          engagement_rate: profile.engagementRate,
          top_hashtags: profile.topHashtags,
          last_post_date: profile.lastPostDate ?? null,
        }
        // hasData → update metrics on conflict; no-data → ensure row exists, never clobber.
        const { error: cErr } = hasData
          ? await supabase.from('corpus_creators').upsert(row)
          : await supabase.from('corpus_creators').upsert(row, { ignoreDuplicates: true })
        if (cErr) throw cErr
        const { error: sErr } = await supabase.from('corpus_sightings').insert({
          creator_username: profile.username,
          at: new Date(sighting.at).toISOString(),
          pipeline: sighting.pipeline,
          niche: sighting.niche ?? null,
          city: sighting.city ?? null,
          category: sighting.category ?? null,
          rank: sighting.rank ?? null,
          rationale: sighting.rationale ?? null,
          specialties: sighting.specialties ?? null,
          content_focus: sighting.contentFocus ?? null,
          partnership_ready: sighting.partnershipReady ?? null,
          location_confidence: sighting.locationConfidence ?? null,
        })
        if (sErr) throw sErr
      }
      return this.getMany(inputs.map((i) => i.profile.username))
    },

    async get(username: string) {
      const recs = await this.getMany([username])
      return recs[0]
    },

    async getMany(usernames: string[]) {
      if (usernames.length === 0) return []
      const { data, error } = await supabase
        .from('corpus_creators_view')
        .select('*')
        .in('username', usernames)
      if (error) throw error
      const rows = (data ?? []) as Record<string, unknown>[]
      const sightings = await fetchSightings(rows.map((r) => r.username as string))
      return rows.map((r) => rowToCreator(r, sightings[r.username as string] ?? []))
    },

    async setFeedback(username: string, feedback: Feedback | null, at: number) {
      const { data, error } = await supabase
        .from('corpus_creators')
        .update({ feedback, feedback_at: feedback ? new Date(at).toISOString() : null })
        .eq('username', username)
        .select()
      if (error) throw error
      if (!data || (data as unknown[]).length === 0) return undefined
      return this.get(username)
    },

    async list(opts?: { sort?: CorpusSort; limit?: number }) {
      const col = SORT_COLUMN[opts?.sort ?? 'lastSeenAt']
      let q = supabase
        .from('corpus_creators_view')
        .select('*')
        .order(col, { ascending: false, nullsFirst: false })
      if (opts?.limit != null) q = q.limit(opts.limit)
      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as Record<string, unknown>[]
      const sightings = await fetchSightings(rows.map((r) => r.username as string))
      return rows.map((r) => rowToCreator(r, sightings[r.username as string] ?? []))
    },

    async count() {
      const { count, error } = await supabase
        .from('corpus_creators')
        .select('*', { count: 'exact', head: true })
      if (error) throw error
      return count ?? 0
    },

    async rememberContent(records: ContentRecord[]) {
      if (records.length === 0) return
      const rows = records.map((r) => ({
        id: r.id,
        creator_username: r.creatorUsername,
        analyzed_at: new Date(r.analyzedAt).toISOString(),
        payload: r,
        updated_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('corpus_content').upsert(rows)
      if (error) throw error
    },

    async listContentFor(creatorUsername: string) {
      const { data, error } = await supabase
        .from('corpus_content')
        .select('payload')
        .eq('creator_username', creatorUsername)
        .order('analyzed_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as { payload: ContentRecord }[]).map((r) => r.payload)
    },

    async clear() {
      // Destructive on SHARED team data — never wired to a real delete. Tests use the
      // in-memory double (createMemoryCorpus) for clear() semantics.
      throw new Error('clear() is not supported on the shared Supabase corpus')
    },
  }
}
```

> The mock's `chain` may need `.select(...)` after `.update(...)` and a `count`/`head`
> select for `count()`. Extend `makeSupabaseMock` if a test hits an unimplemented method
> (e.g. add a `count` queue + return `{ data, error, count }`). Keep the fake aligned with
> the methods this file actually calls.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/supabaseCorpus.test.ts`
Expected: PASS. Extend the mock if a chain method is missing, then re-run.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabaseCorpus.ts src/lib/supabaseCorpus.test.ts src/test/supabaseClientMock.ts
git commit -m "feat(data): supabaseCorpus repository over Postgres (tested vs mock)"
```

---

### Task 5: `supabaseStorage` — PersistStorage over `user_state`

**Files:**
- Create: `src/store/supabaseStorage.ts`
- Test: `src/store/supabaseStorage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/store/supabaseStorage.test.ts`:

```ts
/**
 * supabaseStorage is an async PersistStorage<T> over user_state.value (jsonb).
 * getItem returns the { state, version } envelope object (or null); setItem upserts
 * it; removeItem deletes by key. user_id is server-defaulted from the JWT, so the
 * client only sends { key, value }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeSupabaseMock } from '../test/supabaseClientMock'

let mock: ReturnType<typeof makeSupabaseMock>
vi.mock('../lib/supabaseClient', () => ({ supabase: new Proxy({}, { get: (_t, p) => (mock.client as Record<string | symbol, unknown>)[p] }) }))

import { supabaseStorage } from './supabaseStorage'

beforeEach(() => { mock = makeSupabaseMock({}) })

describe('supabaseStorage', () => {
  it('getItem returns the stored envelope object for the key, or null', async () => {
    mock = makeSupabaseMock({ maybeSingle: [{ value: { state: { a: 1 }, version: 0 } }] })
    const got = await supabaseStorage.getItem('contentos-conversations')
    expect(mock.calls.from).toContain('user_state')
    expect(mock.calls.eq).toContainEqual(['key', 'contentos-conversations'])
    expect(got).toEqual({ state: { a: 1 }, version: 0 })
  })

  it('getItem returns null when there is no row', async () => {
    mock = makeSupabaseMock({ maybeSingle: [null] })
    expect(await supabaseStorage.getItem('missing')).toBeNull()
  })

  it('setItem upserts { key, value } (no user_id — server-defaulted)', async () => {
    await supabaseStorage.setItem('contentos-reels', { state: { x: 2 }, version: 0 })
    expect(mock.calls.upsert[0]).toEqual({ key: 'contentos-reels', value: { state: { x: 2 }, version: 0 } })
  })

  it('removeItem deletes by key', async () => {
    await supabaseStorage.removeItem('contentos-reels')
    expect(mock.calls.delete.length).toBe(1)
    expect(mock.calls.eq).toContainEqual(['key', 'contentos-reels'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/store/supabaseStorage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/store/supabaseStorage.ts`:

```ts
/**
 * Async PersistStorage<T> backed by the private `user_state` table (jsonb value).
 *
 * Replaces safePersistStorage (localStorage) for the conversations + reel stores under
 * cloud-first. Implements Zustand's OBJECT-based PersistStorage (not StateStorage +
 * createJSONStorage): the column is jsonb, so we store/return the { state, version }
 * envelope object directly — no JSON string round-trip.
 *
 * user_id is server-defaulted from the Clerk JWT (auth.jwt()->>'sub'), and RLS scopes
 * every row to the caller — so the adapter only ever sends/filters by `key`.
 */
import type { PersistStorage, StorageValue } from 'zustand/middleware'
import { supabase } from '../lib/supabaseClient'

export function makeSupabaseStorage<T>(): PersistStorage<T> {
  return {
    getItem: async (key) => {
      const { data, error } = await supabase
        .from('user_state')
        .select('value')
        .eq('key', key)
        .maybeSingle()
      if (error || !data) return null
      return (data as { value: StorageValue<T> }).value
    },
    setItem: async (key, value) => {
      const { error } = await supabase
        .from('user_state')
        .upsert({ key, value }, { onConflict: 'user_id,key' })
      if (error) throw error
    },
    removeItem: async (key) => {
      await supabase.from('user_state').delete().eq('key', key)
    },
  }
}

/** Shared singleton — the two private stores both use it (keyed by their persist `name`). */
export const supabaseStorage = makeSupabaseStorage<unknown>()
```

> If the mock lacks `.upsert(payload, opts)` second-arg handling or `.maybeSingle()`,
> extend `makeSupabaseMock` accordingly (it already records `upsert` payload + supports
> `maybeSingle`). Note the test asserts `upsert[0]` equals the payload object; the mock
> records the first arg only — fine.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/store/supabaseStorage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/supabaseStorage.ts src/store/supabaseStorage.test.ts
git commit -m "feat(data): PersistStorage adapter over user_state (jsonb)"
```

---

## Chunk 3: Wiring + lifecycle

### Task 6: Bind corpus + swap store adapters

**Files:**
- Modify: `src/lib/corpusIdb.ts`
- Delete: `src/lib/corpusIdb.test.ts`
- Modify: `src/store/conversationsStore.ts`
- Modify: `src/store/reelAnalysisStore.ts`

- [ ] **Step 1: Repoint the corpus binding**

Replace the entire body of `src/lib/corpusIdb.ts` with:

```ts
/**
 * The corpus the app uses — now Supabase-backed (shared team brain).
 *
 * Filename kept as corpusIdb.ts so the two consumers (corpusStore.ts, MemoryPage.tsx)
 * that `import { corpus } from './corpusIdb'` need no change. The IndexedDB impl was
 * removed in the cloud-first migration; the pure in-memory double in corpus.ts covers
 * tests. createSupabaseCorpus() does no I/O at construction, so binding it at import
 * (before Clerk has a token) is safe.
 */
import { createSupabaseCorpus } from './supabaseCorpus'
import type { CorpusRepository } from './corpus'

export const corpus: CorpusRepository = createSupabaseCorpus()
```

- [ ] **Step 2: Delete the obsolete IDB test**

Run: `git rm src/lib/corpusIdb.test.ts`
Expected: file removed (it tested `createIdbCorpus`, which no longer exists).

- [ ] **Step 3: Swap conversationsStore storage + drop legacy migration**

In `src/store/conversationsStore.ts`:

1. Replace the import `import { safePersistStorage } from './persistStorage'` with
   `import { supabaseStorage } from './supabaseStorage'`.
2. In the persist options object, change `storage: safePersistStorage,` to
   `storage: supabaseStorage,` and add `skipHydration: true,` directly after it.
3. **Remove** the entire `onRehydrateStorage: () => (state) => { … },` property (the
   dead `contentos-chat` localStorage migration). Leave the pure helpers
   (`migrateLegacyChat`, `buildMigratedConversation`) and their tests intact — they're
   still exported/tested; only the runtime hook that read `localStorage` is removed.

The persist options should end up as:

```ts
}), {
  name: 'contentos-conversations',
  storage: supabaseStorage,
  skipHydration: true,
  partialize: (s) => ({ conversations: s.conversations, activeId: s.activeId }),
}))
```

- [ ] **Step 4: Swap reelAnalysisStore storage**

In `src/store/reelAnalysisStore.ts`:

1. Replace `import { safePersistStorage } from './persistStorage'` with
   `import { supabaseStorage } from './supabaseStorage'`.
2. Change `storage: safePersistStorage,` to `storage: supabaseStorage,` and add
   `skipHydration: true,` after it.
3. **KEEP** `partialize` and the `merge` guard (`isCleanReelRun`) exactly as-is.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: green. The only expected fallout is store tests that assumed synchronous
localStorage hydration. If any fail because the store no longer auto-hydrates, fix by
either (a) calling `useX.persist.rehydrate()` in the test, or (b) asserting against the
default state — do NOT remove `skipHydration`. If `persistStorage.ts`/`safePersistStorage`
is now unused anywhere, leave the file (other code/tests may import it); only remove it if
the suite proves it's fully orphaned.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc -b
git add src/lib/corpusIdb.ts src/store/conversationsStore.ts src/store/reelAnalysisStore.ts
git rm src/lib/corpusIdb.test.ts
git commit -m "feat(data): bind corpus to Supabase; swap stores to cloud storage"
```

---

### Task 7: App.tsx lifecycle (wire token, rehydrate, reset)

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the bootstrap component**

In `src/App.tsx`, add imports at the top:

```ts
import { useEffect } from 'react'
import { useAuth } from '@clerk/react'
import { setClerkTokenGetter } from './lib/supabaseClient'
import { useConversationsStore } from './store/conversationsStore'
import { useReelAnalysisStore } from './store/reelAnalysisStore'
import { useCorpusStore } from './store/corpusStore'
```

Add this component (above `ProtectedRoute`):

```tsx
/**
 * Runs inside the signed-in gate. Wires the Clerk token into the Supabase client, then
 * rehydrates the cloud-backed stores + corpus (deferred via skipHydration until a token
 * exists). On sign-out it resets the private stores + the corpus mirror so the next user
 * on a shared machine starts clean.
 */
function AuthedBootstrap() {
  const { getToken, isSignedIn } = useAuth()

  useEffect(() => {
    setClerkTokenGetter(() => getToken())
  }, [getToken])

  useEffect(() => {
    if (isSignedIn) {
      void useConversationsStore.persist.rehydrate()
      void useReelAnalysisStore.persist.rehydrate()
      void useCorpusStore.getState().hydrate().catch(() => {})
    } else {
      useConversationsStore.getState().reset()
      useReelAnalysisStore.getState().reset()
      useCorpusStore.setState({ creators: {}, count: 0, hydrated: false })
    }
  }, [isSignedIn])

  return null
}
```

- [ ] **Step 2: Mount it in the signed-in branch**

In `ProtectedRoute`, render `AuthedBootstrap` alongside the `Outlet`:

```tsx
<Show when="signed-in">
  <AuthedBootstrap />
  <Outlet />
</Show>
```

- [ ] **Step 3: Verify build + typecheck**

Run: `npm run build`
Expected: `tsc -b` clean, Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(data): wire Clerk token + rehydrate cloud stores on sign-in"
```

---

### Task 8: Env + operator docs + final verification

**Files:**
- Modify: `.env.example`
- Modify: `CHANGELOG.md`, `VERSION`, `package.json` (version bump)

- [ ] **Step 1: Document env vars**

Append to `.env.example`:

```bash

# ----- Data sync (Supabase) -----
# Public/safe to expose in the client bundle (RLS protects the data).
# From Supabase dashboard → Project Settings → API.
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   # anon / publishable key
```

- [ ] **Step 2: Bump version + changelog**

Set `VERSION` and `package.json` `version` to `3.4.0.0`. Add a `## [3.4.0.0]` entry to
`CHANGELOG.md` summarizing: corpus + conversations + reels now persist in Supabase
Postgres (shared corpus, private conversations/reels), Clerk-authenticated via RLS,
cloud-first (localStorage/IndexedDB dropped), start-fresh.

- [ ] **Step 3: Full verification**

Run: `npm run build && npm test && npm run lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add .env.example CHANGELOG.md VERSION package.json
git commit -m "docs(data): document Supabase env vars; bump to v3.4.0.0"
```

- [ ] **Step 5: (Operator) Dashboard + Vercel — required before deploy**

1. **Clerk dashboard** → Integrations → enable **Supabase** → save the Clerk domain.
2. **Supabase dashboard** → Authentication → Sign In / Providers → add **Clerk** as a
   third-party provider → paste the Clerk domain.
3. Apply the migration (Task 2 Step 2) if not already done.
4. **Vercel** → contentos2 → Settings → Environment Variables → add
   `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` to **Production + Preview** → redeploy.
5. Smoke test on the deployed URL: sign in, run a search (corpus row appears in Supabase
   Table Editor), start a chat + reload (conversation persists), sign out + back in as a
   different user (private data isolated; corpus shared).

---

## Execution Notes

- **Dependency order:** Task 1 → 2 → 3 → (4, 5) → 6 → 7 → 8. Tasks 4 and 5 both depend on 3 (the mock) but are otherwise independent.
- **Mock/code lock-step:** if a repository/adapter method calls a Supabase chain method the fake doesn't implement, extend `makeSupabaseMock` in the same task. The fake must mirror exactly what the code calls — no more.
- **Never** re-add `safePersistStorage` to the two cloud stores, re-add the `contentos-chat` migration hook, remove the reel `merge` guard, or wire `clear()` to a real delete.
- **Parity watch:** `engagement_rate` sort uses `nulls last`; `sightings[]` is returned oldest→newest; `timesSeen`/`firstSeenAt`/`lastSeenAt` come from the view.
