/**
 * All task records — every task the caller may see, with its timing.
 *
 * RLS decides the scope silently: HR and admins get the whole workspace, everyone else gets
 * their own tasks from the identical query. The section is titled "My tasks" for them, so nobody
 * is left wondering why "all records" holds one person's work.
 *
 * "Mark done" appears only on the caller's own open tasks; the completion timestamp is stamped
 * by Postgres inside complete_task(), never sent from here.
 *
 * Removal is two distinct actions, not one:
 *   Cancel — work called off. Row survives, leaves every count, reads "Cancelled".
 *   Delete — junk row, gone permanently. Confirmed, and named in the confirmation.
 * Both are HR/admin, matching the update and delete policies on performance_tasks. Cancel is the
 * one to reach for by default; delete is for rows that should never have existed.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUser } from '@clerk/react'
import { ListChecks, Check, Ban, Trash2 } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { listTasks, completeTask, cancelTask, deleteTask } from '../../lib/performanceRepo'
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

const iconBtn =
  'inline-flex items-center justify-center w-8 h-8 rounded-md text-muted transition-colors hover:bg-[var(--color-surface-raised)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]'

export function TaskRecordsSection() {
  const qc = useQueryClient()
  const { user } = useUser()
  const { isAdmin } = useIsAdmin()
  const { isHr } = useIsHr()
  const canManage = isAdmin || isHr

  const [confirmCancel, setConfirmCancel] = useState<{ id: string; title: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)

  const { data: tasks = [], isLoading, error } = useQuery({
    queryKey: ['performance-tasks'],
    queryFn: listTasks,
  })

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['performance-tasks'] })
  const complete = useMutation({ mutationFn: completeTask, onSuccess: invalidate })
  const cancel = useMutation({ mutationFn: cancelTask, onSuccess: invalidate })
  const remove = useMutation({ mutationFn: deleteTask, onSuccess: invalidate })

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

  const busy = complete.isPending || cancel.isPending || remove.isPending

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
            const live = status !== 'completed' && status !== 'cancelled'
            return (
              <tr key={task.id} className="border-t border-[rgba(var(--border-rgb),0.08)] align-top">
                <td className="py-3 pr-4">
                  <span className={`font-medium ${status === 'cancelled' ? 'text-muted line-through' : 'text-primary'}`}>
                    {task.title}
                  </span>
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
                  <div className="flex items-center gap-1 justify-end">
                    {mine && live && (
                      <button
                        onClick={() => complete.mutate(task.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
                      >
                        <Check size={14} aria-hidden="true" /> Mark done
                      </button>
                    )}

                    {/* Cancel — HR/admin, only while the task is still live. */}
                    {canManage && live && (
                      <button
                        onClick={() => setConfirmCancel({ id: task.id, title: task.title })}
                        disabled={busy}
                        title="Cancel this task"
                        aria-label={`Cancel task ${task.title}`}
                        className={iconBtn}
                      >
                        <Ban size={15} aria-hidden="true" />
                      </button>
                    )}

                    {/* Delete — permanent. Available at any status, since junk rows can be
                        completed or cancelled too. */}
                    {canManage && (
                      <button
                        onClick={() => setConfirmDelete({ id: task.id, title: task.title })}
                        disabled={busy}
                        title="Delete this record permanently"
                        aria-label={`Delete task ${task.title} permanently`}
                        className={`${iconBtn} hover:text-danger`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <ConfirmDialog
        open={!!confirmCancel}
        title="Cancel this task?"
        description={confirmCancel
          ? `“${confirmCancel.title}” will be marked cancelled and drop out of everyone's totals. The record of the assignment is kept.`
          : ''}
        confirmLabel="Cancel task"
        // Otherwise both buttons read "Cancel" and neither reads as the way out.
        cancelLabel="Keep task"
        busy={cancel.isPending}
        onConfirm={() => {
          if (confirmCancel) cancel.mutate(confirmCancel.id)
          setConfirmCancel(null)
        }}
        onCancel={() => setConfirmCancel(null)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this record permanently?"
        description={confirmDelete
          ? `“${confirmDelete.title}” will be erased from the database with no trace that it existed. This cannot be undone — to remove a task from the totals while keeping its history, cancel it instead.`
          : ''}
        confirmLabel="Delete permanently"
        destructive
        busy={remove.isPending}
        onConfirm={() => {
          if (confirmDelete) remove.mutate(confirmDelete.id)
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
