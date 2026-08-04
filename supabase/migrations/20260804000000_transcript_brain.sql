-- Transcript Intelligence Layer — Phase 1 (schema only).
--
-- Adds a client-identity spine + transcript storage + per-field extractions, so an onboarding-call
-- transcript can PRE-FILL the existing Content Strategizing form (StrategyPage / StrategyBrief)
-- with a citation behind every value. A human reviews, corrects, and presses Generate.
--
-- ARCHITECTURAL BOUNDARY: this sits entirely UPSTREAM of the 4-stage generation pipeline
-- (useContentStrategy.ts). Nothing here feeds it automatically. Extraction fills the form;
-- a human presses Generate. There is deliberately no path from these tables into a pipeline run.
--
-- NOT TOUCHED: `client_strategies` and `client_strategy_attachments` are unchanged — no new
-- columns, no altered policies. Attachments stay inert (stored + signed-URL served, never parsed)
-- by explicit decision. A separate `cb_documents` table will carry ingestible documents IF/WHEN
-- that path is actually built; it is intentionally NOT created here (nothing reads it yet).
--
-- Naming: `cb_` prefix ("client brain") keeps this feature's tables visibly separate.
--
-- Run in the Supabase SQL editor (the app's anon key cannot run DDL).

-- pgvector: confirmed available on this project at 0.8.0, not yet enabled.
create extension if not exists vector;

-- ============================================================================
-- CLIENT IDENTITY
-- ============================================================================
-- `client_strategies` has NO client identity — its `id` identifies a strategy RUN, and rows are
-- joined only by free-text brand_name. Two decks for the same client are already two unrelated
-- rows. cb_clients is therefore the FIRST client entity, not a competing second one.

create table if not exists cb_clients (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_by   text default (auth.jwt() ->> 'sub'),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Client emails (the transcript join key) ----------
-- Multiple emails per client on purpose: the person on the sales call is often NOT the person on
-- the onboarding call invite.
create table if not exists cb_client_emails (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references cb_clients(id) on delete cascade,
  email      text not null,
  created_at timestamptz default now()
);

-- CONSTRAINT (enforced in the DB, not the app): normalised email uniqueness.
-- Case/whitespace variation is a common source of duplicate client records, and a duplicate here
-- means a transcript can match two clients. Globally unique — one address maps to exactly one
-- client, which is what makes the join deterministic.
create unique index if not exists cb_client_emails_normalised_uidx
  on cb_client_emails (lower(btrim(email)));

create index if not exists cb_client_emails_client_idx on cb_client_emails(client_id);

-- ---------- Link: client → existing saved strategies ----------
-- A link table rather than a column on client_strategies (that table is not modified).
-- strategy_id is UNIQUE: one strategy belongs to at most one client. Without this, a strategy
-- could be linked to two clients and the two records would drift apart silently — the exact
-- failure mode this design exists to prevent.
create table if not exists cb_client_strategies (
  client_id   uuid not null references cb_clients(id) on delete cascade,
  strategy_id uuid not null unique references client_strategies(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (client_id, strategy_id)
);

-- ============================================================================
-- TRANSCRIPTS
-- ============================================================================

create table if not exists cb_transcripts (
  id            uuid primary key default gen_random_uuid(),

  -- Nullable ON PURPOSE: an unmatched transcript must still land and be visible in a review
  -- queue. A transcript with nowhere to go is a visible problem; a mis-matched one is invisible.
  client_id     uuid references cb_clients(id) on delete set null,

  source        text not null check (source in ('fireflies', 'whisper', 'manual')),
  external_id   text not null,
  meeting_type  text not null check (meeting_type in ('sales', 'onboarding', 'strategy', 'review')),
  meeting_date  timestamptz,
  duration_sec  integer,
  participants  jsonb not null default '[]'::jsonb,
  full_text     text,

  join_status   text not null default 'pending'
                check (join_status in ('pending', 'matched', 'ambiguous', 'unmatched')),

  -- Reserved for future per-owner/team scoping so it can be added WITHOUT a migration.
  -- Unused today — access is currently gated by is_admin() in the policies below.
  owner_user_id text,

  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),

  -- A transcript cannot claim to be matched while pointing at no client. Without this,
  -- join_status is a comment rather than a guarantee.
  constraint cb_transcripts_matched_needs_client
    check (join_status <> 'matched' or client_id is not null)
);

-- IDEMPOTENCY: re-running ingest on the same external id UPDATES rather than duplicating.
-- This unique index is what makes an upsert (on conflict do update) possible.
create unique index if not exists cb_transcripts_source_external_uidx
  on cb_transcripts (source, external_id);

create index if not exists cb_transcripts_client_idx on cb_transcripts(client_id);

-- Partial index: the review queue only ever looks for transcripts that did NOT cleanly match.
create index if not exists cb_transcripts_review_queue_idx
  on cb_transcripts(join_status) where join_status <> 'matched';

-- Metadata-filter path for QnA ("what happened in the Oct 12 onboarding call").
create index if not exists cb_transcripts_client_type_date_idx
  on cb_transcripts(client_id, meeting_type, meeting_date desc);

-- ---------- Chunks ----------
create table if not exists cb_transcript_chunks (
  id             uuid primary key default gen_random_uuid(),
  transcript_id  uuid not null references cb_transcripts(id) on delete cascade,
  chunk_index    integer not null,
  text           text not null,
  speaker        text,

  -- start_sec is what makes a citation CLICKABLE (jump to the moment in the recording).
  -- Nullable only because a 'manual' transcript may have no timing at all; a default of 0 would
  -- be a lie. Timed sources must populate it.
  start_sec      numeric(10, 2),
  end_sec        numeric(10, 2),

  -- gemini-embedding-2 @ output_dimensionality 768 (auto-normalises truncated dims).
  -- 768 also keeps a plain HNSW index viable: pgvector's hnsw/ivfflat cap out at 2000 dims for
  -- the `vector` type, so 3072 would force halfvec.
  embedding      vector(768),
  embedding_model text,

  created_at     timestamptz default now(),

  -- A vector of unknown provenance is unusable after a model switch — this turns "which of these
  -- are stale?" from an archaeology problem into a WHERE clause.
  constraint cb_transcript_chunks_embedding_needs_model
    check (embedding is null or embedding_model is not null)
);

-- Idempotent re-chunking: same transcript + same index overwrites rather than duplicates.
create unique index if not exists cb_transcript_chunks_transcript_index_uidx
  on cb_transcript_chunks (transcript_id, chunk_index);

create index if not exists cb_transcript_chunks_transcript_idx
  on cb_transcript_chunks(transcript_id);

-- Semantic search. Cosine matches normalised embeddings (which gemini-embedding-2 gives us).
create index if not exists cb_transcript_chunks_embedding_idx
  on cb_transcript_chunks using hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- EXTRACTIONS
-- ============================================================================
-- One row per FORM FIELD per client. Field names mirror StrategyBrief exactly.
--
-- competitors/aspirational are FIXED-LENGTH POSITIONAL arrays in the form (5 and 4), so they get
-- NINE separate rows rather than two JSON blobs: competitor 1 may be sheet-sourced while
-- competitor 3 is someone's own research, and per-item citation/confidence/review status cannot
-- be expressed inside a single blob.
--
-- `theme` is deliberately absent — it is presentation-only, not an extraction target.

-- Citation shape validator. A CHECK constraint cannot contain a subquery, so this IMMUTABLE
-- helper wraps it. It only inspects its own argument, so it is genuinely immutable.
create or replace function cb_citations_valid(citations jsonb) returns boolean
  language sql immutable
  set search_path = pg_catalog, public
as $$
  select jsonb_typeof(citations) = 'array'
     and jsonb_array_length(citations) >= 1
     and not exists (
       select 1
       from jsonb_array_elements(citations) as c
       where (c ->> 'chunk_id') is null
          or btrim(coalesce(c ->> 'quote', '')) = ''
     );
$$;

create table if not exists cb_extractions (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references cb_clients(id) on delete cascade,

  field_name  text not null check (field_name in (
    -- Section A
    'brandName', 'primaryNiche', 'subNiche', 'offer', 'language',
    -- Section B
    'audience',
    -- Section C — positional, one row per slot
    'competitors.0', 'competitors.1', 'competitors.2', 'competitors.3', 'competitors.4',
    'aspirational.0', 'aspirational.1', 'aspirational.2', 'aspirational.3',
    -- Section D
    'brandColors', 'dislikes', 'offLimits'
  )),

  value       text,

  -- ARRAY of {chunk_id, quote, start_sec}. Multi-source is the GENERAL case, not the exception:
  -- `audience` (age + income + pain + desire in one free-text field) is typically assembled from
  -- several moments across a 60-minute call. A single chunk reference would force the model to
  -- either misrepresent the rest or return null.
  citations   jsonb not null default '[]'::jsonb,

  provenance  text not null check (provenance in ('extracted', 'inferred', 'sheet', 'scraped')),

  confidence  numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  review_status text not null default 'pending'
                check (review_status in ('pending', 'approved', 'edited', 'rejected')),

  -- Retained when a human edits, so the review UI can show original vs corrected.
  original_value text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  model_version  text,

  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),

  -- CONSTRAINT (enforced in the DB, not the app): a claim about what a client SAID, with nothing
  -- behind it, cannot be stored. Every citation in the array must carry both a chunk id and a
  -- non-empty verbatim quote.
  constraint cb_extractions_extracted_needs_citation
    check (
      provenance <> 'extracted'
      or value is null
      or cb_citations_valid(citations)
    ),

  -- 'inferred' is our judgment, not the client's words — it always needs a confidence score and
  -- human sign-off.
  constraint cb_extractions_inferred_needs_confidence
    check (provenance <> 'inferred' or value is null or confidence is not null),

  -- Handles come from the sales sheet. The model may READ them, never WRITE them — so a handle
  -- can never carry a model-authored provenance. This makes "the model doesn't invent handles"
  -- structural rather than a prompt instruction.
  constraint cb_extractions_handles_never_model_written
    check (
      (field_name not like 'competitors.%' and field_name not like 'aspirational.%')
      or provenance in ('sheet', 'scraped')
    )
);

-- One extraction per field per client (an extraction run upserts on this).
create unique index if not exists cb_extractions_client_field_uidx
  on cb_extractions (client_id, field_name);

create index if not exists cb_extractions_review_idx
  on cb_extractions(client_id, review_status);

-- ============================================================================
-- ROW LEVEL SECURITY — admin-only, deliberately restrictive
-- ============================================================================
-- Every OTHER table in this database uses `auth.role() = 'authenticated'`, i.e. any signed-in team
-- member reads and writes everything. That default is wrong for this data: transcripts carry client
-- revenue lines, margins, ticket sizes and closed-deal detail — a different confidentiality class
-- from reel scripts.
--
-- These tables therefore ship CLOSED (is_admin() only) and get widened deliberately later.
-- Widening a closed policy is a one-line change; retrofitting scoping onto data that has been
-- open for months means auditing who read what, which is impossible without an audit trail.
--
-- NOTE: `service_role` bypasses RLS, so server-side ingestion (Phase 2) is unaffected by this.

alter table cb_clients            enable row level security;
alter table cb_client_emails      enable row level security;
alter table cb_client_strategies  enable row level security;
alter table cb_transcripts        enable row level security;
alter table cb_transcript_chunks  enable row level security;
alter table cb_extractions        enable row level security;

drop policy if exists cb_clients_admin on cb_clients;
create policy cb_clients_admin on cb_clients for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists cb_client_emails_admin on cb_client_emails;
create policy cb_client_emails_admin on cb_client_emails for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists cb_client_strategies_admin on cb_client_strategies;
create policy cb_client_strategies_admin on cb_client_strategies for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists cb_transcripts_admin on cb_transcripts;
create policy cb_transcripts_admin on cb_transcripts for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists cb_transcript_chunks_admin on cb_transcript_chunks;
create policy cb_transcript_chunks_admin on cb_transcript_chunks for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists cb_extractions_admin on cb_extractions;
create policy cb_extractions_admin on cb_extractions for all to authenticated
  using (is_admin()) with check (is_admin());
