/**
 * TranscriptBriefsStrip — the entry point into the transcript-driven review flow.
 *
 * Without this the review UI is reachable only by typing /strategy/review/<uuid>. It sits on the
 * Strategy page because that is where someone already goes to start a brief.
 *
 * DISTINCT FROM "Saved clients" directly above it, and the difference matters:
 *   Saved clients    -> client_strategies — a finished strategy RUN, opens the deck
 *   Transcript briefs -> cb_clients        — a client identity, opens the pre-filled form to review
 * They are different tables with different lifecycles; one client can have many saved strategies.
 *
 * Admin-only. The cb_ tables carry client revenue and margin detail, and their RLS is admin-only —
 * so for anyone else this query returns an empty list, and rendering a permanently-empty section
 * would just be confusing. Hidden entirely instead.
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileSearch, ArrowRight, Loader2 } from 'lucide-react'
import { listClients } from '../lib/reviewRepo'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { SAMPLE_CLIENT_ID } from '../lib/sampleStrategy'

const relDate = (ms: number): string =>
  ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export function TranscriptBriefsStrip() {
  const { isAdmin } = useIsAdmin()
  const q = useQuery({ queryKey: ['cb-clients'], queryFn: listClients, enabled: isAdmin })

  if (!isAdmin) return null

  const clients = q.data ?? []

  return (
    <div className="no-print mb-5">
      <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-2">
        <FileSearch size={13} /> Transcript briefs
        <Link
          to={`/strategy/review/${SAMPLE_CLIENT_ID}`}
          className="ml-auto normal-case tracking-normal text-muted hover:text-[var(--color-accent)] font-sans text-xs"
        >
          Preview sample →
        </Link>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-muted text-xs py-2">
          <Loader2 size={13} className="animate-spin" /> Loading clients…
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-3">
          <p className="text-secondary text-sm">No transcript clients yet.</p>
          <p className="text-muted text-xs mt-1">
            Import a sales-sheet row to create one — that registers the email transcripts are matched
            on, and fills the competitor handles.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {clients.map((c) => (
            <Link
              key={c.id}
              to={`/strategy/review/${c.id}`}
              className="group flex items-start justify-between gap-2 bg-surface border border-[rgba(var(--border-rgb),0.08)] hover:border-[var(--color-accent)] rounded-lg p-3 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-primary text-sm font-medium truncate">{c.displayName}</div>
                {/* The email IS the join key, so showing it makes an unmatched transcript diagnosable. */}
                {c.emails.length > 0 && (
                  <div className="text-muted text-xs truncate mt-0.5 font-mono">{c.emails[0]}</div>
                )}
                <div className="text-muted text-[11px] font-mono mt-1">{relDate(c.createdAt)}</div>
              </div>
              <ArrowRight size={15} className="text-muted group-hover:text-[var(--color-accent)] shrink-0 mt-0.5 transition-colors" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
