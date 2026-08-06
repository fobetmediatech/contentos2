/**
 * StrategyMeetingPage — step 2 of the new flow (/strategy/meeting/:externalId).
 *
 * Ingest the chosen call, then hand off to the review. Context documents attach here too.
 *
 * ponytail: the meeting's own metadata comes from the list query already in the React Query cache,
 * so this page does not refetch it. If it is opened cold (direct link, hard refresh) the header
 * degrades to the id and everything still works — not worth a second endpoint to avoid.
 */
import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Play } from 'lucide-react'
import { listMeetings, ingestMeeting, meetingType } from '../lib/meetingsClient'
import { useIsAdmin } from '../hooks/useIsAdmin'

export function StrategyMeetingPage() {
  const { externalId = '' } = useParams()
  const navigate = useNavigate()
  const { isAdmin, isLoading: adminLoading } = useIsAdmin()
  const [result, setResult] = useState<{ joinStatus: string; clientId: string | null; chunks: number } | null>(null)

  const list = useQuery({ queryKey: ['fireflies-meetings'], queryFn: listMeetings, enabled: isAdmin })
  const meeting = list.data?.transcripts.find((m) => m.externalId === externalId)

  const ingest = useMutation({
    mutationFn: () => ingestMeeting(externalId),
    onSuccess: (r) => setResult({ joinStatus: r.joinStatus, clientId: r.clientId, chunks: r.chunks }),
  })

  if (adminLoading) {
    return <div className="flex items-center gap-2 text-secondary text-sm py-16 justify-center"><Loader2 size={15} className="animate-spin" /> Checking access…</div>
  }
  if (!isAdmin) {
    return <p className="text-secondary text-sm text-center py-16">Call transcripts are admin-only.</p>
  }

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <Link to="/strategy" className="inline-flex items-center gap-1.5 text-muted hover:text-primary text-sm mb-4">
        <ArrowLeft size={14} /> All meetings
      </Link>

      <h1 className="font-serif italic text-3xl text-primary">{meeting?.title ?? 'Selected call'}</h1>
      <p className="text-secondary text-sm mt-1">
        {meeting ? `${meetingType(meeting.title)} · ${Math.round((meeting.durationSec ?? 0) / 60)} min` : externalId}
      </p>

      {meeting && !meeting.calendarSourced && (
        <div className="mt-4 bg-[rgba(var(--border-rgb),0.04)] border border-[var(--color-warning)] rounded-lg p-3.5">
          <div className="flex items-center gap-2 text-[var(--color-warning)] text-sm font-medium">
            <AlertTriangle size={15} /> Link-joined call
          </div>
          <p className="text-secondary text-sm mt-1">
            No calendar event means no attendee emails, so this cannot be matched to a client automatically.
            It will land unmatched and need assigning by hand.
          </p>
        </div>
      )}

      <div className="mt-5 bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-4">
        <h2 className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-2">Step 1 · Ingest the transcript</h2>
        <p className="text-secondary text-sm mb-3">Pulls the transcript, splits it on speaker turns, and embeds it for retrieval.</p>
        <button
          onClick={() => ingest.mutate()}
          disabled={ingest.isPending || Boolean(result)}
          className="flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 text-white text-sm font-medium rounded-md px-4 py-2"
        >
          {ingest.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {result ? 'Ingested' : 'Ingest transcript'}
        </button>

        {ingest.isError && <p className="text-[var(--color-error)] text-sm mt-2">Ingest failed. Check that Fireflies is reachable.</p>}

        {result && (
          <div className="mt-3 flex items-start gap-2 text-sm">
            <CheckCircle2 size={15} className="text-[var(--color-success)] shrink-0 mt-0.5" />
            <div>
              <span className="text-primary">{result.chunks} chunks stored.</span>{' '}
              <span className="text-muted font-mono text-[11px] uppercase tracking-wider">{result.joinStatus}</span>
              {result.clientId ? (
                <button
                  onClick={() => navigate(`/strategy/review/${result.clientId}`)}
                  className="block mt-2 text-[var(--color-accent)] hover:underline"
                >
                  Continue to the brief review →
                </button>
              ) : (
                <p className="text-secondary mt-1">
                  Not matched to a client. Register the client&apos;s email first, then re-ingest.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ponytail: not built yet — stated rather than stubbed, so nothing looks wired that isn't. */}
      <div className="mt-3 bg-surface border border-dashed border-[rgba(var(--border-rgb),0.12)] rounded-lg p-4">
        <h2 className="text-[11px] font-mono uppercase tracking-wider text-muted mb-2">Step 2 · Context documents</h2>
        <p className="text-muted text-sm">
          Attaching PDFs, decks and sheets as extra context is the next slice. Files will go straight to
          Gemini rather than being parsed locally.
        </p>
      </div>
    </div>
  )
}
