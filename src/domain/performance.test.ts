import { describe, it, expect } from 'vitest'
import {
  taskStatus, taskTiming, timingLabel, formatDuration, summarizeByMember,
  ON_TIME_TOLERANCE_MS, notificationText, unreadCount,
  type PerformanceTask, type PerformanceNotification,
} from './performance'

const HOUR = 3_600_000
const DAY = 86_400_000

const NOW = Date.UTC(2026, 7, 26, 12, 0, 0)

function task(over: Partial<PerformanceTask> = {}): PerformanceTask {
  return {
    id: 'task-1',
    title: 'Edit the launch reel',
    description: null,
    assigneeUserId: 'user_a',
    assigneeLabel: 'Ana',
    assignerUserId: 'user_admin',
    assignerLabel: 'Admin',
    teamId: null,
    dueAt: NOW,
    completedAt: null,
    cancelledAt: null,
    createdAt: NOW - DAY,
    ...over,
  }
}

describe('taskStatus', () => {
  it('is open before the deadline and overdue after it, with nothing written', () => {
    const t = task({ dueAt: NOW + HOUR })
    expect(taskStatus(t, NOW)).toBe('open')
    // Same row, later clock — the status moves on its own.
    expect(taskStatus(t, NOW + 2 * HOUR)).toBe('overdue')
  })

  it('ranks cancelled above completed so a cancelled row never reads as delivered', () => {
    expect(taskStatus(task({ completedAt: NOW, cancelledAt: NOW }), NOW)).toBe('cancelled')
  })
})

describe('taskTiming', () => {
  it('reports early completions as time to spare', () => {
    const t = task({ completedAt: NOW - 3 * HOUR })
    expect(taskTiming(t, NOW)).toEqual({ kind: 'early', deltaMs: 3 * HOUR })
    expect(timingLabel(taskTiming(t, NOW))).toBe('Early by 3h')
  })

  it('reports late completions as delay', () => {
    const t = task({ completedAt: NOW + 2 * DAY + 4 * HOUR })
    expect(taskTiming(t, NOW)).toEqual({ kind: 'late', deltaMs: 2 * DAY + 4 * HOUR })
    expect(timingLabel(taskTiming(t, NOW))).toBe('Delayed by 2d 4h')
  })

  it('treats a completion inside the tolerance as on time, either side of the deadline', () => {
    expect(taskTiming(task({ completedAt: NOW + 1_000 }), NOW).kind).toBe('on-time')
    expect(taskTiming(task({ completedAt: NOW - 1_000 }), NOW).kind).toBe('on-time')
    expect(taskTiming(task({ completedAt: NOW + ON_TIME_TOLERANCE_MS }), NOW).kind).toBe('on-time')
    // One millisecond past the window is late — the boundary is inclusive.
    expect(taskTiming(task({ completedAt: NOW + ON_TIME_TOLERANCE_MS + 1 }), NOW).kind).toBe('late')
  })

  it('zeroes the delta for on-time so the UI never prints "on time by 12s"', () => {
    expect(taskTiming(task({ completedAt: NOW + 1_000 }), NOW).deltaMs).toBe(0)
  })

  it('surfaces an open task that has blown its deadline without waiting for completion', () => {
    const t = task({ dueAt: NOW - 5 * HOUR })
    expect(taskTiming(t, NOW)).toEqual({ kind: 'overdue', deltaMs: 5 * HOUR })
  })

  it('says nothing about an open task that is not due yet', () => {
    expect(taskTiming(task({ dueAt: NOW + DAY }), NOW)).toEqual({ kind: 'pending', deltaMs: 0 })
  })

  it('never judges a cancelled task, however late it looks', () => {
    const t = task({ dueAt: NOW - 10 * DAY, cancelledAt: NOW })
    expect(taskTiming(t, NOW)).toEqual({ kind: 'cancelled', deltaMs: 0 })
  })

  it('derives from stored facts only — the same row re-reads identically at any clock', () => {
    const t = task({ completedAt: NOW - 3 * HOUR })
    expect(taskTiming(t, NOW)).toEqual(taskTiming(t, NOW + 400 * DAY))
  })
})

describe('formatDuration', () => {
  it('collapses sub-minute to a marker rather than a misleading 0m', () => {
    expect(formatDuration(0)).toBe('<1m')
    expect(formatDuration(59_000)).toBe('<1m')
  })

  it('caps at two units', () => {
    expect(formatDuration(45 * 60_000)).toBe('45m')
    expect(formatDuration(2 * HOUR + 15 * 60_000)).toBe('2h 15m')
    expect(formatDuration(3 * DAY + 4 * HOUR)).toBe('3d 4h')
  })

  it('drops an empty trailing unit', () => {
    expect(formatDuration(2 * HOUR)).toBe('2h')
    expect(formatDuration(3 * DAY)).toBe('3d')
    // Days present, hours zero, minutes non-zero — minutes must not resurface next to days.
    expect(formatDuration(3 * DAY + 7 * 60_000)).toBe('3d')
  })

  it('never renders a negative duration', () => {
    expect(formatDuration(-5 * HOUR)).toBe('<1m')
  })
})

describe('summarizeByMember', () => {
  const tasks: PerformanceTask[] = [
    task({ id: '1', assigneeUserId: 'u1', assigneeLabel: 'Ana', completedAt: NOW - 2 * HOUR }),
    task({ id: '2', assigneeUserId: 'u1', assigneeLabel: 'Ana', completedAt: NOW + 2 * HOUR }),
    task({ id: '3', assigneeUserId: 'u1', assigneeLabel: 'Ana', completedAt: NOW + 4 * HOUR }),
    task({ id: '4', assigneeUserId: 'u2', assigneeLabel: 'Bo', dueAt: NOW - DAY }),
    task({ id: '5', assigneeUserId: 'u2', assigneeLabel: 'Bo', dueAt: NOW + DAY }),
  ]

  it('counts each outcome per person', () => {
    const [ana, bo] = summarizeByMember(tasks, NOW)

    expect(ana).toMatchObject({ label: 'Ana', assigned: 3, completed: 3, early: 1, late: 2, openOverdue: 0 })
    expect(bo).toMatchObject({ label: 'Bo', assigned: 2, completed: 0, openOverdue: 1 })
  })

  it('averages delay over late completions only, so early work cannot mask lateness', () => {
    const [ana] = summarizeByMember(tasks, NOW)
    // Late by 2h and 4h → 3h. The 2h-early delivery must not net this down.
    expect(ana.averageDelayMs).toBe(3 * HOUR)
  })

  it('leaves average delay null when nothing landed late', () => {
    const [bo] = summarizeByMember(tasks.filter((t) => t.assigneeUserId === 'u2'), NOW)
    expect(bo.averageDelayMs).toBeNull()
  })

  it('excludes cancelled work from the assigned count', () => {
    const withCancelled = [...tasks, task({ id: '6', assigneeUserId: 'u2', cancelledAt: NOW })]
    const bo = summarizeByMember(withCancelled, NOW).find((m) => m.userId === 'u2')
    expect(bo?.assigned).toBe(2)
  })

  it('falls back to the opaque user id when no display label was captured', () => {
    const [row] = summarizeByMember([task({ assigneeUserId: 'u9', assigneeLabel: null })], NOW)
    expect(row.label).toBe('u9')
  })

  it('returns nothing for no tasks rather than an empty placeholder row', () => {
    expect(summarizeByMember([], NOW)).toEqual([])
  })
})

describe('notificationText', () => {
  const base = { id: 'n1', taskId: null, teamId: null, createdAt: NOW, readAt: null }

  it('states what happened and to what, so the inbox reads standalone', () => {
    expect(notificationText({ ...base, kind: 'task_assigned', title: 'Edit the reel' }))
      .toBe('New task assigned: Edit the reel')
    expect(notificationText({ ...base, kind: 'task_reopened', title: 'Edit the reel' }))
      .toBe('Task reopened: Edit the reel')
    expect(notificationText({ ...base, kind: 'team_added', title: 'Editing team' }))
      .toBe('You were added to Editing team')
  })
})

describe('unreadCount', () => {
  const n = (readAt: number | null): PerformanceNotification => ({
    id: Math.random().toString(), kind: 'task_assigned', taskId: null, teamId: null,
    title: 't', createdAt: NOW, readAt,
  })

  it('counts only rows with no read timestamp', () => {
    expect(unreadCount([n(null), n(NOW), n(null)])).toBe(2)
  })

  it('is zero for an empty inbox', () => {
    expect(unreadCount([])).toBe(0)
  })
})
