/**
 * All task records — every task the caller may see, with its timing.
 *
 * RLS decides the scope silently: HR and admins get the whole workspace, everyone else gets
 * their own tasks from the identical query. The section is titled "My tasks" for them, so nobody
 * is left wondering why "all records" holds one person's work.
 *
 * "Mark done" appears only on the caller's own open tasks; the completion timestamp is stamped
 * by Postgres inside complete_task(), never sent from here.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUser } from '@clerk/react'
import { ListChecks, Check } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState'
import { listTasks, completeTask } from '../../lib/performanceRepo'
import { taskStatus, taskTiming } from '../../domain/performance'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { useIsHr } from '../../hooks/useIsHr'
import { useNow } from '../../hooks/useNow'
import { TaskTimingBadge } from './TaskTimingBadge'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
})

/** Timestamps are stored UTC and rendered in the reader's own zone — no timezone is assumed. */
function when(ms: number | null): string {
  return ms === null ? '—' : dateFmt.format(new Date(ms))
}

export function TaskRecordsSection() {
  const qc = useQueryClient()
  const { user } = useUser()
  const { isAdmin } = useIsAdmin()
  const { isHr } = useIsHr()
  const canManage = isAdmin || isHr
  const { data: tasks = [], isLoading, error } = useQuery({
    queryKey: ['performance-tasks'],
    queryFn: listTasks,
  })

  const complete = useMutation({
    mutationFn: completeTask,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['performance-tasks'] }),
  })

  // One clock for the whole render, so every row is judged against the same instant.
  const now = useNow()

  if (isLoading) return <p className="text-secondary text-sm py-8">Loading task records…</p>

  if (error) {
    return (
      <p className="text-sm py-8" style={{ color: 'var(--color-error)' }}>
        Could not load task records. If this persists, the performance_tasks migration may not have been run yet.
      </p>
    )
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No task records yet"
        description={canManage
          ? 'Tasks you assign will appear here with their deadline and completion timing.'
          : 'Tasks assigned to you will appear here with their deadline and completion timing.'}
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <caption className="sr-only">
          {canManage ? 'All assigned tasks' : 'Tasks assigned to you'}, with deadline, completion time and timing.
        </caption>
        <thead>
          <tr className="text-left text-muted font-mono text-[11px] uppercase tracking-wider">
            <th scope="col" className="py-2 pr-4 font-medium">Task</th>
            <th scope="col" className="py-2 pr-4 font-medium">Assignee</th>
            <th scope="col" className="py-2 pr-4 font-medium">Due</th>
            <th scope="col" className="py-2 pr-4 font-medium">Completed at</th>
            <th scope="col" className="py-2 pr-4 font-medium">Timing</th>
            <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const status = taskStatus(task, now)
            const mine = task.assigneeUserId === user?.id
            const canComplete = mine && status !== 'completed' && status !== 'cancelled'
            return (
              <tr key={task.id} className="border-t border-[rgba(var(--border-rgb),0.08)] align-top">
                <td className="py-3 pr-4">
                  <span className="text-primary font-medium">{task.title}</span>
                  {task.description && (
                    <span className="block text-muted text-xs mt-0.5 max-w-md">{task.description}</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-secondary whitespace-nowrap">
                  {task.assigneeLabel ?? task.assigneeUserId}
                  {mine && <span className="text-muted text-xs"> (you)</span>}
                </td>
                <td className="py-3 pr-4 text-secondary whitespace-nowrap font-mono text-xs">{when(task.dueAt)}</td>
                <td className="py-3 pr-4 text-secondary whitespace-nowrap font-mono text-xs">{when(task.completedAt)}</td>
                <td className="py-3 pr-4"><TaskTimingBadge timing={taskTiming(task, now)} /></td>
                <td className="py-3 whitespace-nowrap">
                  {canComplete && (
                    <button
                      onClick={() => complete.mutate(task.id)}
                      disabled={complete.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
                    >
                      <Check size={14} aria-hidden="true" /> Mark done
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
