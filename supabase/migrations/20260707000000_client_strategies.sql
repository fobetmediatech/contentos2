-- Saved Client Strategies + file attachments (team-shared).
--
-- The Content Strategizing page (StrategyPage) generates a client-ready strategy deck but,
-- until now, only the *last* run was kept in browser localStorage. This migration gives the
-- team a shared, persistent "saved clients" list and lets each saved client carry arbitrary
-- reference files (brand kit, brief PDF, screenshots, …). The files are informational only —
-- they are surfaced when viewing a client and never drive any pipeline.
--
-- Mirrors the existing corpus/calendar RLS conventions: every signed-in team member reads +
-- writes (auth.role() = 'authenticated'); created_by/uploaded_by capture the Clerk user id
-- (auth.jwt()->>'sub') for audit only.
--
-- Run in the Supabase SQL editor (the app's anon key cannot run DDL).

-- ---------- Saved client strategies (team-shared) ----------
-- `result` holds the full StrategyResult (brief + doc + analyzed accounts + hook summaries) as
-- jsonb, so a saved client re-opens and re-prints instantly with no re-analysis. brand_name /
-- offer are denormalized out of the brief purely for a cheap list view.
create table if not exists client_strategies (
  id          uuid primary key default gen_random_uuid(),
  brand_name  text not null,
  offer       text,
  result      jsonb not null,
  created_by  text default (auth.jwt() ->> 'sub'),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists client_strategies_created_idx on client_strategies(created_at desc);

alter table client_strategies enable row level security;

drop policy if exists client_strategies_rw on client_strategies;
create policy client_strategies_rw on client_strategies for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- Attachments (metadata; team-shared) ----------
-- One row per uploaded file. The bytes live in the `client-strategy-files` storage bucket at
-- `storage_path`; this table is the browsable index. Deleting a client cascades its rows here
-- (the app also deletes the underlying storage objects).
create table if not exists client_strategy_attachments (
  id            uuid primary key default gen_random_uuid(),
  strategy_id   uuid not null references client_strategies(id) on delete cascade,
  file_name     text not null,
  storage_path  text not null,          -- path inside the client-strategy-files bucket
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   text default (auth.jwt() ->> 'sub'),
  created_at    timestamptz default now()
);
create index if not exists client_strategy_attachments_strategy_idx
  on client_strategy_attachments(strategy_id);

alter table client_strategy_attachments enable row level security;

drop policy if exists client_strategy_attachments_rw on client_strategy_attachments;
create policy client_strategy_attachments_rw on client_strategy_attachments for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- Storage bucket for the files (private) ----------
-- First Supabase Storage bucket in the app. Private — files are fetched via short-lived signed
-- URLs, never public. Insert is idempotent.
insert into storage.buckets (id, name, public)
values ('client-strategy-files', 'client-strategy-files', false)
on conflict (id) do nothing;

-- Any signed-in team member may read/write objects in this bucket (team-shared, matching the
-- metadata table above). Scoped by bucket_id so other buckets are unaffected.
drop policy if exists client_strategy_files_read on storage.objects;
create policy client_strategy_files_read on storage.objects for select
  using (bucket_id = 'client-strategy-files' and auth.role() = 'authenticated');

drop policy if exists client_strategy_files_insert on storage.objects;
create policy client_strategy_files_insert on storage.objects for insert
  with check (bucket_id = 'client-strategy-files' and auth.role() = 'authenticated');

drop policy if exists client_strategy_files_delete on storage.objects;
create policy client_strategy_files_delete on storage.objects for delete
  using (bucket_id = 'client-strategy-files' and auth.role() = 'authenticated');
