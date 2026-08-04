-- Transcript Intelligence Layer — Phase 5 (QnA retrieval).
--
-- Adds the similarity-search function. pgvector's `<=>` operator cannot be expressed through
-- PostgREST, so semantic search needs an RPC.
--
-- SECURITY: this function is SECURITY INVOKER (the default — deliberately NOT security definer).
-- It therefore runs as the CALLER, so the admin-only RLS on cb_transcript_chunks and cb_transcripts
-- still applies. A security-definer function here would silently bypass those policies and hand
-- transcript content — margins, ticket sizes, closed-deal detail — to any signed-in team member.
-- If this ever needs to become definer, the policies must be re-implemented inside it first.
--
-- Run in the Supabase SQL editor, or `supabase db push --linked`.

-- ---------- Missing column: transcript title ----------
-- Phase 1 omitted this. The title is what a citation names ("Onboarding Call - Abhijeet") and what
-- meeting_type is inferred from, so retrieval cannot say WHICH meeting an answer came from without
-- it. Caught by dry-running this migration: the search function below selects t.title.
alter table cb_transcripts add column if not exists title text;

-- ---------- Semantic search over chunks ----------
-- p_client_id null  => cross-client search ("which clients mentioned RERA")
-- p_client_id set   => scoped to one client (the common case)
-- p_meeting_type    => optional narrowing ("in the onboarding call")
--
-- Returns cosine SIMILARITY (1 - distance) so callers can threshold on an intuitive 0..1 scale
-- rather than reasoning about distance. The caller uses that threshold to decide whether anything
-- relevant was found at all — answering from a weak match is worse than saying nothing was found.
create or replace function cb_match_chunks(
  query_embedding  vector(768),
  match_count      int  default 12,
  p_client_id      uuid default null,
  p_meeting_type   text default null
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
  -- Order by DISTANCE (not similarity) so the HNSW index is actually used.
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

-- Only signed-in users may call it; RLS inside still restricts what rows come back.
revoke all on function cb_match_chunks(vector, int, uuid, text) from public;
grant execute on function cb_match_chunks(vector, int, uuid, text) to authenticated;
