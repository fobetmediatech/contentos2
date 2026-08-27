-- Performance Management — task assignment + completion timing.
--
-- Scope note: HR approval, employee records, and marks/scoring are deliberately NOT here.
-- This migration covers exactly one loop: an admin assigns a task with a deadline, the
-- assignee marks it done, and the row preserves the raw timestamps needed to say
-- "completed at X, delayed by Y" or "early by Z".
--
-- Timing is DERIVED, never stored. due_at and completed_at are the only facts; "delayed by"
-- and "early by" are computed at read time in the UI (src/domain/performance.ts). Changing how
-- lateness is presented later can therefore never corrupt the historical record — the reason
-- 05_FUTURE_DATA_MODEL.md insists raw timing facts outlive any formula.
--
-- Access model differs from the open team-shared tables here (calendar, corpus, strategies).
-- Task rows name individuals and their lateness, so they are least-privilege:
--   * admins see and manage everything,
--   * an assignee sees only their own tasks.
-- Assignment rights reuse the existing is_admin() from 20260624000000_team_access.sql. No new
-- role is introduced — HR remains an undecided product concept, not an implemented one.
--
-- Run in the Supabase SQL editor (the app's anon key cannot run DDL).

-- ---------- Tasks ----------
-- assignee_label / assigner_label are display snapshots (name or email captured at assignment
-- time from Clerk). They exist so the records list renders without a Clerk round-trip per row,
-- and so a record stays readable if someone later leaves the workspace. They are descriptive
-- only: every policy below keys off the opaque Clerk user id, never the label.
create table if not exists performance_tasks (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text,

  assignee_user_id  text not null,                          -- Clerk user id (auth.jwt()->>'sub')
  assignee_label    text,                                   -- display snapshot, not authoritative
  assigner_user_id  text not null default (auth.jwt() ->> 'sub'),
  assigner_label    text,

  due_at            timestamptz not null,
  completed_at      timestamptz,                            -- null = still open
  cancelled_at      timestamptz,                            -- null = live; set instead of deleting

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists performance_tasks_assignee_idx on performance_tasks(assignee_user_id);
create index if not exists performance_tasks_due_idx      on performance_tasks(due_at desc);

-- A task cannot be both completed and cancelled.
alter table performance_tasks drop constraint if exists performance_tasks_terminal_state;
alter table performance_tasks add constraint performance_tasks_terminal_state
  check (completed_at is null or cancelled_at is null);

alter table performance_tasks enable row level security;

-- ---------- Policies ----------
-- Read: admins see every task; everyone else sees only tasks assigned to them.
drop policy if exists performance_tasks_select on performance_tasks;
create policy performance_tasks_select on performance_tasks for select
  using (is_admin() or assignee_user_id = auth.jwt() ->> 'sub');

-- Insert: admins only, and the assigner must be the caller. The with-check on assigner_user_id
-- stops an admin from attributing an assignment to somebody else.
drop policy if exists performance_tasks_insert on performance_tasks;
create policy performance_tasks_insert on performance_tasks for insert
  with check (is_admin() and assigner_user_id = auth.jwt() ->> 'sub');

-- Update: admins only. Assignees do NOT get an update policy — they complete a task through
-- complete_task() below, which is the only path that can set completed_at. Without this split an
-- assignee could rewrite due_at (moving their own deadline) or backdate their completion.
drop policy if exists performance_tasks_update on performance_tasks;
create policy performance_tasks_update on performance_tasks for update
  using (is_admin()) with check (is_admin());

drop policy if exists performance_tasks_delete on performance_tasks;
create policy performance_tasks_delete on performance_tasks for delete
  using (is_admin());

-- ---------- complete_task(task_id) ----------
-- The assignee's self-serve "mark done". SECURITY DEFINER because the assignee has no update
-- policy; the self-check inside is therefore the entire access boundary and must stay explicit.
--
-- completed_at is set to now() SERVER-SIDE — the browser never supplies it, so a completion
-- time cannot be forged by editing a request. Idempotent: completing an already-completed task
-- is a no-op rather than a second, later timestamp.
create or replace function complete_task(p_task_id uuid)
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

  update performance_tasks
     set completed_at = now(),
         updated_at   = now()
   where id = p_task_id
     and assignee_user_id = v_caller     -- only your own task
     and completed_at is null            -- idempotent
     and cancelled_at is null;           -- a cancelled task cannot be completed

  if not found then
    -- Deliberately indistinguishable: wrong id, someone else's task, already done, or cancelled.
    -- A precise error here would let a signed-in user probe for task ids they cannot read.
    raise exception 'task not completable' using errcode = '42501';
  end if;
end;
$$;

revoke all on function complete_task(uuid) from public;
grant execute on function complete_task(uuid) to anon, authenticated;

-- ---------- reopen_task(task_id) ----------
-- Admin-only correction path for a mistaken completion. Clears completed_at so the task returns
-- to open; the assignee can then complete it again with a fresh, honest timestamp.
create or replace function reopen_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update performance_tasks
     set completed_at = null,
         updated_at   = now()
   where id = p_task_id;
end;
$$;

revoke all on function reopen_task(uuid) from public;
grant execute on function reopen_task(uuid) to anon, authenticated;
