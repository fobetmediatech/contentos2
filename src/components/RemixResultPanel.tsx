import { useState } from 'react'
import { Copy, Check, RotateCw, Loader2, AlertCircle } from 'lucide-react'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'
import { fieldKey, type FieldRef } from '../lib/remixFields'

export type VariationSlot = { status: 'pending' | 'done' | 'failed'; result: ReelRewriteResult | null }

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

function RegenButton({ field, regeneratingKey, onRegenerate }: { field: FieldRef; regeneratingKey: string | null; onRegenerate: (f: FieldRef) => void }) {
  const busy = regeneratingKey === fieldKey(field)
  return (
    <button
      type="button"
      onClick={() => onRegenerate(field)}
      disabled={regeneratingKey !== null}
      title="Regenerate this"
      className="inline-flex items-center gap-1 text-xs text-secondary hover:text-[var(--color-ai-tint)] disabled:opacity-40 transition-colors"
    >
      <RotateCw size={13} className={busy ? 'animate-spin' : undefined} />
    </button>
  )
}

function FieldRow({ label, text, field, regeneratingKey, onRegenerate }: {
  label: string; text: string; field: FieldRef; regeneratingKey: string | null; onRegenerate: (f: FieldRef) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">{label}</span>
        <span className="flex items-center gap-2">
          <RegenButton field={field} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
          <CopyButton text={text} />
        </span>
      </div>
      <p className="mt-1 text-sm text-primary whitespace-pre-wrap">{text}</p>
    </div>
  )
}

export function RemixResultPanel({ slots, activeIndex, onSelect, regeneratingKey, onRegenerate, onRetry }: {
  slots: VariationSlot[]
  activeIndex: number
  onSelect: (i: number) => void
  regeneratingKey: string | null
  onRegenerate: (f: FieldRef) => void
  onRetry: (i: number) => void
}) {
  const active = slots[activeIndex]
  return (
    <section className="rounded-xl border border-[rgba(var(--ai-rgb),0.30)] bg-[rgba(var(--ai-rgb),0.06)] p-4 space-y-4">
      {/* Variation tabs */}
      <div className="flex items-center gap-1">
        {slots.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
              i === activeIndex ? 'bg-[rgba(var(--ai-rgb),0.18)] text-[var(--color-ai-tint)]' : 'text-secondary hover:text-primary'
            }`}
          >
            Variation {i + 1}
            {s.status === 'pending' && <Loader2 size={12} className="animate-spin" />}
            {s.status === 'failed' && <AlertCircle size={12} className="text-red-400" />}
          </button>
        ))}
      </div>

      {active.status === 'pending' && <p className="text-sm text-secondary">Writing this variation…</p>}
      {active.status === 'failed' && (
        <div className="text-sm text-secondary">
          This variation failed.{' '}
          <button type="button" onClick={() => onRetry(activeIndex)} className="text-[var(--color-accent)] hover:underline">Retry</button>
        </div>
      )}

      {active.status === 'done' && active.result && (
        <div className="space-y-4">
          <FieldRow label="Hook" text={active.result.spokenHook} field={{ kind: 'hook' }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
          {active.result.altHooks.some((h) => h.trim()) && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">Alt hooks</span>
              <ul className="mt-1 space-y-1 text-sm text-primary list-disc list-inside">
                {active.result.altHooks.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          )}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">Script</span>
            <ol className="mt-1 space-y-2">
              {active.result.beatScript.map((b, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-ai-tint)] font-medium">{b.beatLabel}</span>
                    <RegenButton field={{ kind: 'beatScript', i }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
                  </div>
                  <p className="text-primary">{b.script}</p>
                  {b.onScreenText && (
                    <p className="text-muted text-xs mt-0.5 flex items-center gap-2">
                      <span>On-screen: {b.onScreenText}</span>
                      <RegenButton field={{ kind: 'beatOverlay', i }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
          <FieldRow label="Caption" text={active.result.caption} field={{ kind: 'caption' }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
          <FieldRow label="CTA" text={active.result.cta} field={{ kind: 'cta' }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
          {active.result.onScreenText.length > 0 && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai-tint)]">On-screen text</span>
              <ul className="mt-1 space-y-1">
                {active.result.onScreenText.map((t, j) => (
                  <li key={j} className="text-sm text-primary flex items-center justify-between gap-2">
                    <span>{t}</span>
                    <RegenButton field={{ kind: 'onScreen', j }} regeneratingKey={regeneratingKey} onRegenerate={onRegenerate} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
