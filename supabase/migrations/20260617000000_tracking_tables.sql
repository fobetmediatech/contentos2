-- Instagram Account Tracking Dashboard — persistent monitoring tables.
-- Stores tracked accounts + time-series snapshots from two Apify actors.

-- ---------- tracked_accounts ----------
create table if not exists tracked_accounts (
  username              text primary key,
  full_name             text,
  profile_pic_url       text,
  biography             text,
  is_verified           boolean default false,
  is_business           boolean default false,
  added_by              text not null,
  added_at              timestamptz default now(),
  scrape_window_days    int default 30,
  scrape_interval_days  int default 3,
  next_fetch_at         timestamptz default now(),
  last_error            text,
  last_error_at         timestamptz
);

-- ---------- account_snapshots ----------
-- One row per profile scrape run per account (follower count time-series).
-- NOTE: no FK to tracked_accounts. removeTrackedAccount() manages history lifecycle
-- explicitly — "keep data" must leave these rows intact after the parent is deleted,
-- and "delete all" deletes them first. An ON DELETE CASCADE here would silently wipe
-- history on every removal, breaking the "keep data" option.
create table if not exists account_snapshots (
  id                uuid primary key default gen_random_uuid(),
  username          text not null,
  fetched_at        timestamptz default now(),
  followers_count   int,
  posts_count       int,
  follows_count     int,
  raw_payload       jsonb
);

create index if not exists account_snapshots_username_at
  on account_snapshots(username, fetched_at desc);

-- ---------- reel_snapshots ----------
-- One row per reel per scrape run (engagement time-series).
create table if not exists reel_snapshots (
  id                uuid primary key default gen_random_uuid(),
  username          text not null,  -- no FK: history lifecycle managed in removeTrackedAccount()
  fetched_at        timestamptz default now(),
  reel_url          text,
  thumbnail_url     text,
  posted_at         timestamptz,
  views_count       int default 0,
  likes_count       int default 0,
  comments_count    int default 0,
  raw_payload       jsonb
);

create index if not exists reel_snapshots_username_at
  on reel_snapshots(username, fetched_at desc);

-- ---------- RLS ----------
alter table tracked_accounts    enable row level security;
alter table account_snapshots   enable row level security;
alter table reel_snapshots      enable row level security;

-- All authenticated users share read access (team brain).
create policy "auth read tracked_accounts"
  on tracked_accounts for select to authenticated using (true);

create policy "auth read account_snapshots"
  on account_snapshots for select to authenticated using (true);

create policy "auth read reel_snapshots"
  on reel_snapshots for select to authenticated using (true);

-- Mutations gated by Clerk JWT sub.
create policy "auth insert tracked_accounts"
  on tracked_accounts for insert to authenticated
  with check (added_by = (auth.jwt() ->> 'sub'));

create policy "auth update tracked_accounts"
  on tracked_accounts for update to authenticated using (true);

create policy "auth delete tracked_accounts"
  on tracked_accounts for delete to authenticated using (true);

create policy "auth insert account_snapshots"
  on account_snapshots for insert to authenticated with check (true);

create policy "auth delete account_snapshots"
  on account_snapshots for delete to authenticated using (true);

create policy "auth insert reel_snapshots"
  on reel_snapshots for insert to authenticated with check (true);

create policy "auth delete reel_snapshots"
  on reel_snapshots for delete to authenticated using (true);
