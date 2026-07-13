import { useRef, useState } from 'react'
import { Wand2, Copy, Check, Loader2 } from 'lucide-react'
import { useReelRemix, type TranscribeResult } from '../hooks/useReelRemix'
import { friendlyError } from '../lib/errorMessages'
import type { TargetLanguage } from '../ai/prompts/reelRewrite'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

type Phase = 'input' | 'transcribing' | 'review' | 'generating' | 'result'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch { /* clipboard blocked — no-op */ }
      }}
      className="inline-flex items-center gap-1 text-xs text-secondary hover:text-primary transition-colors"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function ScriptStudioPage() {
  const { transcribe, generate } = useReelRemix()
  const abortRef = useRef<AbortController | null>(null)

  const [phase, setPhase] = useState<Phase>('input')
  const [url, setUrl] = useState('')
  const [ref_, setRef] = useState<TranscribeResult | null>(null)
  const [transcript, setTranscript] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [language, setLanguage] = useState<TargetLanguage>('english')
  const [clientHandle, setClientHandle] = useState('')
  const [pastedScripts, setPastedScripts] = useState('')
  const [rewrite, setRewrite] = useState<ReelRewriteResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = phase === 'transcribing' || phase === 'generating'

  const onFetch = async () => {
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setPhase('transcribing')
    try {
      const result = await transcribe(url.trim(), ac.signal)
      setRef(result)
      setTranscript(result.transcript)
      setPhase('review')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, (err as Error)?.message ?? 'Could not fetch that video.'))
      setPhase('input')
    }
  }

  const onGenerate = async () => {
    if (!ref_ || !newTopic.trim() || !transcript.trim()) return
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setPhase('generating')
    try {
      const scripts = pastedScripts.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
      const result = await generate(
        {
          source: ref_.source,
          editedTranscript: transcript,
          newTopic: newTopic.trim(),
          language,
          clientHandle: clientHandle.trim() || undefined,
          pastedScripts: scripts,
        },
        ac.signal,
      )
      setRewrite(result)
      setPhase('result')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, 'Could not generate the script.'))
      setPhase('review')
    }
  }

  const onReset = () => {
    abortRef.current?.abort()
    setPhase('input'); setUrl(''); setRef(null); setTranscript('')
    setNewTopic(''); setClientHandle(''); setPastedScripts(''); setRewrite(null); setError(null)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-6">
        <h1 className="font-serif italic text-3xl text-primary flex items-center gap-2">
          <Wand2 size={24} className="text-[var(--color-accent)]" /> Script Studio
        </h1>
        <p className="text-secondary text-sm mt-1">
          Paste a Reel or YouTube Short, add your new idea, and get a script in its exact style.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {/* Step 1 — Source URL */}
      <section className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 mb-4">
        <label className="block text-sm font-medium text-primary mb-2">Reference video URL</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="instagram.com/reel/… or youtube.com/shorts/…"
            disabled={phase !== 'input' && phase !== 'transcribing'}
            className="flex-1 rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="button"
            onClick={onFetch}
            disabled={!url.trim() || busy}
            className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {phase === 'transcribing' ? <Loader2 size={15} className="animate-spin" /> : null}
            {phase === 'transcribing' ? 'Transcribing…' : 'Fetch & Transcribe'}
          </button>
        </div>
      </section>

      {/* Step 2 — Review transcript + inputs */}
      {(phase === 'review' || phase === 'generating' || phase === 'result') && ref_ && (
        <section className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 mb-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-primary">
                Transcript <span className="text-muted font-normal">({ref_.platform})</span>
              </label>
              <span className="text-xs text-muted">Edit any mis-transcribed words</span>
            </div>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={6}
              className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-primary mb-1.5">Your new video idea</label>
            <input
              type="text"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              placeholder="e.g. how to save your first ₹1 lakh in your 20s"
              className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="block text-xs font-medium text-secondary mb-1.5">Language</span>
              <div className="inline-flex rounded-lg border border-[rgba(var(--border-rgb),0.12)] overflow-hidden">
                {(['english', 'hinglish'] as TargetLanguage[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLanguage(l)}
                    className={`px-3 py-1.5 text-sm capitalize ${
                      language === l ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-secondary mb-1.5">Client voice (optional)</label>
              <input
                type="text"
                value={clientHandle}
                onChange={(e) => setClientHandle(e.target.value)}
                placeholder="@handle — or paste scripts below"
                className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-secondary hover:text-primary">…or paste 2–3 of their scripts instead</summary>
            <textarea
              value={pastedScripts}
              onChange={(e) => setPastedScripts(e.target.value)}
              rows={4}
              placeholder="Paste scripts, separated by a blank line"
              className="mt-2 w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </details>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onGenerate}
              disabled={!newTopic.trim() || !transcript.trim() || busy}
              className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              {phase === 'generating' ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {phase === 'generating' ? 'Generating…' : 'Generate script'}
            </button>
            <button type="button" onClick={onReset} className="text-sm text-secondary hover:text-primary">
              Start over
            </button>
          </div>
        </section>
      )}

      {/* Step 3 — Result (violet AI tint) */}
      {phase === 'result' && rewrite && (
        <section className="rounded-xl border border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.06)] p-4 space-y-4">
          <ResultField label="Hook" text={rewrite.spokenHook} />
          {rewrite.altHooks.some((h) => h.trim()) && (
            <div>
              <FieldHeader label="Alt hooks" text={rewrite.altHooks.filter(Boolean).join('\n')} />
              <ul className="mt-1 space-y-1 text-sm text-primary list-disc list-inside">
                {rewrite.altHooks.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          )}
          <div>
            <FieldHeader label="Script" text={rewrite.beatScript.map((b) => b.script).join('\n\n')} />
            <ol className="mt-1 space-y-2">
              {rewrite.beatScript.map((b, i) => (
                <li key={i} className="text-sm">
                  <span className="text-[#A78BFA] font-medium">{b.beatLabel}</span>
                  <p className="text-primary">{b.script}</p>
                  {b.onScreenText && <p className="text-muted text-xs mt-0.5">On-screen: {b.onScreenText}</p>}
                </li>
              ))}
            </ol>
          </div>
          <ResultField label="Caption" text={rewrite.caption} />
          <ResultField label="CTA" text={rewrite.cta} />
          {rewrite.onScreenText.length > 0 && (
            <ResultField label="On-screen text" text={rewrite.onScreenText.join('\n')} />
          )}
        </section>
      )}
    </div>
  )
}

function FieldHeader({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#A78BFA]">{label}</span>
      <CopyButton text={text} />
    </div>
  )
}

function ResultField({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <FieldHeader label={label} text={text} />
      <p className="mt-1 text-sm text-primary whitespace-pre-wrap">{text}</p>
    </div>
  )
}
