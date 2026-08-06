/**
 * StrategyMeetingsPage — the new opening view of /strategy.
 *
 * Pick a Fireflies call, attach context docs, run the analysis. The blank form is no longer the
 * entry point; it lives at /strategy/brief as the review/edit step the pipeline still needs.
 *
 * ponytail: filtering and sorting are plain useState over an already-fetched array. The list is one
 * page of recent meetings, not a paginated corpus — server-side filtering would be more code for
 * a list that fits in memory. Revisit if it ever exceeds a few hundred.
 */
import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Calendar, CalendarOff, Clock, ArrowRight, Target } from 'lucide-react'
import { listMeetings, meetingType, type Meeting } from '../lib/meetingsClient'
import { useIsAdmin } from '../hooks/useIsAdmin'

const eyebrow = 'text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)]'
const selectCls =
  'bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-2.5 py-1.5 text-sm text-primary focus:outline-none focus:border-[var(--color-accent)]'

type SortKey = 'newest' | 'oldest' | 'longest'
const TYPES = ['all', 'onboarding', 'sales', 'strategy', 'review'] as const

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtDur = (s: number | null) => (s ? `${Math.round(s / 60)} min` : '—')

export function StrategyMeetingsPage() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin()
  const navigate = useNavigate()
  const [type, setType] = useState<(typeof TYPES)[number]>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [calendarOnly, setCalendarOnly] = useState(false)

  const q = useQuery({ queryKey: ['fireflies-meetings'], queryFn: listMeetings, enabled: isAdmin })

  const meetings = useMemo(() => {
    const all = q.data?.transcripts ?? []
    const filtered = all.filter(
      (m) => (type === 'all' || meetingType(m.title) === type) && (!calendarOnly || m.calendarSourced),
    )
    const by: Record<SortKey, (a: Meeting, b: Meeting) => number> = {
      newest: (a, b) => (b.meetingDateMs ?? 0) - (a.meetingDateMs ?? 0),
      oldest: (a, b) => (a.meetingDateMs ?? 0) - (b.meetingDateMs ?? 0),
      longest: (a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0),
    }
    return [...filtered].sort(by[sort])
  }, [q.data, type, sort, calendarOnly])

  if (adminLoading) {
    return <div className="flex items-center gap-2 text-secondary text-sm py-16 justify-center"><Loader2 size={15} className="animate-spin" /> Checking access…</div>
  }
  if (!isAdmin) {
    return <p className="text-secondary text-sm text-center py-16">Call transcripts are admin-only — they carry client revenue and margin detail.</p>
  }

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-5">
        <h1 className="font-serif italic text-3xl text-primary flex items-center gap-2">
          <Target size={24} className="text-[var(--color-accent)]" /> Content Strategizing
        </h1>
        <p className="text-secondary text-sm mt-1">
          Pick the call this strategy is built on. Add any documents for extra context, then run the analysis.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <select className={selectCls} value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Filter by meeting type">
          {TYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'All meetings' : t}</option>)}
        </select>
        <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort meetings">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="longest">Longest first</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-secondary cursor-pointer">
          <input type="checkbox" checked={calendarOnly} onChange={(e) => setCalendarOnly(e.target.checked)} />
          Calendar-sourced only
        </label>
        <span className={`${eyebrow} ml-auto`}>{meetings.length} shown</span>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-secondary text-sm py-12 justify-center"><Loader2 size={15} className="animate-spin" /> Loading meetings…</div>
      ) : q.isError ? (
        <div className="bg-surface border border-[var(--color-error)] rounded-lg p-4 text-sm text-secondary">
          <p className="text-primary font-medium">Could not load meetings</p>
          <p className="mt-1 font-mono text-[12px] text-[var(--color-error)]">{(q.error as Error).message}</p>
          {/* 'Server not configured' means an env var is missing on the deployment, not an outage. */}
          {/Server not configured/i.test((q.error as Error).message) && (
            <p className="mt-1 text-muted text-xs">
              A required key is missing on this deployment — most likely FIREFLIES_API_KEY.
            </p>
          )}
          <p className="mt-2">
            <Link to="/strategy/brief" className="text-[var(--color-accent)] hover:underline">Start from a blank brief</Link> instead.
          </p>
        </div>
      ) : meetings.length === 0 ? (
        <div className="bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-6 text-center">
          <p className="text-secondary text-sm">No meetings match these filters.</p>
          <p className="text-muted text-xs mt-1">Fireflies only returns calls the notetaker attended.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2.5">
          {meetings.map((m) => (
            <button
              key={m.externalId}
              onClick={() => navigate(`/strategy/meeting/${m.externalId}`)}
              className="group text-left flex items-start justify-between gap-2 bg-surface border border-[rgba(var(--border-rgb),0.08)] hover:border-[var(--color-accent)] rounded-lg p-3.5 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-primary text-sm font-medium truncate">{m.title ?? 'Untitled call'}</div>
                <div className="flex items-center gap-3 mt-1.5 text-muted text-[11px] font-mono">
                  <span>{fmtDate(m.meetingDateMs)}</span>
                  <span className="flex items-center gap-1"><Clock size={11} />{fmtDur(m.durationSec)}</span>
                  <span className="uppercase tracking-wider">{meetingType(m.title)}</span>
                </div>
                {/* A link-joined call has no attendee list, so it can never be matched to a client automatically. */}
                <div className={`flex items-center gap-1 mt-1.5 text-[11px] ${m.calendarSourced ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>
                  {m.calendarSourced ? <Calendar size={11} /> : <CalendarOff size={11} />}
                  {m.calendarSourced ? `${m.emailCount} attendees` : 'Link-joined — no attendee emails'}
                </div>
              </div>
              <ArrowRight size={15} className="text-muted group-hover:text-[var(--color-accent)] shrink-0 mt-0.5 transition-colors" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
