/**
 * Teams — create a team and staff it from the people who have signed in. HR or admin only.
 *
 * Members are picked from the Clerk user list rather than typed, so a membership row always
 * carries a real user id. Adding someone fires the team_added notification trigger in the
 * database; nothing is sent from here.
 *
 * The gate below is UX. performance_teams and performance_team_members both carry
 * `using (is_admin() or is_hr())` write policies, which is what actually refuses anyone else.
 */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UsersRound, Plus, Trash2, UserPlus } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  listTeams, createTeam, deleteTeam,
  listTeamMembers, addTeamMember, removeTeamMember, listMembers,
} from '../../lib/performanceRepo'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { useIsHr } from '../../hooks/useIsHr'

const inputCls =
  'bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]'

export function TeamsSection() {
  const qc = useQueryClient()
  const { isAdmin, isLoading: adminLoading } = useIsAdmin()
  const { isHr, isLoading: hrLoading } = useIsHr()
  const mayManage = isAdmin || isHr

  const [newTeam, setNewTeam] = useState('')
  const [addTarget, setAddTarget] = useState<Record<string, string>>({})
  const [confirmTeam, setConfirmTeam] = useState<{ id: string; name: string } | null>(null)

  const { data: teams = [] } = useQuery({ queryKey: ['performance-teams'], queryFn: listTeams, enabled: mayManage })
  const { data: memberships = [] } = useQuery({ queryKey: ['performance-team-members'], queryFn: listTeamMembers, enabled: mayManage })
  const { data: people = [] } = useQuery({
    queryKey: ['performance-members'], queryFn: listMembers, enabled: mayManage, staleTime: 5 * 60 * 1000,
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['performance-teams'] })
    void qc.invalidateQueries({ queryKey: ['performance-team-members'] })
  }

  const create = useMutation({
    mutationFn: () => createTeam(newTeam.trim()),
    onSuccess: () => { setNewTeam(''); invalidate() },
  })
  const remove = useMutation({ mutationFn: deleteTeam, onSuccess: invalidate })
  const addMember = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
      addTeamMember(teamId, userId, people.find((p) => p.userId === userId)?.label ?? null),
    onSuccess: invalidate,
  })
  const dropMember = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => removeTeamMember(teamId, userId),
    onSuccess: invalidate,
  })

  if (adminLoading || hrLoading) return <p className="text-secondary text-sm py-8">Checking access…</p>

  // Not HR: teams do not exist for them — the nav omits this, RLS refuses the rows, and this
  // redirect covers a typed URL. All three have to agree or the hiding is theatre.
  if (!mayManage) return <Navigate to="/performance/inbox" replace />

  return (
    <div className="max-w-2xl">
      {/* Create */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (newTeam.trim() && !create.isPending) create.mutate() }}
        className="flex flex-wrap items-center gap-2 mb-6"
      >
        <label htmlFor="new-team" className="sr-only">New team name</label>
        <input
          id="new-team" type="text" value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
          placeholder="Editing team"
          className={`${inputCls} flex-1 min-w-[12rem]`}
        />
        <button
          type="submit" disabled={!newTeam.trim() || create.isPending}
          className="inline-flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
        >
          <Plus size={15} aria-hidden="true" /> {create.isPending ? 'Creating…' : 'Create team'}
        </button>
      </form>

      {teams.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No teams yet"
          description="Create a team above, then add the people who belong to it."
        />
      ) : (
        <ul className="space-y-4">
          {teams.map((team) => {
            const roster = memberships.filter((m) => m.teamId === team.id)
            const rosterIds = new Set(roster.map((m) => m.userId))
            const addable = people.filter((p) => !rosterIds.has(p.userId))
            return (
              <li key={team.id} className="bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-primary font-medium flex-1 min-w-0 truncate">{team.name}</h3>
                  <span className="text-muted text-xs font-mono">{roster.length} member{roster.length === 1 ? '' : 's'}</span>
                  <button
                    onClick={() => setConfirmTeam({ id: team.id, name: team.name })}
                    disabled={remove.isPending}
                    aria-label={`Delete team ${team.name}`}
                    className="text-muted hover:text-danger transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>

                {roster.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 mb-3">
                    {roster.map((m) => (
                      <li
                        key={m.userId}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-raised)] pl-3 pr-1.5 py-1 text-xs text-primary"
                      >
                        {m.label ?? m.userId}
                        <button
                          onClick={() => dropMember.mutate({ teamId: team.id, userId: m.userId })}
                          disabled={dropMember.isPending}
                          aria-label={`Remove ${m.label ?? m.userId} from ${team.name}`}
                          className="text-muted hover:text-danger transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`add-${team.id}`} className="sr-only">Add a member to {team.name}</label>
                  <select
                    id={`add-${team.id}`}
                    value={addTarget[team.id] ?? ''}
                    onChange={(e) => setAddTarget((prev) => ({ ...prev, [team.id]: e.target.value }))}
                    className={`${inputCls} flex-1 min-w-[12rem]`}
                  >
                    <option value="">Add a member…</option>
                    {addable.map((p) => <option key={p.userId} value={p.userId}>{p.label}</option>)}
                  </select>
                  <button
                    onClick={() => {
                      const userId = addTarget[team.id]
                      if (!userId) return
                      addMember.mutate({ teamId: team.id, userId })
                      setAddTarget((prev) => ({ ...prev, [team.id]: '' }))
                    }}
                    disabled={!addTarget[team.id] || addMember.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
                  >
                    <UserPlus size={14} aria-hidden="true" /> Add
                  </button>
                </div>
                {addable.length === 0 && people.length > 0 && (
                  <p className="text-muted text-xs mt-2">Everyone who has signed in is already on this team.</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirmTeam}
        title="Delete this team?"
        description={confirmTeam
          ? `${confirmTeam.name} and its membership list will be removed. Tasks assigned within it are kept, without a team.`
          : ''}
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
        onConfirm={() => {
          if (confirmTeam) remove.mutate(confirmTeam.id)
          setConfirmTeam(null)
        }}
        onCancel={() => setConfirmTeam(null)}
      />
    </div>
  )
}
