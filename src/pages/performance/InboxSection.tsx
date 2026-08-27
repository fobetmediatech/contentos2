/**
 * Inbox — the caller's own notifications.
 *
 * Rows are written by database triggers when a task is assigned, a task is reopened, or someone
 * is added to a team. Nothing here polls or computes: if a row exists, the event happened.
 *
 * Opening the inbox does NOT silently mark everything read — that loses the "what's new" signal
 * the moment you glance at the tab. Marking read is an explicit action, per item or all at once.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Inbox, CheckCheck, ClipboardList, RotateCcw, UsersRound } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState'
import { listNotifications, markNotificationsRead } from '../../lib/performanceRepo'
import { notificationText, unreadCount, type NotificationKind } from '../../domain/performance'

const KIND_ICON: Record<NotificationKind, typeof ClipboardList> = {
  task_assigned: ClipboardList,
  task_reopened: RotateCcw,
  team_added: UsersRound,
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function InboxSection() {
  const qc = useQueryClient()
  const { data: notifications = [], isLoading, error } = useQuery({
    queryKey: ['performance-notifications'],
    queryFn: listNotifications,
  })

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['performance-notifications'] }),
  })

  if (isLoading) return <p className="text-secondary text-sm py-8">Loading your inbox…</p>

  if (error) {
    return (
      <p className="text-sm py-8" style={{ color: 'var(--color-error)' }}>
        Could not load your inbox.
      </p>
    )
  }

  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing in your inbox"
        description="You'll be notified here when a task is assigned to you, a task is reopened, or you're added to a team."
      />
    )
  }

  const unread = unreadCount(notifications)

  return (
    <div>
      {unread > 0 && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-secondary text-sm">{unread} unread</p>
          <button
            onClick={() => markRead.mutate(undefined)}
            disabled={markRead.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
          >
            <CheckCheck size={14} aria-hidden="true" /> Mark all read
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {notifications.map((n) => {
          const Icon = KIND_ICON[n.kind]
          const isUnread = n.readAt === null
          return (
            <li
              key={n.id}
              className="flex items-start gap-3 rounded-lg border px-4 py-3 bg-surface"
              style={{
                // Unread carries the accent edge; read rows fade back to the ordinary border.
                borderColor: isUnread ? 'rgba(var(--accent-rgb),0.35)' : 'rgba(var(--border-rgb),0.08)',
              }}
            >
              <Icon
                size={16}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                style={{ color: isUnread ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
              />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${isUnread ? 'text-primary font-medium' : 'text-secondary'}`}>
                  {notificationText(n)}
                  {isUnread && <span className="sr-only"> (unread)</span>}
                </p>
                <p className="text-muted text-xs font-mono mt-0.5">{dateFmt.format(new Date(n.createdAt))}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {n.taskId && (
                  <Link
                    to="/performance/tasks/records"
                    className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded"
                  >
                    View
                  </Link>
                )}
                {isUnread && (
                  <button
                    onClick={() => markRead.mutate([n.id])}
                    disabled={markRead.isPending}
                    className="text-xs text-muted hover:text-primary transition-colors disabled:opacity-50"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
