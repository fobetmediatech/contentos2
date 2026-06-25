-- Add an optional human-readable label to member_roles.
--
-- Clerk stores the user's email/name; the database only ever sees the opaque Clerk
-- user_id (auth.jwt()->>'sub'). This label column lets an admin record WHICH person
-- a user_id belongs to, straight in the table — no Clerk-dashboard lookup needed to
-- read the access list.
--
-- Purely descriptive: it is NOT referenced by the app, by is_finance(), or by any RLS
-- policy. Access is still decided solely by (user_id, role). Run in the Supabase SQL
-- editor (the app's anon key cannot run DDL); per-row labels are backfilled there too.

alter table member_roles add column if not exists label text;
