-- Content OS 2.0 — data sync schema. Corpus = shared team brain; user_state = private.
-- Identity columns are snake_case; the app maps to/from camelCase.

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
  created_by          text default (auth.jwt() ->> 'sub')  -- auto-filled: who contributed it
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
drop policy if exists corpus_creators_all on corpus_creators;
create policy corpus_creators_all on corpus_creators for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists corpus_sightings_all on corpus_sightings;
create policy corpus_sightings_all on corpus_sightings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists corpus_content_all on corpus_content;
create policy corpus_content_all on corpus_content for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Private: a user only sees / writes their own rows.
drop policy if exists user_state_rw on user_state;
create policy user_state_rw on user_state for all
  using ((select auth.jwt() ->> 'sub') = user_id)
  with check ((select auth.jwt() ->> 'sub') = user_id);

-- The view runs with the querying user's privileges (security_invoker) so RLS on the
-- base tables still applies through it.
alter view corpus_creators_view set (security_invoker = on);
