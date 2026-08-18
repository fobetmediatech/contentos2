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
