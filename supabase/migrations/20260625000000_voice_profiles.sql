-- Voice profiles: reusable client tone profiles for the Repurpose Reel pipeline.
--
-- A voice profile is a client-identity asset (vocabulary, cadence, hook habits, tone),
-- NOT creator-analyzed content — so it gets its own table rather than reusing corpus_content
-- (whose `kind` discriminant is the frozen 'reel' value with a non-null creator FK).
--
-- RLS mirrors the corpus team-brain model (20260612000000_corpus_ownership.sql):
--   SELECT  — any authenticated user (team-wide reuse).
--   INSERT  — any authenticated user, stamping their own Clerk sub as owner_user_id.
--   UPDATE  — any authenticated user (locked decision: any teammate can edit/rebuild).
-- owner_user_id is retained as provenance (last writer), not as an edit gate.
-- No DELETE policy: profiles are rebuilt, never deleted.

create table if not exists corpus_voice_profiles (
  handle         text        primary key,          -- @handle, or __scripts__<hash> for pasted-script profiles
  owner_user_id  text        not null,             -- Clerk sub of the last writer (auth.jwt()->>'sub')
  display_name   text,
  voice_data     jsonb       not null,             -- the full VoiceProfile object
  reel_count     int         not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists corpus_voice_profiles_owner_idx on corpus_voice_profiles (owner_user_id);

alter table corpus_voice_profiles enable row level security;

create policy corpus_voice_profiles_select on corpus_voice_profiles for select
  using (auth.role() = 'authenticated');

create policy corpus_voice_profiles_insert on corpus_voice_profiles for insert
  with check (auth.role() = 'authenticated' and owner_user_id = auth.jwt()->>'sub');

create policy corpus_voice_profiles_update on corpus_voice_profiles for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

revoke delete on corpus_voice_profiles from authenticated, anon;
