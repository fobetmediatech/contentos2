/**
 * PaymentsPage — manual payment tracking per client, FINANCE ROLE ONLY.
 *
 * Gated by useIsFinance() for UX; Supabase RLS is the real enforcement. Clients come from
 * the Payments section's OWN standalone database (payment_clients) — managed here via the
 * Clients modal, independent of the Dashboard. Log a payment, mark it due/paid/overdue,
 * see running totals, and view them on a calendar.
 */
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, Trash2, Users } from 'lucide-react'
import { useIsFinance } from '../hooks/useIsFinance'
import { listPaymentClients, listPayments, createPayment, updatePayment, deletePayment } from '../lib/calendarRepo'
import { PaymentsCalendar } from '../components/PaymentsCalendar'
import { PaymentClientsManager } from '../components/PaymentClientsManager'
import { SearchablePicker } from '../components/SearchablePicker'
import { fetchRatesToInr, FALLBACK_RATES_TO_INR, toInr } from '../lib/fxRates'
import type { PaymentStatus } from '../domain/calendar'

const STATUSES: PaymentStatus[] = ['due', 'paid', 'overdue']
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED']

const STATUS_BADGE: Record<PaymentStatus, string> = {
  due: 'bg-[rgba(217,119,6,0.16)] text-warning',
  paid: 'bg-[rgba(76,175,125,0.18)] text-success',
  overdue: 'bg-[rgba(224,92,92,0.16)] text-danger',
}

const inputCls =
  'bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[#E07B3A]'

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

export function PaymentsPage() {
  const { isFinance, isLoading } = useIsFinance()
  const qc = useQueryClient()

  const [clientFilter, setClientFilter] = useState('all')
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [showClients, setShowClients] = useState(false)
  const [paymentClientId, setPaymentClientId] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [paidOn, setPaidOn] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [status, setStatus] = useState<PaymentStatus>('due')
  const [note, setNote] = useState('')

  const { data: clients = [] } = useQuery({ queryKey: ['payment_clients'], queryFn: listPaymentClients, enabled: isFinance })
  const clientLabel = (id: string) => clients.find((c) => c.id === id)?.name || id
  const clientItems = useMemo(() => clients.map((c) => ({ value: c.id, label: c.name })), [clients])

  const { data: payments = [] } = useQuery({
    queryKey: ['client_payments', clientFilter],
    queryFn: () => listPayments(clientFilter === 'all' ? undefined : clientFilter),
    enabled: isFinance,
  })

  // Live FX rates for the consolidated INR total. Cached ~12h; falls back to a built-in
  // table if the service is unreachable so the total never breaks.
  const { data: liveRates } = useQuery({
    queryKey: ['fx-rates'],
    queryFn: () => fetchRatesToInr(),
    enabled: isFinance,
    staleTime: 12 * 60 * 60 * 1000,
    retry: 1,
  })
  const rateMap = liveRates ?? FALLBACK_RATES_TO_INR

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['client_payments'] })

  const create = useMutation({
    mutationFn: createPayment,
    onSuccess: () => {
      invalidate()
      setPaymentClientId('')
      setAmount('')
      setPaidOn('')
      setStatus('due')
      setNote('')
    },
  })
  const remove = useMutation({ mutationFn: deletePayment, onSuccess: invalidate })
  const changeStatus = useMutation({
    mutationFn: ({ id, s }: { id: string; s: PaymentStatus }) => updatePayment(id, { status: s }),
    onSuccess: invalidate,
  })

  const totals = useMemo(() => {
    const t: Record<PaymentStatus, { count: number; sum: number }> = {
      due: { count: 0, sum: 0 },
      paid: { count: 0, sum: 0 },
      overdue: { count: 0, sum: 0 },
    }
    for (const p of payments) {
      t[p.status].count += 1
      t[p.status].sum += toInr(p.amount, p.currency, rateMap)
    }
    return t
  }, [payments, rateMap])

  // Picking a client defaults the currency to that client's billing currency.
  const pickClient = (id: string) => {
    setPaymentClientId(id)
    const c = clients.find((x) => x.id === id)
    if (c) setCurrency(c.currency)
  }

  const addPayment = () => {
    const amt = Number(amount)
    if (!paymentClientId || !Number.isFinite(amt) || amt <= 0 || !note.trim() || create.isPending) return
    create.mutate({ paymentClientId, amount: amt, currency, paidOn: paidOn || null, status, note: note.trim() })
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-muted text-sm">Checking access…</p>
      </div>
    )
  }

  if (!isFinance) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg p-12 text-center">
          <Lock size={28} className="mx-auto text-muted mb-3" />
          <h1 className="text-primary text-lg font-medium mb-1">Payments are restricted</h1>
          <p className="text-secondary text-sm">Only finance team members can view this section.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-serif italic text-3xl text-primary">Payments</h1>
          <p className="text-secondary text-sm mt-1">Track what each client has paid. Finance only.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowClients(true)}
            className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary border border-[rgba(245,237,214,0.12)] rounded-md px-3 py-2 transition-colors"
          >
            <Users size={15} /> Manage clients
          </button>
          <SearchablePicker
            items={clientItems}
            value={clientFilter}
            onChange={setClientFilter}
            includeAll
            allLabel="All clients"
            className="w-56"
          />
        </div>
      </header>

      {clients.length === 0 && (
        <p className="text-muted text-sm mb-5">
          No clients yet — add one with <span className="text-secondary">Manage clients</span> before logging a payment.
        </p>
      )}

      {/* Totals — consolidated to INR (each payment converted at current rates) */}
      <div className="grid grid-cols-3 gap-3 mb-2">
        {STATUSES.map((s) => (
          <div key={s} className="bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_BADGE[s]}`}>
                {s}
              </span>
              <span className="text-muted text-xs font-mono">{totals[s].count}</span>
            </div>
            <div className="text-primary font-mono text-lg mt-2">≈ ₹{fmt(totals[s].sum)}</div>
          </div>
        ))}
      </div>
      <p className="text-muted text-[11px] mb-6">
        ≈ Totals consolidated in <span className="text-secondary">INR</span> — other currencies converted at{' '}
        {liveRates ? 'today’s' : 'approximate'} rates. Each payment below keeps its original currency.
      </p>

      {/* Add payment */}
      <div className="bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg p-4 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
          <SearchablePicker
            items={clientItems}
            value={paymentClientId}
            onChange={pickClient}
            placeholder="Client…"
            className="col-span-2"
          />
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            min="0"
            className={inputCls}
          />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputCls} />
          <select value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus)} className={inputCls}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note *"
            maxLength={200}
            className={`${inputCls} col-span-2 sm:col-span-5`}
          />
          <button
            onClick={addPayment}
            disabled={!paymentClientId || !amount || !note.trim() || create.isPending}
            className="flex items-center justify-center gap-1.5 bg-[#E07B3A] hover:bg-[#C4612A] disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
          >
            <Plus size={15} /> {create.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
        {create.isError && <p className="text-danger text-xs mt-2">Couldn&apos;t add the payment — try again.</p>}
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-1 mb-4">
        <button
          onClick={() => setView('list')}
          className={`text-sm px-3 py-1.5 rounded-md transition-colors ${view === 'list' ? 'bg-surface-raised text-primary font-medium' : 'text-secondary hover:text-primary hover:bg-surface-raised'}`}
        >
          List
        </button>
        <button
          onClick={() => setView('calendar')}
          className={`text-sm px-3 py-1.5 rounded-md transition-colors ${view === 'calendar' ? 'bg-surface-raised text-primary font-medium' : 'text-secondary hover:text-primary hover:bg-surface-raised'}`}
        >
          Calendar
        </button>
      </div>

      {view === 'calendar' ? (
        <PaymentsCalendar payments={payments} clientLabel={clientLabel} />
      ) : payments.length === 0 ? (
        <p className="text-muted text-sm">No payments logged yet.</p>
      ) : (
        <ul className="space-y-2">
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-primary text-sm font-medium truncate">{clientLabel(p.paymentClientId)}</div>
                <div className="text-muted text-xs truncate">
                  {p.paidOn ?? 'no date'}
                  {p.note ? ` · ${p.note}` : ''}
                </div>
              </div>
              <div className="text-primary font-mono text-sm whitespace-nowrap">
                {p.currency} {fmt(p.amount)}
              </div>
              <select
                value={p.status}
                onChange={(e) => changeStatus.mutate({ id: p.id, s: e.target.value as PaymentStatus })}
                aria-label="Payment status"
                className={`text-[11px] font-mono uppercase tracking-wide rounded px-1.5 py-1 focus:outline-none ${STATUS_BADGE[p.status]}`}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {confirmDeleteId === p.id ? (
                <span className="flex-shrink-0 flex items-center gap-1.5 text-xs">
                  <button onClick={() => { remove.mutate(p.id); setConfirmDeleteId(null) }} disabled={remove.isPending} aria-label="Confirm delete payment" className="text-danger font-medium hover:underline disabled:opacity-50">Delete?</button>
                  <button onClick={() => setConfirmDeleteId(null)} aria-label="Cancel delete" className="text-muted hover:text-secondary transition-colors">Cancel</button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(p.id)}
                  aria-label="Delete payment"
                  className="flex-shrink-0 text-muted hover:text-danger transition-colors p-1"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showClients && <PaymentClientsManager onClose={() => setShowClients(false)} />}
    </div>
  )
}
