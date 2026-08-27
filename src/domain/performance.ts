/**
 * Domain types + timing derivation for Performance Management (task assignment).
 *
 * The database stores only raw facts — due_at, completed_at, cancelled_at. Everything a user
 * reads as a judgement ("delayed by 2d 4h", "early by 3h") is derived here, at read time, from
 * those facts. Nothing derived is ever written back.
 *
 * That split is deliberate: if the definition of lateness later grows a grace period, working
 * hours, or approved extensions, only this file changes and every historical row re-derives
 * correctly. A stored `is_late` column would have frozen today's rule into old records.
 *
 * CamelCase here; the Supabase columns are snake_case — performanceRepo.ts maps between them.
 */

/** A person who can be assigned work. Resolved from Clerk (see performanceRepo.listMembers). */
export interface PerformanceMember {
  userId: string            // Clerk user id — the only authoritative identity
  label: string             // display name, falling back to email
  email: string | null
}

/** One assigned task. Timestamps are epoch ms; the DB holds timestamptz (UTC). */
export interface PerformanceTask {
  id: string
  title: string
  description: string | null
  assigneeUserId: string
  assigneeLabel: string | null
  assignerUserId: string
  assignerLabel: string | null
  /** Team the task was assigned within. Null for one-off tasks and anything predating teams. */
  teamId: string | null
  dueAt: number
  completedAt: number | null
  cancelledAt: number | null
  createdAt: number
}

/** What an admin supplies when assigning. The server owns every other field. */
export interface PerformanceTaskInput {
  title: string
  description: string | null
  assigneeUserId: string
  assigneeLabel: string | null
  teamId: string | null
  dueAt: number
}

/**
 * Lifecycle state, derived rather than stored.
 *
 * `overdue` is a live reading of an open task against the clock, so the same row becomes overdue
 * without anything writing to it. Storing a status column would have needed a cron to stay true.
 */
export type TaskStatus = 'cancelled' | 'completed' | 'overdue' | 'open'

/** How a finished task landed against its deadline, or how an open one is tracking. */
export type TaskTimingKind = 'early' | 'on-time' | 'late' | 'pending' | 'overdue' | 'cancelled'

export interface TaskTiming {
  kind: TaskTimingKind
  /**
   * Absolute distance from the deadline in ms — always positive.
   * early → time to spare · late/overdue → time past due · on-time/pending/cancelled → 0.
   */
  deltaMs: number
}

/**
 * On-time window. A completion inside this much of the deadline reads as "on time" rather than
 * "late by 4 seconds", which is technically true and practically absurd.
 *
 * One minute is a presentation tolerance, NOT a grace period — the raw timestamps are untouched,
 * so introducing a real business grace period later is a separate, deliberate decision.
 */
export const ON_TIME_TOLERANCE_MS = 60_000

export function taskStatus(task: PerformanceTask, now: number): TaskStatus {
  if (task.cancelledAt !== null) return 'cancelled'
  if (task.completedAt !== null) return 'completed'
  return now > task.dueAt ? 'overdue' : 'open'
}

/**
 * Derive how a task sits against its deadline.
 *
 * `now` is injected rather than read from the clock so the result is a pure function of its
 * inputs — the whole reason this logic is testable without freezing time.
 */
export function taskTiming(task: PerformanceTask, now: number): TaskTiming {
  if (task.cancelledAt !== null) return { kind: 'cancelled', deltaMs: 0 }

  if (task.completedAt !== null) {
    const delta = task.completedAt - task.dueAt
    if (Math.abs(delta) <= ON_TIME_TOLERANCE_MS) return { kind: 'on-time', deltaMs: 0 }
    return delta < 0
      ? { kind: 'early', deltaMs: -delta }
      : { kind: 'late', deltaMs: delta }
  }

  // Still open: report how far past due it already is, or nothing if it is not due yet.
  const overdueBy = now - task.dueAt
  return overdueBy > ON_TIME_TOLERANCE_MS
    ? { kind: 'overdue', deltaMs: overdueBy }
    : { kind: 'pending', deltaMs: 0 }
}

/**
 * Human duration, coarse on purpose: "3d 4h", "2h 15m", "45m", "<1m".
 *
 * Two units maximum. "2d 4h 13m 6s" is not a thing anyone reads — the extra precision reads as
 * noise and makes columns ragged.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return '<1m'

  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

/** The timing phrase shown in the UI — "Early by 3h", "Delayed by 2d 4h", "On time". */
export function timingLabel(timing: TaskTiming): string {
  switch (timing.kind) {
    case 'early':     return `Early by ${formatDuration(timing.deltaMs)}`
    case 'late':      return `Delayed by ${formatDuration(timing.deltaMs)}`
    case 'overdue':   return `Overdue by ${formatDuration(timing.deltaMs)}`
    case 'on-time':   return 'On time'
    case 'cancelled': return 'Cancelled'
    case 'pending':   return 'Not due yet'
  }
}

/** Per-person rollup for the Employee performance section. Counts only — no marks, no scoring. */
export interface MemberPerformance {
  userId: string
  label: string
  assigned: number
  completed: number
  early: number
  onTime: number
  late: number
  openOverdue: number
  /** Mean lateness across LATE completions only, in ms. Null when nothing landed late. */
  averageDelayMs: number | null
}

/**
 * Roll tasks up per assignee.
 *
 * Averages lateness over late completions only. Folding early and on-time deliveries into the
 * mean would net them off and report a team that is chronically late as "average delay: 0".
 */
export function summarizeByMember(tasks: PerformanceTask[], now: number): MemberPerformance[] {
  const byMember = new Map<string, MemberPerformance>()
  const lateTotals = new Map<string, number>()

  for (const task of tasks) {
    const key = task.assigneeUserId
    let row = byMember.get(key)
    if (!row) {
      row = {
        userId: key,
        label: task.assigneeLabel ?? key,
        assigned: 0, completed: 0, early: 0, onTime: 0, late: 0, openOverdue: 0,
        averageDelayMs: null,
      }
      byMember.set(key, row)
      lateTotals.set(key, 0)
    }

    const status = taskStatus(task, now)
    if (status === 'cancelled') continue    // cancelled work is not held against anyone
    row.assigned += 1

    const timing = taskTiming(task, now)
    switch (timing.kind) {
      case 'early':   row.completed += 1; row.early += 1; break
      case 'on-time': row.completed += 1; row.onTime += 1; break
      case 'late':
        row.completed += 1
        row.late += 1
        lateTotals.set(key, (lateTotals.get(key) ?? 0) + timing.deltaMs)
        break
      case 'overdue': row.openOverdue += 1; break
      default: break                        // pending — assigned, nothing else to say yet
    }
  }

  for (const row of byMember.values()) {
    if (row.late > 0) row.averageDelayMs = Math.round((lateTotals.get(row.userId) ?? 0) / row.late)
  }

  return [...byMember.values()].sort((a, b) => b.assigned - a.assigned || a.label.localeCompare(b.label))
}

// ─────────────────────────────────────────────────────────────────────────────
// Teams + inbox (migration 20260826000001)
// ─────────────────────────────────────────────────────────────────────────────

/** A named group of people. Created and staffed by HR (or an admin). */
export interface PerformanceTeam {
  id: string
  name: string
  createdAt: number
}

/** One person's membership of one team. */
export interface TeamMember {
  teamId: string
  userId: string
  label: string | null
  addedAt: number
}

export type NotificationKind = 'task_assigned' | 'task_reopened' | 'team_added'

/**
 * One inbox entry. `title` is a snapshot taken when the row was written, so the inbox stays
 * readable even if the task is later renamed or the team deleted — a notification is a record of
 * what you were told at the time, not a live view.
 */
export interface PerformanceNotification {
  id: string
  kind: NotificationKind
  taskId: string | null
  teamId: string | null
  title: string
  createdAt: number
  readAt: number | null
}

/** The inbox line for a notification. Kept here so the wording is testable, not buried in JSX. */
export function notificationText(n: PerformanceNotification): string {
  switch (n.kind) {
    case 'task_assigned': return `New task assigned: ${n.title}`
    case 'task_reopened': return `Task reopened: ${n.title}`
    case 'team_added':    return `You were added to ${n.title}`
  }
}

export function unreadCount(notifications: PerformanceNotification[]): number {
  return notifications.filter((n) => n.readAt === null).length
}
