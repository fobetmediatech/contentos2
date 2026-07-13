import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ } }}
      className="inline-flex items-center gap-1 text-xs text-secondary hover:text-primary transition-colors"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">{label}</span>
        <CopyButton text={text} />
      </div>
      <p className="mt-1 text-sm text-primary whitespace-pre-wrap">{text}</p>
    </div>
  )
}

export function CreatorScriptResult({ result }: { result: ReelRewriteResult }) {
  return (
    <section className="rounded-xl border border-[rgba(var(--ai-rgb),0.30)] bg-[rgba(var(--ai-rgb),0.06)] p-4 space-y-4">
      <Field label="Hook" text={result.spokenHook} />
      {result.altHooks.some((h) => h.trim()) && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">Alt hooks</span>
          <ul className="mt-1 space-y-1 text-sm text-primary list-disc list-inside">
            {result.altHooks.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">Script</span>
        <ol className="mt-1 space-y-2">
          {result.beatScript.map((b, i) => (
            <li key={i} className="text-sm">
              <span className="text-[var(--color-ai-tint)] font-medium">{b.beatLabel}</span>
              <p className="text-primary">{b.script}</p>
              {b.onScreenText && <p className="text-muted text-xs mt-0.5">On-screen: {b.onScreenText}</p>}
            </li>
          ))}
        </ol>
      </div>
      <Field label="Caption" text={result.caption} />
      <Field label="CTA" text={result.cta} />
      {result.onScreenText.length > 0 && <Field label="On-screen text" text={result.onScreenText.join('\n')} />}
    </section>
  )
}
