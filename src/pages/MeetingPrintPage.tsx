/**
 * /print/meeting/:transcriptId — plain printable documents for one call.
 *
 *   ?view=summary     generated minutes (cached server-side)
 *   ?view=transcript  the raw transcript, no model call at all
 *   ?view=brief       one-page discovery-call brief (generated each view, uncached)
 *
 * Printing reuses the app's existing rules: `@media print` hides everything except
 * `.report-printable` and drops `.no-print`. No PDF library — the browser's own print-to-PDF is the
 * export, exactly as the report and deck already do it.
 *
 * Rendered OUTSIDE AppLayout so no nav chrome appears on the page.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { meetingSummary, meetingBrief, type MeetingSummaryView, type DiscoveryBriefView, type BriefItem } from '../lib/meetingsClient'
import { getTranscriptText } from '../lib/reviewRepo'

const fmtDate = (v: string | number | null): string => {
  if (v === null) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function MeetingPrintPage() {
  const { transcriptId = '' } = useParams()
  const [params] = useSearchParams()
  const rawView = params.get('view')
  const view = rawView === 'transcript' ? 'transcript' : rawView === 'brief' ? 'brief' : 'summary'

  const [title, setTitle] = useState<string | null>(null)
  const [dateLabel, setDateLabel] = useState('')
  const [summary, setSummary] = useState<MeetingSummaryView | null>(null)
  const [brief, setBrief] = useState<DiscoveryBriefView | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [fullText, setFullText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  // regenerate() is async and this component stays MOUNTED across /print/meeting/:id changes
  // (browser back/forward between two visited print URLs), so the id it started with can go stale.
  // A ref is required: comparing against the closure's own `transcriptId` compares a value to
  // itself and is always true.
  const currentTranscriptId = useRef(transcriptId)
  useEffect(() => {
    currentTranscriptId.current = transcriptId
  }, [transcriptId])

  useEffect(() => {
    let live = true
    setBusy(true)
    setError(null)

    const load = async () => {
      if (view === 'transcript') {
        // getTranscriptText throws on a read failure (backend outage) and returns null only when
        // the row genuinely does not exist — the two must not be conflated into one message.
        const t = await getTranscriptText(transcriptId)
        if (!live) return
        if (!t) { setError('No such transcript, or it is not readable by you.'); return }
        setTitle(t.title)
        setDateLabel(fmtDate(t.meetingDate))
        setFullText(t.fullText)
        if (!t.fullText?.trim()) setError('This call has no transcript text ingested.')
        return
      }
      if (view === 'brief') {
        const b = await meetingBrief(transcriptId)
        if (!live) return
        setTitle(b.title)
        setDateLabel(fmtDate(b.meetingDate))
        setBrief(b.brief)
        setGeneratedAt(b.generatedAt)
        return
      }
      const r = await meetingSummary(transcriptId)
      if (!live) return
      setTitle(r.title)
      setDateLabel(fmtDate(r.meetingDate))
      setSummary(r.summary)
      setGeneratedAt(r.generatedAt)
    }

    load()
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load this document.') })
      .finally(() => { if (live) setBusy(false) })

    return () => { live = false }
  }, [transcriptId, view])

  const regenerate = async () => {
    const startedWith = transcriptId
    setBusy(true)
    setError(null)
    try {
      if (view === 'brief') {
        const b = await meetingBrief(startedWith, true)
        if (startedWith === currentTranscriptId.current) {
          setBrief(b.brief)
          setGeneratedAt(b.generatedAt)
        }
      } else {
        const r = await meetingSummary(startedWith, true)
        if (startedWith === currentTranscriptId.current) {
          setSummary(r.summary)
          setGeneratedAt(r.generatedAt)
        }
      }
    } catch (e: unknown) {
      if (startedWith === currentTranscriptId.current) {
        setError(e instanceof Error ? e.message : 'Could not regenerate.')
      }
    } finally {
      // Unconditional: a busy flag that can be skipped leaves the page stuck on "Working…".
      setBusy(false)
    }
  }

  const section = (heading: string, rows: Array<{ left: string; right: string }>) =>
    rows.length === 0 ? null : (
      <section className="mt-6">
        <h2 className="text-lg mb-2" style={{ fontFamily: 'Instrument Serif, serif' }}>{heading}</h2>
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-sm shrink-0" style={{ fontFamily: 'DM Mono, monospace' }}>
                {r.right || '—'}
              </span>
              <span>{r.left}</span>
            </li>
          ))}
        </ul>
      </section>
    )

  // Bulleted brief section; assumed items carry the violet AI tint + an "(assumed)" tag (DESIGN.md:
  // that tint is reserved for AI-generated/inferred content). An empty section renders nothing —
  // "blank = not mentioned on the call" is the document's honesty contract.
  const briefSection = (heading: string, items: BriefItem[]) =>
    items.length === 0 ? null : (
      <section className="mt-6">
        <h2 className="text-[11px] font-mono uppercase tracking-wider text-secondary mb-2">{heading}</h2>
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-secondary select-none">•</span>
              <span>
                {it.text}
                {it.assumed && (
                  <span className="ml-1.5 text-[12px]" style={{ color: 'var(--color-ai-tint)' }}>
                    (assumed)
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    )

  const briefField = (label: string, value: string) =>
    !value ? null : (
      <p className="mt-1">
        <span className="font-medium">{label}: </span>
        {value}
      </p>
    )

  return (
    <div className="min-h-[100dvh] px-6 py-8">
      <div className="no-print flex items-center gap-2 mb-6">
        <button
          onClick={() => window.print()}
          disabled={busy}
          className="text-sm rounded-md px-3 py-1.5 border border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary disabled:opacity-40"
        >
          Print / Save as PDF
        </button>
        {view !== 'transcript' && (
          <button
            onClick={() => void regenerate()}
            disabled={busy}
            className="text-sm rounded-md px-3 py-1.5 border border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary disabled:opacity-40"
          >
            Regenerate
          </button>
        )}
        <div aria-live="polite">
          {busy && <span className="text-sm text-secondary">Working…</span>}
          {error && <span className="text-sm text-secondary">{error}</span>}
        </div>
      </div>

      <article className="report-printable max-w-3xl">
        <h1 className="text-3xl" style={{ fontFamily: 'Instrument Serif, serif' }}>
          {view === 'brief' ? 'Discovery Call — Client Brief' : (title ?? 'Untitled call')}
        </h1>
        {view === 'brief' && title && <p className="text-sm text-secondary mt-1">{title}</p>}
        {dateLabel && <p className="text-sm text-secondary mt-1">{dateLabel}</p>}
        {view !== 'brief' && (
          <p className="text-sm text-secondary mt-1">
            {view === 'transcript' ? 'Full transcript' : 'Meeting summary'}
          </p>
        )}
        {view !== 'transcript' && generatedAt && (
          <p className="text-sm text-secondary mt-1">Generated {fmtDate(generatedAt)}</p>
        )}

        {view === 'transcript' && (
          <pre className="mt-6 whitespace-pre-wrap text-sm" style={{ fontFamily: 'inherit' }}>
            {fullText ?? ''}
          </pre>
        )}

        {view === 'summary' && summary && (
          <>
            {section('Discussed', summary.discussion.map((d) => ({ left: d.text, right: d.timestamp })))}
            {section('Decisions', summary.decisions.map((d) => ({ left: d.text, right: d.timestamp })))}
            {section(
              'Action items',
              summary.actionItems.map((a) => ({
                left: a.owner ? `${a.text} — ${a.owner}` : a.text,
                right: a.timestamp,
              })),
            )}
            {section(
              'Key numbers',
              summary.keyNumbers.map((k) => ({ left: `${k.label}: ${k.value}`, right: k.timestamp })),
            )}
            {summary.discussion.length === 0 &&
              summary.decisions.length === 0 &&
              summary.actionItems.length === 0 &&
              summary.keyNumbers.length === 0 && (
                <p className="mt-6 text-secondary">
                  Nothing could be summarised from this transcript.
                </p>
              )}
          </>
        )}

        {view === 'brief' && brief && (
          <>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h2 className="text-[11px] font-mono uppercase tracking-wider text-secondary mb-1">Client name</h2>
                <p className="text-lg">{brief.clientName || '—'}</p>
              </div>
              <div>
                <h2 className="text-[11px] font-mono uppercase tracking-wider text-secondary mb-1">Client niche / business</h2>
                <p className="text-lg">{brief.clientNiche || '—'}</p>
              </div>
            </div>

            {briefSection('What they want with their profile', brief.goals)}
            {briefSection('Niche targeting (content direction)', brief.contentDirection)}

            {(brief.audienceGeography || brief.audienceProfile) && (
              <section className="mt-6">
                <h2 className="text-[11px] font-mono uppercase tracking-wider text-secondary mb-2">Target audience</h2>
                {briefField('Geography', brief.audienceGeography)}
                {briefField('Profile', brief.audienceProfile)}
              </section>
            )}

            {briefSection('Creators / people they look up to', brief.creatorsAdmired)}
            {briefSection('Other notes from call', brief.otherNotes)}

            {!brief.clientName &&
              !brief.clientNiche &&
              brief.goals.length === 0 &&
              brief.contentDirection.length === 0 &&
              !brief.audienceGeography &&
              !brief.audienceProfile &&
              brief.creatorsAdmired.length === 0 &&
              brief.otherNotes.length === 0 && (
                <p className="mt-6 text-secondary">Nothing could be briefed from this transcript.</p>
              )}

            <footer className="mt-10 pt-4 border-t border-[rgba(var(--border-rgb),0.12)]">
              <p className="text-[11px] text-secondary">
                Blank sections = not mentioned on the call. Items marked{' '}
                <span style={{ color: 'var(--color-ai-tint)' }}>(assumed)</span> are inferred — confirm with the client.
              </p>
            </footer>
          </>
        )}
      </article>
    </div>
  )
}
