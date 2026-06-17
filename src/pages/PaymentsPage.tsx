/**
 * PaymentsPage — manual payment tracking, FINANCE ROLE ONLY.
 *
 * Gated by useIsFinance() for UX; Supabase RLS is the real enforcement (a non-finance
 * user can't read the data even if they reach this route). Full table + form land next.
 */
import { Wallet, Lock } from 'lucide-react'
import { useIsFinance } from '../hooks/useIsFinance'

export function PaymentsPage() {
  const { isFinance, isLoading } = useIsFinance()

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto">
        <p className="text-muted text-sm">Checking access…</p>
      </div>
    )
  }

  if (!isFinance) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg p-12 text-center">
          <Lock size={28} className="mx-auto text-muted mb-3" />
          <h1 className="text-primary text-lg font-medium mb-1">Payments are restricted</h1>
          <p className="text-secondary text-sm">Only finance team members can view this section.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="font-serif italic text-3xl text-primary">Payments</h1>
        <p className="text-secondary text-sm mt-1">Track what each client has paid. Finance only.</p>
      </header>
      <div className="bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg p-12 text-center">
        <Wallet size={32} className="mx-auto text-muted mb-3" />
        <p className="text-secondary text-sm">Payment tracking is being built next.</p>
      </div>
    </div>
  )
}
