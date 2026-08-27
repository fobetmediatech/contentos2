-- Performance Management, part 3 — least privilege for ordinary members.
--
-- Corrects a decision from 20260826000001. That migration let ANY signed-in user read
-- performance_teams and performance_team_members, on the reasoning that a team name is not
-- sensitive. It is: the roster tables together describe who reports into what, for the whole
-- organisation, and they were readable straight from the API regardless of what the UI showed.
--
-- After this migration an ordinary member can see exactly three things:
--   * tasks assigned to them          (performance_tasks_select — already correct, untouched)
--   * their own performance totals    (derived from those same task rows, so also already correct)
--   * their own notifications         (performance_notifications_select — already correct)
--
-- and nothing whatsoever about teams. Hiding the Teams tab in React is cosmetic; this is the
-- boundary. Both must agree, and this is the half that enforces.
--
-- Run in the Supabase SQL editor (the app's anon key cannot run DDL).

-- ---------- Teams are HR/admin only ----------
drop policy if exists performance_teams_select on performance_teams;
create policy performance_teams_select on performance_teams for select
  using (is_admin() or is_hr());

drop policy if exists performance_team_members_select on performance_team_members;
create policy performance_team_members_select on performance_team_members for select
  using (is_admin() or is_hr());

-- The write policies from 20260826000001 already require (is_admin() or is_hr()) and are
-- deliberately left alone; only reads were too broad.

-- ---------- Note on what is NOT changed ----------
-- performance_tasks_select stays `is_admin() or is_hr() or assignee_user_id = caller`.
-- A member keeps seeing their own tasks — including a task's team_id — but since they can no
-- longer read performance_teams, that id resolves to nothing for them. The task records UI shows
-- no team column, so there is nothing to break; the id is simply opaque to them, as intended.
--
-- performance_notifications_select stays `user_id = caller`. A 'team_added' notification still
-- names the team the member was just added to. That is a fact about them, delivered once, not a
-- window into the org chart — they still cannot enumerate teams or read any roster.
