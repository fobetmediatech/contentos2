-- Performance Management, part 2 — the HR role, teams, and the in-app inbox.
--
-- Builds on 20260826000000_performance_tasks.sql. Three additions:
--   1. An `hr` role, mirroring `finance` from 20260624000000_team_access.sql. HR is deliberately
--      NOT the same thing as admin: admins keep superuser reach, but HR is a separate grant so
--      the two can be held by different people. Granting HR does not grant finance or admin.
--   2. Teams — a named group with members, created and staffed by HR (or an admin).
--   3. Notifications — the Performance inbox. Rows are written by DATABASE TRIGGERS, never by the
--      browser, so a notification cannot be missed because some client-side code path forgot to
--      create one. There is no email: notification is in-app only, per decision D-003.
--
-- Run in the Supabase SQL editor (the app's anon key cannot run DDL).

-- ---------- The HR role ----------
-- Mirrors is_finance()/is_admin(). Expiry is honoured the same way: a role row with a past
-- expires_at is inert without anyone having to delete it.
create or replace function is_hr()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from member_roles
    where user_id = auth.jwt() ->> 'sub'
      and role = 'hr'
      and (expires_at is null or expires_at > now())
  );
$$;

revoke all on function is_hr() from public;
grant execute on function is_hr() to anon, authenticated;

-- Grant/revoke HR. role is HARDCODED to 'hr' for the same reason admin_grant_finance hardcodes
-- 'finance': a role parameter would let any admin mint themselves any role, including admin.
create or replace function admin_grant_hr(target_user_id text, target_label text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if target_user_id is null or btrim(target_user_id) = '' then
    raise exception 'target_user_id required' using errcode = '22023';
  end if;
  insert into member_roles (user_id, role, label)
  values (target_user_id, 'hr', target_label)
  on conflict (user_id, role) do update set label = excluded.label;
end;
$$;

create or replace function admin_revoke_hr(target_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from member_roles where user_id = target_user_id and role = 'hr';
end;
$$;

revoke all on function admin_grant_hr(text, text) from public;
revoke all on function admin_revoke_hr(text) from public;
grant execute on function admin_grant_hr(text, text) to anon, authenticated;
grant execute on function admin_revoke_hr(text) to anon, authenticated;

-- ---------- Teams ----------
create table if not exists performance_teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  text not null default (auth.jwt() ->> 'sub'),
  created_at  timestamptz not null default now()
);

alter table performance_teams enable row level security;

-- Any signed-in member may READ team names: an assignee needs to see which team a task came
-- from, and a team name is not sensitive. Only HR/admin may create or change one.
drop policy if exists performance_teams_select on performance_teams;
create policy performance_teams_select on performance_teams for select
  using (auth.role() = 'authenticated');

drop policy if exists performance_teams_write on performance_teams;
create policy performance_teams_write on performance_teams for all
  using (is_admin() or is_hr()) with check (is_admin() or is_hr());

-- ---------- Team membership ----------
-- user_label is a display snapshot captured from Clerk at add time (same rationale as
-- performance_tasks.assignee_label): the list renders without a Clerk round-trip per row, and
-- stays readable after someone leaves. Every policy keys off user_id, never the label.
create table if not exists performance_team_members (
  team_id     uuid not null references performance_teams(id) on delete cascade,
  user_id     text not null,
  user_label  text,
  added_by    text not null default (auth.jwt() ->> 'sub'),
  added_at    timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists performance_team_members_user_idx on performance_team_members(user_id);

alter table performance_team_members enable row level security;

drop policy if exists performance_team_members_select on performance_team_members;
create policy performance_team_members_select on performance_team_members for select
  using (auth.role() = 'authenticated');

drop policy if exists performance_team_members_write on performance_team_members;
create policy performance_team_members_write on performance_team_members for all
  using (is_admin() or is_hr()) with check (is_admin() or is_hr());

-- ---------- Tasks gain a team ----------
-- Nullable on purpose: tasks assigned before teams existed keep working, and a one-off task that
-- belongs to no team stays legal. on delete set null so deleting a team never destroys work history.
alter table performance_tasks
  add column if not exists team_id uuid references performance_teams(id) on delete set null;

create index if not exists performance_tasks_team_idx on performance_tasks(team_id);

-- HR joins admin as an assigner, and gains the same visibility over task records.
drop policy if exists performance_tasks_select on performance_tasks;
create policy performance_tasks_select on performance_tasks for select
  using (is_admin() or is_hr() or assignee_user_id = auth.jwt() ->> 'sub');

drop policy if exists performance_tasks_insert on performance_tasks;
create policy performance_tasks_insert on performance_tasks for insert
  with check ((is_admin() or is_hr()) and assigner_user_id = auth.jwt() ->> 'sub');

drop policy if exists performance_tasks_update on performance_tasks;
create policy performance_tasks_update on performance_tasks for update
  using (is_admin() or is_hr()) with check (is_admin() or is_hr());

drop policy if exists performance_tasks_delete on performance_tasks;
create policy performance_tasks_delete on performance_tasks for delete
  using (is_admin() or is_hr());

-- reopen_task() gated on is_admin() alone in the previous migration; HR must be able to correct
-- a mistaken completion too, or assignment and correction sit with different people.
create or replace function reopen_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_admin() or is_hr()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update performance_tasks
     set completed_at = null,
         updated_at   = now()
   where id = p_task_id;
end;
$$;

-- ---------- Notifications (the Performance inbox) ----------
-- kind is a plain text check rather than an enum: adding a kind later is then a one-line change
-- instead of an ALTER TYPE that locks the table.
create table if not exists performance_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,                        -- recipient's Clerk id
  kind        text not null check (kind in ('task_assigned', 'task_reopened', 'team_added')),
  task_id     uuid references performance_tasks(id) on delete cascade,
  team_id     uuid references performance_teams(id) on delete cascade,
  title       text not null,                        -- snapshot, so the inbox reads standalone
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists performance_notifications_inbox_idx
  on performance_notifications(user_id, read_at, created_at desc);

alter table performance_notifications enable row level security;

-- You see only your own notifications — including admins and HR. An inbox is personal.
drop policy if exists performance_notifications_select on performance_notifications;
create policy performance_notifications_select on performance_notifications for select
  using (user_id = auth.jwt() ->> 'sub');

-- No INSERT policy at all: rows come only from the triggers below (SECURITY DEFINER, so they
-- bypass RLS). A client therefore cannot fabricate a notification for somebody else.
drop policy if exists performance_notifications_update on performance_notifications;
create policy performance_notifications_update on performance_notifications for update
  using (user_id = auth.jwt() ->> 'sub') with check (user_id = auth.jwt() ->> 'sub');

drop policy if exists performance_notifications_delete on performance_notifications;
create policy performance_notifications_delete on performance_notifications for delete
  using (user_id = auth.jwt() ->> 'sub');

-- ---------- Triggers ----------
-- Assignment. Skips self-assignment: telling you about the task you just created is noise.
create or replace function notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignee_user_id is distinct from new.assigner_user_id then
    insert into performance_notifications (user_id, kind, task_id, team_id, title)
    values (new.assignee_user_id, 'task_assigned', new.id, new.team_id, new.title);
  end if;
  return new;
end;
$$;

drop trigger if exists performance_tasks_notify_assigned on performance_tasks;
create trigger performance_tasks_notify_assigned
  after insert on performance_tasks
  for each row execute function notify_task_assigned();

-- Reopening. Fires only on the completed → open transition, so an unrelated edit (a due-date
-- change, a cancellation) does not spam the assignee.
create or replace function notify_task_reopened()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.completed_at is not null and new.completed_at is null then
    insert into performance_notifications (user_id, kind, task_id, team_id, title)
    values (new.assignee_user_id, 'task_reopened', new.id, new.team_id, new.title);
  end if;
  return new;
end;
$$;

drop trigger if exists performance_tasks_notify_reopened on performance_tasks;
create trigger performance_tasks_notify_reopened
  after update on performance_tasks
  for each row execute function notify_task_reopened();

-- Added to a team. Same self-skip: HR adding themselves needs no announcement.
create or replace function notify_team_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_name text;
begin
  if new.user_id is distinct from new.added_by then
    select name into v_team_name from performance_teams where id = new.team_id;
    insert into performance_notifications (user_id, kind, team_id, title)
    values (new.user_id, 'team_added', new.team_id, coalesce(v_team_name, 'a team'));
  end if;
  return new;
end;
$$;

drop trigger if exists performance_team_members_notify_added on performance_team_members;
create trigger performance_team_members_notify_added
  after insert on performance_team_members
  for each row execute function notify_team_added();

-- ---------- Mark read ----------
-- Stamped server-side. Passing null marks the caller's whole inbox read; the where clause is
-- scoped to the caller either way, so this can never touch someone else's rows.
create or replace function mark_notifications_read(p_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := auth.jwt() ->> 'sub';
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update performance_notifications
     set read_at = now()
   where user_id = v_caller
     and read_at is null
     and (p_ids is null or id = any(p_ids));
end;
$$;

revoke all on function mark_notifications_read(uuid[]) from public;
grant execute on function mark_notifications_read(uuid[]) to anon, authenticated;
