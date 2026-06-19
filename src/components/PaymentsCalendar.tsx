/**
 * PaymentsCalendar — a month-grid visual of payments by their date (paid_on).
 *
 * Each day shows its payments as chips colored by status (due = amber, paid = green,
 * overdue = red); click a chip for full details incl. the note. Accounts are labeled
 * via the accountLabel() lookup passed in. Read-only overview — editing stays in the
 * list view. Payments with no date are counted below the grid.
 */
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { ClientPayment, PaymentStatus } from '../domain/calendar'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const STATUS_CHIP: Record<PaymentStatus, string> = {
  due: 'bg-[rgba(217,119,6,0.18)] text-warning',
  paid: 'bg-[rgba(76,175,125,0.20)] text-[#5FBF94]',
  overdue: 'bg-[rgba(224,92,92,0.18)] text-danger',
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const sameMonth = (d: Date, m: Date) => d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear()
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

function buildGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

interface Props {
  payments: ClientPayment[]
  accountLabel: (username: string) => string
}

export function PaymentsCalendar({ payments, accountLabel }: Props) {
  const [month, setMonth] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [selected, setSelected] = useState<ClientPayment | null>(null)
  const cells = useMemo(() => buildGrid(month), [month])

  const byDay = useMemo(() => {
    const map: Record<string, ClientPayment[]> = {}
    for (const p of payments) {
      if (!p.paidOn) continue // paid_on is already 'YYYY-MM-DD' from the date column
      if (!map[p.paidOn]) map[p.paidOn] = []
      map[p.paidOn].push(p)
    }
    return map
  }, [payments])

  const undated = useMemo(() => payments.filter((p) => !p.paidOn).length, [payments])

  const thisYear = new Date().getFullYear()
  const displayedYear = month.getFullYear()
  const minYear = Math.min(thisYear - 3, displayedYear)
  const maxYear = Math.max(thisYear + 5, displayedYear)
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)
  const todayKey = ymd(new Date())

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="p-1.5 rounded-md text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
            className="p-1.5 rounded-md text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
          >
            <ChevronRight size={18} />
          </button>
          <select
            value={month.getMonth()}
            onChange={(e) => setMonth(new Date(month.getFullYear(), Number(e.target.value), 1))}
            aria-label="Month"
            className="ml-2 bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-2 py-1 text-sm text-primary focus:outline-none focus:border-[#E07B3A]"
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={month.getFullYear()}
            onChange={(e) => setMonth(new Date(Number(e.target.value), month.getMonth(), 1))}
            aria-label="Year"
            className="bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-2 py-1 text-sm text-primary focus:outline-none focus:border-[#E07B3A]"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            const n = new Date()
            setMonth(new Date(n.getFullYear(), n.getMonth(), 1))
          }}
          className="text-xs text-secondary hover:text-primary border border-[rgba(245,237,214,0.12)] rounded-md px-2.5 py-1 transition-colors"
        >
          Today
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[11px] font-mono uppercase tracking-wide text-muted mr-1">Status</span>
        {(['due', 'paid', 'overdue'] as PaymentStatus[]).map((s) => (
          <span key={s} className={`text-[11px] rounded px-1.5 py-0.5 ${STATUS_CHIP[s]}`}>
            {s}
          </span>
        ))}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[11px] font-mono uppercase tracking-wide text-muted text-center py-1">
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px bg-[rgba(245,237,214,0.06)] rounded-lg overflow-hidden">
        {cells.map((d) => {
          const key = ymd(d)
          const dayPays = byDay[key] ?? []
          const inMonth = sameMonth(d, month)
          const isToday = key === todayKey
          return (
            <div
              key={key}
              className={`min-h-[88px] p-1.5 bg-chai flex flex-col gap-1 ${inMonth ? '' : 'opacity-40'} ${
                dayPays.length ? 'ring-1 ring-inset ring-[rgba(224,123,58,0.18)]' : ''
              }`}
            >
              <span className={`text-xs font-mono ${isToday ? 'text-[#E07B3A] font-semibold' : 'text-muted'}`}>
                {d.getDate()}
              </span>
              {dayPays.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  title={`${accountLabel(p.accountUsername)} — ${p.currency} ${fmt(p.amount)} (${p.status})`}
                  className={`text-left text-[11px] leading-tight rounded px-1.5 py-1 truncate cursor-pointer ${STATUS_CHIP[p.status]}`}
                >
                  {accountLabel(p.accountUsername)}: {p.currency} {fmt(p.amount)}
                </button>
              ))}
            </div>
          )
        })}
      </div>

      {undated > 0 && (
        <p className="text-muted text-xs mt-3">
          {undated} payment{undated !== 1 ? 's' : ''} with no date — not shown here; add a date in the list view to place
          {undated !== 1 ? ' them' : ' it'} on the calendar.
        </p>
      )}

      {/* Payment detail popup */}
      {selected && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-surface border border-[rgba(245,237,214,0.12)] rounded-lg w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-primary text-lg font-medium">Payment details</h2>
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-muted hover:text-primary">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted">Account</span>
                <span className="text-primary text-right">{accountLabel(selected.accountUsername)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Amount</span>
                <span className="text-primary font-mono">
                  {selected.currency} {fmt(selected.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted">Status</span>
                <span
                  className={`text-[11px] font-mono uppercase tracking-wide rounded px-1.5 py-0.5 ${STATUS_CHIP[selected.status]}`}
                >
                  {selected.status}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Date</span>
                <span className="text-primary">{selected.paidOn ?? '—'}</span>
              </div>
              {selected.method && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted">Method</span>
                  <span className="text-primary text-right">{selected.method}</span>
                </div>
              )}
              <div className="pt-1">
                <div className="text-muted mb-1">Note</div>
                <div className="text-primary whitespace-pre-wrap break-words">
                  {selected.note ? selected.note : <span className="text-muted">No note</span>}
                </div>
              </div>
            </div>
            <p className="text-muted text-xs mt-4">To edit or delete this payment, use the List view.</p>
          </div>
        </div>
      )}
    </div>
  )
}
