/**
 * Inline renderer for a finished repurpose run (kind:'repurpose'). Renders the full package —
 * spoken hook + 3 alt hooks, beat-by-beat script, caption, CTA, on-screen text — with per-section
 * copy buttons, plus a voice-profile mini-card linking to the Memory Voices tab.
 *
 * Color classes copied verbatim from ReelResultMessage.tsx:
 *   text-primary, text-secondary, text-muted, bg-surface, bg-surface-raised, text-ai-tint
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { RepurposeResultPayload } from '../domain/chat'

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="text-xs px-2 py-1 rounded-md border border-[rgba(var(--border-rgb),0.12)] text-muted hover:text-primary hover:border-accent transition-colors"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function Section({
  title,
  body,
  copy,
}: {
  title: string
  body: React.ReactNode
  copy?: string
}) {
  return (
    <div className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.08)] p-3">
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-sm font-medium text-primary">{title}</h4>
        {copy !== undefined && <CopyButton text={copy} />}
      </div>
      <div className="text-sm text-secondary whitespace-pre-wrap">{body}</div>
    </div>
  )
}

export default function RepurposeResultMessage({
  payload,
}: {
  payload: RepurposeResultPayload
}) {
  const { voiceProfile: v, rewrite: r } = payload
  const displayHandle = v.handle.replace('__scripts__', 'pasted ')

  const fullScript = [
    r.spokenHook,
    ...r.beatScript.map(
      (b) =>
        `[${b.beatLabel}] ${b.script}${b.onScreenText ? `  (on-screen: ${b.onScreenText})` : ''}`,
    ),
    r.cta,
  ].join('\n\n')

  // Voiceover-only: just the spoken lines in order — no beat labels, no on-screen text —
  // so it reads/records/copies as a clean teleprompter script. Falls back to hook + CTA
  // when there's no beat breakdown.
  const spokenLines = (
    r.beatScript.length > 0 ? r.beatScript.map((b) => b.script) : [r.spokenHook, r.cta]
  ).filter((s) => s.trim().length > 0)
  const spokenScript = spokenLines.join('\n\n')

  return (
    <div className="my-2 space-y-3">
      {/* Voice attribution mini-card */}
      <div className="text-xs text-muted">
        Repurposed in{' '}
        <span className="text-ai-tint">@{displayHandle}</span>'s voice
        {' · '}
        <Link to="/memory" className="underline hover:text-primary transition-colors">
          edit voice on Memory
        </Link>
      </div>

      {/* Voice profile summary row */}
      <div className="rounded-lg bg-surface border border-[rgba(var(--border-rgb),0.08)] px-3 py-2 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-primary truncate">
            {v.displayName || `@${displayHandle}`}
          </div>
          <div className="text-xs text-muted">
            {v.fromScripts ? 'From scripts' : `@${v.handle}`}
            {v.reelCount > 0 && ` · ${v.reelCount} reels`}
            {' · consistency '}
            {v.personaConsistencyScore}/10
          </div>
        </div>
        {v.toneDescriptors.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-end">
            {v.toneDescriptors.slice(0, 3).map((t, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full bg-surface-raised text-ai-tint"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Spoken hook */}
      <Section title="Spoken hook" body={r.spokenHook} copy={r.spokenHook} />

      {/* Alt hooks */}
      <Section
        title="Alt hooks (A/B)"
        copy={r.altHooks.join('\n')}
        body={
          <ol className="list-decimal ml-4 space-y-1">
            {r.altHooks.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        }
      />

      {/* Beat-by-beat script */}
      <Section
        title="Beat-by-beat script"
        copy={fullScript}
        body={
          r.beatScript.length > 0 ? (
            <ol className="space-y-4">
              {r.beatScript.map((b, i) => (
                <li key={i} className="relative pl-9">
                  {/* Beat number — DM Mono in a saffron chip, the structural anchor */}
                  <span className="absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(var(--accent-rgb),0.12)] font-mono text-[11px] tabular-nums text-accent-light">
                    {i + 1}
                  </span>
                  {/* Beat function — a quiet stage direction, not the line itself */}
                  {b.beatLabel && (
                    <div className="text-[11px] italic leading-snug text-muted mb-1">{b.beatLabel}</div>
                  )}
                  {/* The spoken line — the thing you actually read, so make it the focus */}
                  <p className="text-[15px] leading-relaxed text-primary">{b.script}</p>
                  {/* On-screen overlay — distinct violet callout (AI-generated → ai-tint) */}
                  {b.onScreenText && (
                    <div className="mt-2 flex items-start gap-2 rounded-md border border-[rgba(var(--ai-rgb),0.20)] bg-[rgba(var(--ai-rgb),0.10)] px-2.5 py-1.5">
                      <span className="shrink-0 mt-[3px] font-mono text-[10px] uppercase tracking-[0.1em] text-ai-tint">
                        on-screen
                      </span>
                      <span className="text-[13px] leading-snug text-ai-tint">{b.onScreenText}</span>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <span className="text-muted italic">No beat breakdown available.</span>
          )
        }
      />

      {/* Spoken script only — clean voiceover (no labels / on-screen text) for recording */}
      {spokenLines.length > 0 && (
        <Section
          title="Spoken script (voiceover)"
          copy={spokenScript}
          body={
            <div className="space-y-2.5">
              {spokenLines.map((line, i) => (
                <p key={i} className="text-[15px] leading-relaxed text-primary">
                  {line}
                </p>
              ))}
            </div>
          }
        />
      )}

      {/* Caption */}
      <Section title="Caption" body={r.caption} copy={r.caption} />

      {/* CTA */}
      <Section title="CTA" body={r.cta} copy={r.cta} />

      {/* On-screen text */}
      {r.onScreenText.length > 0 && (
        <Section
          title="On-screen text"
          copy={r.onScreenText.join('\n')}
          body={
            <ul className="list-disc ml-4 space-y-1">
              {r.onScreenText.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          }
        />
      )}

      {/* Source reel transcript — reference material, collapsed by default so the rewrite stays
          the focus. Already fetched in Stage 2; surfaced here so you can sanity-check the original. */}
      {payload.sourceTranscript && payload.sourceTranscript.trim().length > 0 && (
        <details className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.08)] p-3 [&::-webkit-details-marker]:hidden">
          <summary className="flex items-center justify-between cursor-pointer list-none text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
            <span>Source reel transcript</span>
            <span className="text-xs text-muted">tap to expand</span>
          </summary>
          <div className="mt-2 flex justify-end">
            <CopyButton text={payload.sourceTranscript} />
          </div>
          <p className="mt-1 text-sm text-secondary whitespace-pre-wrap leading-relaxed">
            {payload.sourceTranscript}
          </p>
        </details>
      )}
    </div>
  )
}
