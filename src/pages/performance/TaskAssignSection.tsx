/**
 * Task assignment — HR or admin.
 *
 * Invisible to everyone else: absent from the nav, and this route redirects them to their inbox.
 *
 * The gate here is UX, not security: the insert policy on performance_tasks
 * (`(is_admin() or is_hr()) and assigner_user_id = auth.jwt()->>'sub'`) is what actually refuses
 * anyone else, and it also stops an assignment being attributed to somebody who did not make it.
 *
 * Pick a team first, then a person from that team — the flow this feature was asked for. A team
 * is still optional, because a one-off task that belongs to no team is legitimate and forcing a
 * team would mean inventing throwaway ones.
 *
 * The deadline is a plain datetime-local, read in the browser's zone and stored as UTC. No
 * working-hours or grace-period rules are implied: a deadline is simply an instant, which is all
 * the timing derivation needs. Assigning fires the task_assigned notification trigger — the
 * assignee's inbox entry is written by the database, not from here.
 */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Send } from 'lucide-react'
import { listMembers, listTeams, listTeamMembers, createTask } from '../../lib/performanceRepo'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { useIsHr } from '../../hooks/useIsHr'

const inputCls =
  'bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]'

const labelCls = 'block font-mono text-[11px] uppercase tracking-wider text-muted mb-1.5'

export function TaskAssignSection() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin()
  const { isHr, isLoading: hrLoading } = useIsHr()
  const mayAssign = isAdmin || isHr
  const qc = useQueryClient()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [teamId, setTeamId] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const { data: people = [] } = useQuery({
    queryKey: ['performance-members'], queryFn: listMembers, enabled: mayAssign, staleTime: 5 * 60 * 1000,
  })
  const { data: teams = [] } = useQuery({ queryKey: ['performance-teams'], queryFn: listTeams, enabled: mayAssign })
  const { data: memberships = [] } = useQuery({
    queryKey: ['performance-team-members'], queryFn: listTeamMembers, enabled: mayAssign,
  })

  // With a team chosen, only its roster is assignable — that is the point of picking a team.
  const roster = teamId ? memberships.filter((m) => m.teamId === teamId) : []
  const options = teamId
    ? roster.map((m) => ({ userId: m.userId, label: m.label ?? m.userId }))
    : people.map((p) => ({ userId: p.userId, label: p.label }))

  const assign = useMutation({
    mutationFn: () => createTask({
      title: title.trim(),
      description: description.trim() || null,
      assigneeUserId: assignee,
      assigneeLabel: options.find((o) => o.userId === assignee)?.label ?? null,
      teamId: teamId || null,
      dueAt: new Date(due).getTime(),
    }),
    onSuccess: (task) => {
      setTitle(''); setDescription(''); setAssignee(''); setDue('')
      setNotice({ kind: 'ok', text: `Assigned “${task.title}” to ${task.assigneeLabel ?? 'the selected member'}. They've been notified.` })
      void qc.invalidateQueries({ queryKey: ['performance-tasks'] })
    },
    onError: () => setNotice({ kind: 'err', text: 'Could not assign the task. Check your access and try again.' }),
  })

  if (adminLoading || hrLoading) return <p className="text-secondary text-sm py-8">Checking access…</p>

  // Not HR: this section does not exist for them. Redirect rather than explain — a padlock
  // confirms the feature is there, which is exactly what hiding it is meant to avoid. The nav
  // omits the link too; this covers someone typing or bookmarking the URL.
  if (!mayAssign) return <Navigate to="/performance/inbox" replace />

  const ready = title.trim() !== '' && assignee !== '' && due !== '' && !assign.isPending

  return (
    <div className="max-w-xl">
      <form
        onSubmit={(e) => { e.preventDefault(); if (ready) { setNotice(null); assign.mutate() } }}
        className="bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-5 flex flex-col gap-4"
      >
        <div>
          <label htmlFor="task-title" className={labelCls}>Task</label>
          <input
            id="task-title" type="text" value={title} required
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Edit the launch reel"
            className={`${inputCls} w-full`}
          />
        </div>

        <div>
          <label htmlFor="task-description" className={labelCls}>
            Details <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <textarea
            id="task-description" value={description} rows={3}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything the assignee needs to know."
            className={`${inputCls} w-full resize-y`}
          />
        </div>

        <div>
          <label htmlFor="task-team" className={labelCls}>Team</label>
          <select
            id="task-team" value={teamId}
            onChange={(e) => { setTeamId(e.target.value); setAssignee('') }}
            className={`${inputCls} w-full`}
          >
            <option value="">No team — anyone</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {teams.length === 0 && (
            <p className="text-muted text-xs mt-1.5">No teams yet — create one under Teams to group people.</p>
          )}
        </div>

        <div>
          <label htmlFor="task-assignee" className={labelCls}>Assign to</label>
          <select
            id="task-assignee" value={assignee} required
            onChange={(e) => setAssignee(e.target.value)}
            className={`${inputCls} w-full`}
          >
            <option value="">Select a person…</option>
            {options.map((o) => <option key={o.userId} value={o.userId}>{o.label}</option>)}
          </select>
          {options.length === 0 && (
            <p className="text-muted text-xs mt-1.5">
              {teamId
                ? 'This team has no members yet — add people to it under Teams.'
                : 'No members loaded. Everyone must sign in at least once before they can be assigned work.'}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="task-due" className={labelCls}>Due</label>
          <input
            id="task-due" type="datetime-local" value={due} required
            onChange={(e) => setDue(e.target.value)}
            className={`${inputCls} w-full`}
          />
          <p className="text-muted text-xs mt-1.5">Entered and shown in your own time zone; stored as UTC.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit" disabled={!ready}
            className="inline-flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
          >
            <Send size={15} aria-hidden="true" /> {assign.isPending ? 'Assigning…' : 'Assign task'}
          </button>
          {notice && (
            <p
              role="status"
              className="text-xs"
              style={{ color: notice.kind === 'ok' ? 'var(--color-success)' : 'var(--color-error)' }}
            >
              {notice.text}
            </p>
          )}
        </div>
      </form>

      <p className="text-muted text-xs mt-3 flex items-start gap-1.5">
        <ClipboardList size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        The assignee gets an inbox notification, then marks the task done themselves; the completion time is recorded by the server.
      </p>
    </div>
  )
}
