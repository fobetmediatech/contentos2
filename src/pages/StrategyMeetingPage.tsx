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
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Play, Paperclip, X, Sparkles, UserPlus, Link2 } from 'lucide-react'
import { listMeetings, ingestMeeting, meetingType, fileToDoc, runExtraction, createClient, type ExtractResult } from '../lib/meetingsClient'
import { listClients } from '../lib/reviewRepo'

export function StrategyMeetingPage() {
  const { externalId = '' } = useParams()
  const navigate = useNavigate()
  const [result, setResult] = useState<{ joinStatus: string; clientId: string | null; chunks: number } | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [extract, setExtract] = useState<ExtractResult | null>(null)
  const [pickedClient, setPickedClient] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')

  const list = useQuery({ queryKey: ['fireflies-meetings'], queryFn: listMeetings })
  const meeting = list.data?.transcripts.find((m) => m.externalId === externalId)

  const ingest = useMutation({
    mutationFn: () => ingestMeeting(externalId),
    onSuccess: (r) => setResult({ joinStatus: r.joinStatus, clientId: r.clientId, chunks: r.chunks }),
  })

  const clients = useQuery({ queryKey: ['cb-clients'], queryFn: listClients })

  /** Re-ingest with an explicit clientId — the manual-assignment path the join already supports. */
  const assign = useMutation({
    mutationFn: async (clientId: string) => ingestMeeting(externalId, clientId),
    onSuccess: (r) => setResult({ joinStatus: r.joinStatus, clientId: r.clientId, chunks: r.chunks }),
  })

  const createAndAssign = useMutation({
    mutationFn: async () => {
      const c = await createClient(newName.trim(), newEmail.trim() || undefined)
      return ingestMeeting(externalId, c.clientId)
    },
    onSuccess: (r) => {
      setResult({ joinStatus: r.joinStatus, clientId: r.clientId, chunks: r.chunks })
      void clients.refetch()
    },
  })

  const analyse = useMutation({
    mutationFn: async () => {
      if (!result?.clientId) throw new Error('no client')
      return runExtraction(result.clientId, await Promise.all(files.map(fileToDoc)))
    },
    onSuccess: setExtract,
  })

  const totalMb = files.reduce((n, f) => n + f.size, 0) / 1024 / 1024

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

        {ingest.isError && (
          <p className="text-[var(--color-error)] text-sm mt-2 font-mono text-[12px] break-words">
            {(ingest.error as Error).message}
          </p>
        )}

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
                <p className="text-secondary mt-1">Not matched to a client — assign one below.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Assignment — only while there is an ingested transcript with no client. A link-joined call
          can never auto-match, so without this the flow dead-ends here for every such call. */}
      {result && !result.clientId && (
        <div className="mt-3 bg-surface border border-[var(--color-warning)] rounded-lg p-4">
          <h2 className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-warning)] mb-2">
            Assign a client
          </h2>

          {(clients.data?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <select
                aria-label="Existing client"
                value={pickedClient}
                onChange={(e) => setPickedClient(e.target.value)}
                className="bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-2.5 py-1.5 text-sm text-primary focus:outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">Choose an existing client…</option>
                {clients.data?.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
              <button
                onClick={() => assign.mutate(pickedClient)}
                disabled={!pickedClient || assign.isPending}
                className="flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 text-white text-sm font-medium rounded-md px-3 py-1.5"
              >
                {assign.isPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Assign
              </button>
            </div>
          )}

          <p className="text-muted text-xs mb-2">
            {(clients.data?.length ?? 0) > 0 ? 'Or create a new one:' : 'No clients yet — create the first one:'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Client name"
              aria-label="New client name"
              className="bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]"
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="their@email.com (optional)"
              aria-label="New client email"
              className="bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={() => createAndAssign.mutate()}
              disabled={!newName.trim() || createAndAssign.isPending}
              className="flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 text-white text-sm font-medium rounded-md px-3 py-1.5"
            >
              {createAndAssign.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Create &amp; assign
            </button>
          </div>
          {/* The email is what lets FUTURE calendar-invited calls match automatically. */}
          <p className="text-muted text-xs mt-2">
            Adding the email is optional here, but it is what lets future calls auto-match.
          </p>

          {(assign.isError || createAndAssign.isError) && (
            <p className="text-[var(--color-error)] text-sm mt-2 font-mono text-[12px]">
              {((assign.error ?? createAndAssign.error) as Error).message}
            </p>
          )}
        </div>
      )}

      <div className={`mt-3 bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-4 ${result?.clientId ? '' : 'opacity-50 pointer-events-none'}`}>
        <h2 className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-2">Step 2 · Context documents (optional)</h2>
        <p className="text-secondary text-sm mb-3">
          Proposals, decks, sheets, brand docs. Sent straight to Gemini — never parsed here, so slide and
          spreadsheet layout survives. Max 5 files, 4&nbsp;MB total.
        </p>

        <label className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5 cursor-pointer">
          <Paperclip size={14} /> Add files
          <input
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 5))
              e.target.value = ''
            }}
          />
        </label>

        {files.length > 0 && (
          <ul className="mt-2.5 space-y-1">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm text-secondary">
                <span className="truncate">{f.name}</span>
                <span className="text-muted font-mono text-[11px]">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="text-muted hover:text-[var(--color-error)]">
                  <X size={13} />
                </button>
              </li>
            ))}
            {totalMb > 4 && (
              <li className="text-[var(--color-error)] text-sm">Over the 4 MB limit — remove a file.</li>
            )}
          </ul>
        )}
      </div>

      <div className={`mt-3 bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-4 ${result?.clientId ? '' : 'opacity-50 pointer-events-none'}`}>
        <h2 className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-2">Step 3 · Run the analysis</h2>
        <p className="text-secondary text-sm mb-3">
          Fills the brief from the call, with a citation behind every value. Nothing is generated until a
          human presses Generate on the reviewed brief.
        </p>
        <button
          onClick={() => analyse.mutate()}
          disabled={analyse.isPending || totalMb > 4 || !result?.clientId}
          className="flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 text-white text-sm font-medium rounded-md px-4 py-2"
        >
          {analyse.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Run analysis
        </button>

        {analyse.isError && (
          <p className="text-[var(--color-error)] text-sm mt-2">{(analyse.error as Error).message}</p>
        )}

        {extract && (
          <div className="mt-3 text-sm">
            <p className="text-primary">
              {extract.filled} of {extract.fieldsWritten} fields filled
              {extract.documentsRead > 0 && ` · ${extract.documentsRead} document${extract.documentsRead === 1 ? '' : 's'} read`}
            </p>
            {/* Surfaced, not hidden: a dropped citation means a claim could not be backed. */}
            {extract.droppedCitations > 0 && (
              <p className="text-muted text-xs mt-0.5">{extract.droppedCitations} unverifiable citation(s) dropped</p>
            )}
            <button
              onClick={() => navigate(`/strategy/review/${result?.clientId}`)}
              className="block mt-2 text-[var(--color-accent)] hover:underline"
            >
              Review the brief →
            </button>
          </div>
        )}
      </div>

    </div>
  )
}
