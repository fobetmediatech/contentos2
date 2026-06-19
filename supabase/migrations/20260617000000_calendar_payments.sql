-- Content Calendar + Payments (internal agency tool).
--
-- Adds four tables to the SAME Supabase project the app already uses. Mirrors the
-- existing corpus RLS conventions (auth.role() = 'authenticated', auth.jwt()->>'sub').
--
--   clients         — the shared client list (Option A: this feature owns it for now;
--                     the future "dashboard" feature will share the SAME table). team-shared.
--   scheduled_posts — the content calendar (plan-only). team-shared.
--   member_roles    — greenfield role assignments (finance is the first role).
--   client_payments — manual payment tracking, FINANCE ROLE ONLY (read + write).
--
-- Clients/calendar are visible to every signed-in team member; payments are invisible
-- to everyone except members with the 'finance' role.

-- ---------- Clients (team-shared) ----------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  handle      text,                  -- Instagram handle (optional)
  name        text not null,
  status      text default 'active', -- active | paused | archived
  notes       text,
  created_by  text default (auth.jwt() ->> 'sub'),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ---------- Scheduled posts (the content calendar; team-shared) ----------
create table if not exists scheduled_posts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete cascade,
  scheduled_for timestamptz not null,         -- store UTC
  content_type  text default 'reel',          -- reel | post | story | carousel
  title         text,
  caption       text,
  hook          text,
  status        text default 'idea',          -- idea | draft | scheduled | posted | skipped
  assignee      text,                          -- Clerk user id (optional)
  notes         text,
  created_by    text default (auth.jwt() ->> 'sub'),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists scheduled_posts_client_idx on scheduled_posts(client_id);
create index if not exists scheduled_posts_date_idx   on scheduled_posts(scheduled_for);

-- ---------- Roles (greenfield; finance is the first role) ----------
create table if not exists member_roles (
  user_id    text not null,   -- Clerk user id (auth.jwt()->>'sub')
  role       text not null,   -- 'finance' | 'admin' | ...
  created_at timestamptz default now(),
  primary key (user_id, role)
);

-- ---------- Payments (FINANCE ROLE ONLY) ----------
create table if not exists client_payments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  amount      numeric not null,
  currency    text default 'INR',
  paid_on     date,
  status      text default 'due',   -- due | paid | overdue
  method      text,
  note        text,
  entered_by  text default (auth.jwt() ->> 'sub'),  -- audit: who logged it
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists client_payments_client_idx on client_payments(client_id);

-- ---------- Role helper ----------
create or replace function is_finance() returns boolean language sql stable as $$
  select exists (
    select 1 from member_roles
    where user_id = auth.jwt() ->> 'sub' and role = 'finance'
  );
$$;

-- ---------- Row-Level Security ----------
alter table clients         enable row level security;
alter table scheduled_posts enable row level security;
alter table member_roles    enable row level security;
alter table client_payments enable row level security;

-- clients + scheduled_posts: any signed-in team member reads + writes
drop policy if exists clients_rw on clients;
create policy clients_rw on clients for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists scheduled_posts_rw on scheduled_posts;
create policy scheduled_posts_rw on scheduled_posts for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- member_roles: any signed-in user can READ (so the app can check roles); no client-side writes
drop policy if exists member_roles_read on member_roles;
create policy member_roles_read on member_roles for select
  using (auth.role() = 'authenticated');
revoke insert, update, delete on member_roles from authenticated, anon;

-- client_payments: FINANCE ONLY — invisible + unwritable to everyone else
drop policy if exists client_payments_finance on client_payments;
create policy client_payments_finance on client_payments for all
  using (is_finance()) with check (is_finance());
