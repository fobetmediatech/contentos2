-- Corpus ownership: scope sightings writes + add append-only feedback table.
--
-- Phase 1.3 of the product improvement plan.
--
-- 1. corpus_sightings UPDATE: restrict to the row's creator_id (ownership guard).
--    Any authenticated user can still INSERT (team-brain ingest), but only the
--    user who originally recorded a sighting can UPDATE it. This prevents one
--    team member from overwriting another's sighting data.
--
-- 2. corpus_feedback: new append-only events table capturing save/dismiss verdicts.
--    INSERT-only policy (no UPDATE/DELETE). The feedback field on corpus_creators
--    is kept for backwards-compat but should migrate to this table over time.
--    Enables Phase 4.4's training signal (polarity-aware preference learning).

-- ── 1. Scope corpus_sightings UPDATE to the recording user ───────────────────

drop policy if exists corpus_sightings_update on corpus_sightings;

-- Only the user who created the sighting row may update it.
-- auth.jwt()->>'sub' is the Clerk userId stored in the JWT.
create policy corpus_sightings_update on corpus_sightings for update
  using (
    auth.role() = 'authenticated'
    and (
      -- allow when created_by matches the current user
      created_by = auth.jwt()->>'sub'
      -- or created_by is not yet set (legacy rows: any authenticated user may update)
      or created_by is null
    )
  )
  with check (auth.role() = 'authenticated');

-- ── 2. Append-only corpus_feedback events table ──────────────────────────────

create table if not exists corpus_feedback (
  id          bigserial primary key,
  username    text        not null,
  user_id     text        not null,  -- Clerk userId (auth.jwt()->>'sub')
  polarity    text        not null check (polarity in ('save', 'dismiss')),
  pipeline    text,                  -- 'competitor' | 'discovery' | null
  niche       text,
  created_at  timestamptz not null default now()
);

-- Index for per-user and per-creator lookups (Phase 4.4 preference aggregation).
create index if not exists corpus_feedback_username_idx on corpus_feedback (username);
create index if not exists corpus_feedback_user_id_idx on corpus_feedback (user_id);

-- RLS: authenticate users may INSERT their own feedback; read all (team corpus).
alter table corpus_feedback enable row level security;

create policy corpus_feedback_select on corpus_feedback for select
  using (auth.role() = 'authenticated');

create policy corpus_feedback_insert on corpus_feedback for insert
  with check (
    auth.role() = 'authenticated'
    and user_id = auth.jwt()->>'sub'
  );

-- No UPDATE or DELETE policy: append-only by design.
revoke update, delete on corpus_feedback from authenticated, anon;
