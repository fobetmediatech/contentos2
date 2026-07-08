-- Calendar events: private-by-default with an opt-in "public" flag.
--
-- Previously scheduled_posts was team-shared — one blanket policy let every signed-in member
-- read AND write EVERY event (see 20260617000000_calendar_payments.sql). That is now scoped:
-- an event is visible only to its creator unless it is explicitly marked public, in which case
-- everyone on the platform can see it (but still only the creator can edit/delete it).
--
-- Existing rows keep is_public = false, so they become private to whoever created them.
--
-- Run in the Supabase SQL editor (the app's anon key cannot run DDL).

alter table scheduled_posts add column if not exists is_public boolean not null default false;
-- Partial index — the public-read branch of the SELECT policy only cares about public rows.
create index if not exists scheduled_posts_public_idx on scheduled_posts(is_public) where is_public;

-- Replace the blanket team-wide policy with owner-scoped access + public read.
drop policy if exists scheduled_posts_rw on scheduled_posts;

-- Read: your own events, plus anything explicitly made public.
drop policy if exists scheduled_posts_select on scheduled_posts;
create policy scheduled_posts_select on scheduled_posts for select
  using (created_by = auth.jwt() ->> 'sub' or is_public);

-- Create: only as yourself (created_by defaults to your Clerk sub).
drop policy if exists scheduled_posts_insert on scheduled_posts;
create policy scheduled_posts_insert on scheduled_posts for insert
  with check (created_by = auth.jwt() ->> 'sub');

-- Update / Delete: owner only — public events are read-only to everyone else.
drop policy if exists scheduled_posts_update on scheduled_posts;
create policy scheduled_posts_update on scheduled_posts for update
  using (created_by = auth.jwt() ->> 'sub') with check (created_by = auth.jwt() ->> 'sub');

drop policy if exists scheduled_posts_delete on scheduled_posts;
create policy scheduled_posts_delete on scheduled_posts for delete
  using (created_by = auth.jwt() ->> 'sub');
