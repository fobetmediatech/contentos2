/**
 * Supabase data access for Performance Management (task assignment + completion).
 *
 * Reads and inserts go straight to Supabase with the Clerk JWT — RLS is the real access control
 * (admins see every task; everyone else sees only their own). See
 * supabase/migrations/20260826000000_performance_tasks.sql.
 *
 * Two writes deliberately do NOT go through the table:
 *   - completeTask  → complete_task() RPC. The assignee has no UPDATE policy, so this is the only
 *                     path that can set completed_at, and the timestamp is server-generated.
 *                     A browser cannot forge when it finished, or quietly move its own deadline.
 *   - reopenTask    → reopen_task() RPC (admin self-check inside).
 *
 * The member list comes from /api/team-access (action: list-users) because enumerating Clerk
 * users needs the secret key. Maps snake_case rows ↔ camelCase domain types.
 */
import { supabase } from './supabaseClient'
import { getClerkSessionToken } from './clerkToken'
import type {
  PerformanceMember, PerformanceTask, PerformanceTaskInput,
  PerformanceTeam, TeamMember, PerformanceNotification, NotificationKind,
} from '../domain/performance'

const ms = (t: string | null): number => (t ? new Date(t).getTime() : 0)
const msOrNull = (t: string | null): number | null => (t ? new Date(t).getTime() : null)

function rowToTask(r: Record<string, unknown>): PerformanceTask {
  return {
    id: r.id as string,
    title: (r.title as string) ?? '',
    description: (r.description as string | null) ?? null,
    assigneeUserId: (r.assignee_user_id as string) ?? '',
    assigneeLabel: (r.assignee_label as string | null) ?? null,
    assignerUserId: (r.assigner_user_id as string) ?? '',
    assignerLabel: (r.assigner_label as string | null) ?? null,
    teamId: (r.team_id as string | null) ?? null,
    dueAt: ms(r.due_at as string | null),
    completedAt: msOrNull(r.completed_at as string | null),
    cancelledAt: msOrNull(r.cancelled_at as string | null),
    createdAt: ms(r.created_at as string | null),
  }
}

/**
 * Every task the caller may see. RLS decides the scope, not this query — an admin gets the
 * whole table and an assignee gets their own rows from the identical call.
 */
export async function listTasks(): Promise<PerformanceTask[]> {
  const { data, error } = await supabase
    .from('performance_tasks')
    .select('id, title, description, assignee_user_id, assignee_label, assigner_user_id, assigner_label, team_id, due_at, completed_at, cancelled_at, created_at')
    .order('due_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => rowToTask(r as Record<string, unknown>))
}

/**
 * Assign a task. Admin-only — enforced by the insert policy, not by hiding the form.
 *
 * assigner_user_id is left to its column default (the caller's Clerk id) so the browser never
 * names the assigner; the insert policy rejects any row claiming somebody else.
 */
export async function createTask(input: PerformanceTaskInput): Promise<PerformanceTask> {
  const { data, error } = await supabase
    .from('performance_tasks')
    .insert({
      title: input.title,
      description: input.description,
      assignee_user_id: input.assigneeUserId,
      assignee_label: input.assigneeLabel,
      team_id: input.teamId,
      due_at: new Date(input.dueAt).toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return rowToTask(data as Record<string, unknown>)
}

/** The assignee's "mark done". completed_at is stamped by Postgres, never sent from here. */
export async function completeTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_task', { p_task_id: taskId })
  if (error) throw error
}

/** Admin correction for a mistaken completion — clears completed_at so it can be redone. */
export async function reopenTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_task', { p_task_id: taskId })
  if (error) throw error
}

/**
 * Cancel — the work was called off. The row survives with cancelled_at set, drops out of every
 * count, and reads as "Cancelled". This is the everyday removal: HR or admin, and reversible in
 * the sense that the record of the assignment is never lost.
 *
 * For permanently erasing a junk row, see deleteTask below. The two are deliberately different
 * actions with different permissions.
 */
export async function cancelTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('performance_tasks')
    .update({ cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
}

/**
 * Workspace members for the assignee picker (admin-only server-side).
 *
 * Returns [] rather than throwing when the caller is not an admin: a non-admin has no assign
 * form to populate, so an empty picker is the correct quiet outcome, not an error banner.
 */
export async function listMembers(): Promise<PerformanceMember[]> {
  const token = await getClerkSessionToken()
  const res = await fetch('/api/team-access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: 'list-users' }),
  })
  if (res.status === 403) return []
  if (!res.ok) throw new Error('member_lookup_failed')
  const json = (await res.json()) as { users?: PerformanceMember[] }
  return json.users ?? []
}

// ---------- Teams (HR/admin write; everyone reads) ----------

export async function listTeams(): Promise<PerformanceTeam[]> {
  const { data, error } = await supabase
    .from('performance_teams')
    .select('id, name, created_at')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return { id: row.id as string, name: row.name as string, createdAt: ms(row.created_at as string | null) }
  })
}

export async function createTeam(name: string): Promise<PerformanceTeam> {
  const { data, error } = await supabase
    .from('performance_teams')
    .insert({ name })
    .select('id, name, created_at')
    .single()
  if (error) throw error
  const row = data as Record<string, unknown>
  return { id: row.id as string, name: row.name as string, createdAt: ms(row.created_at as string | null) }
}

/** Deleting a team cascades its membership rows; tasks keep their history with team_id set null. */
export async function deleteTeam(teamId: string): Promise<void> {
  const { error } = await supabase.from('performance_teams').delete().eq('id', teamId)
  if (error) throw error
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('performance_team_members')
    .select('team_id, user_id, user_label, added_at')
    .order('added_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      teamId: row.team_id as string,
      userId: row.user_id as string,
      label: (row.user_label as string | null) ?? null,
      addedAt: ms(row.added_at as string | null),
    }
  })
}

/** Adding a member fires the team_added notification trigger — nothing to send from here. */
export async function addTeamMember(teamId: string, userId: string, label: string | null): Promise<void> {
  const { error } = await supabase
    .from('performance_team_members')
    .insert({ team_id: teamId, user_id: userId, user_label: label })
  if (error) throw error
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('performance_team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)
  if (error) throw error
}

// ---------- Inbox ----------

/**
 * The caller's own notifications. RLS restricts this to user_id = caller for everyone, admins
 * included — an inbox is personal, so there is no "see all" variant of this query.
 */
export async function listNotifications(): Promise<PerformanceNotification[]> {
  const { data, error } = await supabase
    .from('performance_notifications')
    .select('id, kind, task_id, team_id, title, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: row.id as string,
      kind: row.kind as NotificationKind,
      taskId: (row.task_id as string | null) ?? null,
      teamId: (row.team_id as string | null) ?? null,
      title: (row.title as string) ?? '',
      createdAt: ms(row.created_at as string | null),
      readAt: msOrNull(row.read_at as string | null),
    }
  })
}

/** Mark specific notifications read, or the whole inbox when ids is omitted. Stamped server-side. */
export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null })
  if (error) throw error
}

/**
 * Permanently delete a task row. HR or admin, per the delete policy in
 * 20260826000001 (`using (is_admin() or is_hr())`).
 *
 * This erases the row outright: no cancelled_at, no trace the task was ever assigned, and the
 * assignee's totals change accordingly. Prefer cancelTask for work that was called off — that
 * keeps the record and simply stops it counting. Reserve this for genuine junk: a test row, a
 * duplicate, a typo.
 */
export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.from('performance_tasks').delete().eq('id', taskId)
  if (error) throw error
}
