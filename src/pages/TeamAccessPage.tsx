/**
 * TeamAccessPage — admin-only. Grant/revoke who can see the Payments section (finance role),
 * entirely from the app: add a person by email, remove a member. Surfaced from the account
 * dropdown. Server-side RLS + SECURITY DEFINER functions are the real enforcement.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, UserPlus, Trash2, ShieldCheck } from 'lucide-react'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listFinanceMembers, grantFinanceByEmail, revokeFinance, type GrantReason } from '../lib/teamAccess'

const GRANT_ERROR: Record<GrantReason, string> = {
  not_found: 'No account found for that email — ask them to sign in once, then try again.',
  ambiguous: 'Multiple accounts share that email — contact the tech team.',
  forbidden: 'You don’t have permission to do that.',
  error: 'Something went wrong — try again.',
}

const inputCls =
  'bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[#E07B3A]'

export function TeamAccessPage() {
  const { isAdmin, isLoading } = useIsAdmin()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const { data: members = [] } = useQuery({
    queryKey: ['finance-members'],
    queryFn: listFinanceMembers,
    enabled: isAdmin,
  })
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['finance-members'] })

  const grant = useMutation({
    mutationFn: () => grantFinanceByEmail(email),
    onSuccess: (r) => {
      if (r.ok) {
        setEmail('')
        setNotice({ kind: 'ok', text: `Granted finance access to ${r.email}.` })
        invalidate()
      } else {
        setNotice({ kind: 'err', text: GRANT_ERROR[r.reason] })
      }
    },
    onError: () => setNotice({ kind: 'err', text: GRANT_ERROR.error }),
  })

  const revoke = useMutation({
    mutationFn: (userId: string) => revokeFinance(userId),
    onSuccess: invalidate,
  })

  const addMember = () => {
    if (!email.trim() || grant.isPending) return
    setNotice(null)
    grant.mutate()
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto">
        <p className="text-muted text-sm">Checking access…</p>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg p-12 text-center">
          <Lock size={28} className="mx-auto text-muted mb-3" />
          <h1 className="text-primary text-lg font-medium mb-1">Team Access is restricted</h1>
          <p className="text-secondary text-sm">Only admins can manage who has finance access.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-5">
        <h1 className="font-serif italic text-3xl text-primary flex items-center gap-2">
          <ShieldCheck size={24} className="text-[#E07B3A]" /> Team Access
        </h1>
        <p className="text-secondary text-sm mt-1">
          Grant or revoke who can see the Payments section (the finance role). Admin only.
        </p>
      </header>

      {/* Add by email */}
      <div className="bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg p-4 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addMember()
            }}
            placeholder="person@company.com"
            className={`${inputCls} flex-1 min-w-[14rem]`}
          />
          <button
            onClick={addMember}
            disabled={!email.trim() || grant.isPending}
            className="flex items-center gap-1.5 bg-[#E07B3A] hover:bg-[#C4612A] disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
          >
            <UserPlus size={15} /> {grant.isPending ? 'Granting…' : 'Grant finance'}
          </button>
        </div>
        <p className="text-muted text-xs mt-2">
          The person must sign in to the app once before they can be added.
        </p>
        {notice && (
          <p className={`text-xs mt-2 ${notice.kind === 'ok' ? 'text-success' : 'text-danger'}`}>{notice.text}</p>
        )}
      </div>

      {/* Current members */}
      <div className="text-[11px] font-mono uppercase tracking-wide text-muted mb-2">
        Finance members ({members.length})
      </div>
      {members.length === 0 ? (
        <p className="text-muted text-sm">No one has finance access yet.</p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center gap-3 bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-primary text-sm font-medium truncate">{m.label || m.userId}</div>
                <div className="text-muted text-xs truncate font-mono">
                  {m.label ? m.userId : ''}
                  {m.createdAt ? `${m.label ? ' · ' : ''}added ${m.createdAt.slice(0, 10)}` : ''}
                </div>
              </div>
              <button
                onClick={() => {
                  if (window.confirm(`Remove finance access for ${m.label || m.userId}?`)) revoke.mutate(m.userId)
                }}
                disabled={revoke.isPending}
                aria-label="Remove finance access"
                className="flex-shrink-0 text-muted hover:text-danger disabled:opacity-50 transition-colors p-1"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
