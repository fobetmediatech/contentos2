/**
 * Employee performance — per-person totals derived from the same task rows.
 *
 * Counts and an average delay only. There is deliberately no score, grade or ranking: the marks
 * formula is an open product decision, and inventing one here would quietly make that decision
 * for everyone. Sorting is by volume assigned, not by "best" — the table states facts and lets
 * the reader judge.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UsersRound } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState'
import { listTasks } from '../../lib/performanceRepo'
import { summarizeByMember, formatDuration } from '../../domain/performance'
import { useNow } from '../../hooks/useNow'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { useIsHr } from '../../hooks/useIsHr'

export function EmployeePerformanceSection() {
  const { isAdmin } = useIsAdmin()
  const { isHr } = useIsHr()
  const canManage = isAdmin || isHr

  const { data: tasks = [], isLoading, error } = useQuery({
    queryKey: ['performance-tasks'],
    queryFn: listTasks,
  })

  const now = useNow()
  const rows = useMemo(() => summarizeByMember(tasks, now), [tasks, now])

  if (isLoading) return <p className="text-secondary text-sm py-8">Loading performance…</p>

  if (error) {
    return (
      <p className="text-sm py-8" style={{ color: 'var(--color-error)' }}>
        Could not load performance records.
      </p>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title="No performance records yet"
        description={canManage
          ? 'Once tasks are assigned and completed, per-person totals appear here.'
          : 'Once you have tasks assigned and completed, your totals appear here.'}
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <caption className="sr-only">
          {canManage ? 'Per-person task totals' : 'Your task totals'}, derived from task records.
        </caption>
        <thead>
          <tr className="text-left text-muted font-mono text-[11px] uppercase tracking-wider">
            <th scope="col" className="py-2 pr-4 font-medium">{canManage ? 'Member' : 'You'}</th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">Assigned</th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">Completed</th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">Early</th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">On time</th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">Delayed</th>
            <th scope="col" className="py-2 pr-4 font-medium text-right">Overdue</th>
            <th scope="col" className="py-2 font-medium text-right">Avg delay</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className="border-t border-[rgba(var(--border-rgb),0.08)]">
              <td className="py-3 pr-4 text-primary font-medium">{r.label}</td>
              <td className="py-3 pr-4 text-secondary text-right font-mono text-xs">{r.assigned}</td>
              <td className="py-3 pr-4 text-secondary text-right font-mono text-xs">{r.completed}</td>
              <td className="py-3 pr-4 text-right font-mono text-xs" style={{ color: 'var(--color-success)' }}>{r.early}</td>
              <td className="py-3 pr-4 text-secondary text-right font-mono text-xs">{r.onTime}</td>
              <td className="py-3 pr-4 text-right font-mono text-xs" style={{ color: r.late > 0 ? 'var(--color-error)' : undefined }}>{r.late}</td>
              <td className="py-3 pr-4 text-right font-mono text-xs" style={{ color: r.openOverdue > 0 ? 'var(--color-warning-text)' : undefined }}>{r.openOverdue}</td>
              <td className="py-3 text-right font-mono text-xs text-secondary">
                {r.averageDelayMs === null ? '—' : formatDuration(r.averageDelayMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted text-xs mt-3">
        Average delay counts late completions only, so early deliveries cannot offset lateness. Cancelled tasks are excluded.
      </p>
    </div>
  )
}
