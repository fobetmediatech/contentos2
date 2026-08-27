/**
 * HrAccessPanel — grant/revoke the HR role, rendered under the finance panel on Team Access.
 *
 * A separate component rather than a generalization of the finance panel: the two grants have
 * different consequences (finance sees money, HR assigns work and staffs teams), and keeping the
 * working finance flow untouched was worth more than removing the duplication.
 *
 * HR is its own grant — it confers no finance access and no admin rights, and admins do not get
 * it implicitly. Server-side, admin_grant_hr/admin_revoke_hr re-check is_admin().
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, UserPlus, Trash2 } from 'lucide-react'
import { listHrMembers, grantHrByEmail, revokeHr, type GrantReason } from '../lib/teamAccess'
import { ConfirmDialog } from './ConfirmDialog'

const GRANT_ERROR: Record<GrantReason, string> = {
  not_found: 'No account found for that email — ask them to sign in once, then try again.',
  ambiguous: 'Multiple accounts share that email — contact the tech team.',
  forbidden: 'You don’t have permission to do that.',
  error: 'Something went wrong — try again.',
}

const inputCls =
  'bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]'

export function HrAccessPanel() {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{ userId: string; name: string } | null>(null)

  const { data: members = [] } = useQuery({ queryKey: ['hr-members'], queryFn: listHrMembers })
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['hr-members'] })

  const grant = useMutation({
    mutationFn: () => grantHrByEmail(email),
    onSuccess: (r) => {
      if (r.ok) {
        setEmail('')
        setNotice({ kind: 'ok', text: `Granted HR access to ${r.email}.` })
        invalidate()
      } else {
        setNotice({ kind: 'err', text: GRANT_ERROR[r.reason] })
      }
    },
    onError: () => setNotice({ kind: 'err', text: GRANT_ERROR.error }),
  })

  const revoke = useMutation({ mutationFn: revokeHr, onSuccess: invalidate })

  const add = () => {
    if (!email.trim() || grant.isPending) return
    setNotice(null)
    grant.mutate()
  }

  return (
    <section className="mt-10">
      <h2 className="font-serif italic text-2xl text-primary flex items-center gap-2 mb-1">
        <ClipboardCheck size={20} className="text-[var(--color-accent)]" aria-hidden="true" /> HR access
      </h2>
      <p className="text-secondary text-sm mb-4">
        HR can create teams, add members, and assign tasks in the Performance section. Separate from finance and admin.
      </p>

      <div className="bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-4 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            placeholder="person@company.com"
            aria-label="Email address to grant HR access"
            className={`${inputCls} flex-1 min-w-[14rem]`}
          />
          <button
            onClick={add}
            disabled={!email.trim() || grant.isPending}
            className="flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
          >
            <UserPlus size={15} aria-hidden="true" /> {grant.isPending ? 'Granting…' : 'Grant HR'}
          </button>
        </div>
        <p className="text-muted text-xs mt-2">The person must sign in to the app once before they can be added.</p>
        {notice && (
          <p role="status" className={`text-xs mt-2 ${notice.kind === 'ok' ? 'text-success' : 'text-danger'}`}>
            {notice.text}
          </p>
        )}
      </div>

      <div className="text-[11px] font-mono uppercase tracking-wide text-muted mb-2">
        HR members ({members.length})
      </div>
      {members.length === 0 ? (
        <p className="text-muted text-sm">No one has HR access yet.</p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-primary text-sm font-medium truncate">{m.label || m.userId}</div>
                <div className="text-muted text-xs truncate font-mono">
                  {m.label ? m.userId : ''}
                  {m.createdAt ? `${m.label ? ' · ' : ''}added ${m.createdAt.slice(0, 10)}` : ''}
                </div>
              </div>
              <button
                onClick={() => setConfirmTarget({ userId: m.userId, name: m.label || m.userId })}
                disabled={revoke.isPending}
                aria-label="Remove HR access"
                className="flex-shrink-0 flex items-center justify-center w-9 h-9 -my-1 text-muted hover:text-danger disabled:opacity-50 transition-colors"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Remove HR access?"
        description={confirmTarget
          ? `${confirmTarget.name} will no longer be able to create teams or assign tasks. Tasks they already assigned are kept.`
          : ''}
        confirmLabel="Remove"
        destructive
        busy={revoke.isPending}
        onConfirm={() => {
          if (confirmTarget) revoke.mutate(confirmTarget.userId)
          setConfirmTarget(null)
        }}
        onCancel={() => setConfirmTarget(null)}
      />
    </section>
  )
}
