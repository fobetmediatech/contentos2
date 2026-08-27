/**
 * TaskTimingBadge — how a task landed against its deadline, in one chip.
 *
 * Colour carries the same meaning as everywhere else in the app: sage for good, saffron-warning
 * for slipping, error-red for missed. The text always states the outcome too, so the badge never
 * relies on colour alone to be readable.
 */
import type { TaskTiming } from '../../domain/performance'
import { timingLabel } from '../../domain/performance'

const TONE: Record<TaskTiming['kind'], { bg: string; fg: string }> = {
  early:     { bg: 'var(--color-success-subtle)', fg: 'var(--color-success)' },
  'on-time': { bg: 'var(--color-success-subtle)', fg: 'var(--color-success)' },
  late:      { bg: 'var(--color-error-subtle)',   fg: 'var(--color-error)' },
  overdue:   { bg: 'var(--color-warning-bg)',     fg: 'var(--color-warning-text)' },
  pending:   { bg: 'rgba(var(--border-rgb),0.08)', fg: 'var(--color-text-muted)' },
  cancelled: { bg: 'rgba(var(--border-rgb),0.08)', fg: 'var(--color-text-muted)' },
}

export function TaskTimingBadge({ timing }: { timing: TaskTiming }) {
  const tone = TONE[timing.kind]
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      {timingLabel(timing)}
    </span>
  )
}
