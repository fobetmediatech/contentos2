/**
 * /ask — chat over ingested call transcripts.
 *
 * SCOPE is one discriminated value, not three code paths: a meeting, a client, or everything. The
 * server already treats a null clientId as "every client", so 'all' needs no special handling.
 *
 * `answer: null` is rendered as a normal assistant message, NOT an error toast. The server refuses
 * to call the model when nothing clears the similarity threshold, and that refusal is the feature —
 * these transcripts contain margins and ticket sizes, so a plausible invented figure is the worst
 * possible outcome.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bot, Send, User } from 'lucide-react'
import { askTranscripts, type AskCitation, type Turn } from '../lib/askClient'
import {
  listIngestedTranscripts,
  listClients,
  type IngestedTranscript,
  type ReviewClient,
} from '../lib/reviewRepo'

type Scope =
  | { kind: 'meeting'; transcriptId: string }
  | { kind: 'client'; clientId: string }
  | { kind: 'all' }

interface Msg {
  role: 'user' | 'assistant'
  content: string
  citations?: AskCitation[]
  interpretedAs?: string | null
  /** 'answer' = grounded reply · 'empty' = nothing relevant found · 'error' = the request failed */
  tone: 'answer' | 'empty' | 'error'
}

const fmtDate = (ms: number | null): string =>
  ms === null
    ? 'no date'
    : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export default function AskPage() {
  const [params, setParams] = useSearchParams()
  const [transcripts, setTranscripts] = useState<IngestedTranscript[]>([])
  const [clients, setClients] = useState<ReviewClient[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [scope, setScope] = useState<Scope>(() => {
    const t = params.get('transcript')
    const c = params.get('client')
    if (t) return { kind: 'meeting', transcriptId: t }
    if (c) return { kind: 'client', clientId: c }
    return { kind: 'all' }
  })

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([listIngestedTranscripts(), listClients()])
      .then(([t, c]) => {
        setTranscripts(t)
        setClients(c)
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load meetings'))
  }, [])

  // Changing scope starts a new thread. Follow-ups resolve against earlier turns, so carrying
  // history across a scope change would resolve a question against a meeting no longer selected.
  const changeScope = (next: Scope) => {
    setScope(next)
    setMessages([])
    setParams(
      next.kind === 'meeting'
        ? { transcript: next.transcriptId }
        : next.kind === 'client'
          ? { client: next.clientId }
          : {},
      { replace: true },
    )
  }

  const scopeLabel = useMemo(() => {
    if (scope.kind === 'meeting') {
      const t = transcripts.find((x) => x.id === scope.transcriptId)
      return t ? `${t.title ?? 'Untitled call'} — ${fmtDate(t.meetingDate)}` : 'this meeting'
    }
    if (scope.kind === 'client') {
      return clients.find((c) => c.id === scope.clientId)?.displayName ?? 'this client'
    }
    return 'every ingested call'
  }, [scope, transcripts, clients])

  const scopeReady =
    scope.kind === 'all' ||
    (scope.kind === 'meeting' ? scope.transcriptId !== '' : scope.clientId !== '')

  async function send() {
    const question = input.trim()
    if (!question || busy || !scopeReady) return
    setInput('')
    // Error and refusal text must never feed back into the rewrite prompt as if it were a real
    // answer — only grounded answers (and the user's own turns) belong in conversation history.
    const history: Turn[] = messages
      .filter((m) => m.role === 'user' || m.tone === 'answer')
      .map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, { role: 'user', content: question, tone: 'answer' }])
    setBusy(true)
    try {
      const r = await askTranscripts(
        question,
        scope.kind === 'meeting'
          ? { transcriptId: scope.transcriptId }
          : scope.kind === 'client'
            ? { clientId: scope.clientId }
            : {},
        history,
      )
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: r.answer ?? r.message ?? 'Nothing in the ingested transcripts covers that.',
          citations: r.citations,
          interpretedAs: r.interpretedAs,
          tone: r.answer === null ? 'empty' : 'answer',
        },
      ])
    } catch (e: unknown) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: e instanceof Error ? e.message : 'The request failed.', tone: 'error' },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-6 py-4 border-b border-[rgba(var(--border-rgb),0.12)]">
        <h1 className="text-2xl font-serif italic">Ask</h1>
        <p className="text-sm text-secondary mt-1">
          Answers come only from ingested call transcripts, with citations.
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {(['meeting', 'client', 'all'] as const).map((kind) => (
            <button
              key={kind}
              onClick={() => {
                // A tap on the already-active chip is a no-op — otherwise it silently resets a
                // deep-linked meeting/client selection to whatever is first in the list.
                if (scope.kind === kind) return
                changeScope(
                  kind === 'meeting'
                    ? { kind: 'meeting', transcriptId: transcripts[0]?.id ?? '' }
                    : kind === 'client'
                      ? { kind: 'client', clientId: clients[0]?.id ?? '' }
                      : { kind: 'all' },
                )
              }}
              className={`text-sm rounded-md px-3 py-1.5 border ${
                scope.kind === kind
                  ? 'border-[var(--color-accent)] text-primary'
                  : 'border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary'
              }`}
            >
              {kind === 'meeting' ? 'One meeting' : kind === 'client' ? 'One client' : 'Everything'}
            </button>
          ))}

          {scope.kind === 'meeting' && (
            <select
              aria-label="Meeting"
              value={scope.transcriptId}
              onChange={(e) => changeScope({ kind: 'meeting', transcriptId: e.target.value })}
              className="text-sm rounded-md px-3 py-1.5 bg-transparent border border-[rgba(var(--border-rgb),0.12)]"
            >
              {transcripts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title ?? 'Untitled call'} — {fmtDate(t.meetingDate)}
                </option>
              ))}
            </select>
          )}

          {scope.kind === 'client' && (
            <select
              aria-label="Client"
              value={scope.clientId}
              onChange={(e) => changeScope({ kind: 'client', clientId: e.target.value })}
              className="text-sm rounded-md px-3 py-1.5 bg-transparent border border-[rgba(var(--border-rgb),0.12)]"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          )}

          {scope.kind === 'meeting' && scope.transcriptId && (
            <>
              <a
                href={`/print/meeting/${scope.transcriptId}`}
                className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
              >
                Summary PDF
              </a>
              <a
                href={`/print/meeting/${scope.transcriptId}?view=transcript`}
                className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
              >
                Transcript PDF
              </a>
            </>
          )}
        </div>

        {loadError && <p className="text-sm text-secondary mt-2">Could not load meetings: {loadError}</p>}
        {!loadError && transcripts.length === 0 && (
          <p className="text-sm text-secondary mt-2">
            No calls ingested yet. Ingest one from Strategy first — this list only shows calls the bot can read.
          </p>
        )}
        {!scopeReady && (
          <p className="text-sm text-secondary mt-2">
            {scope.kind === 'meeting'
              ? 'No meetings available to select.'
              : 'No clients available to select.'}
          </p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && <p className="text-sm text-secondary">Ask anything about {scopeLabel}.</p>}
        {messages.map((m, i) => (
          <div key={i}>
            {m.role === 'user' ? (
              <div className="flex items-end justify-end gap-2">
                <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-[var(--color-accent)] text-white text-sm leading-relaxed">
                  {m.content}
                </div>
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center">
                  <User size={14} className="text-secondary" />
                </div>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(var(--accent-rgb),0.12)] flex items-center justify-center">
                  <Bot size={14} className="text-[var(--color-accent)]" />
                </div>
                <div className="flex flex-col gap-2 max-w-[80%]">
                  <div
                    className={`px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed whitespace-pre-wrap ${
                      m.tone === 'error'
                        ? 'bg-[rgba(224,92,92,0.1)] border border-[rgba(224,92,92,0.2)] text-danger'
                        : m.tone === 'answer'
                          ? 'bg-surface border border-[rgba(var(--border-rgb),0.08)] border-l-2 border-l-[var(--color-ai-tint)] text-primary'
                          : 'bg-surface border border-[rgba(var(--border-rgb),0.08)] text-primary'
                    }`}
                  >
                    {m.tone === 'error' && (
                      <p className="text-xs mb-1" style={{ color: 'var(--color-error)' }}>
                        Request failed
                      </p>
                    )}
                    {m.interpretedAs && <p className="text-xs text-secondary mb-1">Read as: {m.interpretedAs}</p>}
                    {m.content}
                    {m.citations && m.citations.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {m.citations.map((c) => (
                          <li key={c.chunkId} className="text-xs text-secondary">
                            <span style={{ fontFamily: 'DM Mono, monospace' }}>{c.timestamp}</span>
                            {' · '}
                            {c.meeting ?? 'unknown call'}
                            {c.speaker ? ` · ${c.speaker}` : ''}
                            <span className="block opacity-80">"{c.quote}"</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-secondary">Reading the transcripts…</p>}
      </div>

      <div className="px-6 py-4 border-t border-[rgba(var(--border-rgb),0.12)] flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={`Ask about ${scopeLabel}`}
          aria-label="Your question"
          className="flex-1 bg-transparent border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-2 text-primary"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !input.trim() || !scopeReady}
          className="rounded-md px-4 py-2 border border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary disabled:opacity-40"
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
