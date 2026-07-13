/**
 * SingleReelResultMessage — renders a finished single-reel case study from a persisted payload.
 *
 * Accepts a `payload: SingleReelResultPayload` prop (results-as-messages path).
 * Renders the case-study markdown + "Copy case study" + a collapsible transcript.
 *
 * The live progress for an in-flight single-reel run is now handled by RunCockpit /
 * the inline single-run progress row in ChatPage (registry-backed, Task 10).
 *
 * fawn #DFA477 is the primary accent; the violet AI tint marks the AI-generated header.
 */

import { useState } from 'react'
import { Bot, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import type { SingleReelResultPayload } from '../domain/chat'
import { CaseStudyMarkdown } from './markdown/CaseStudyMarkdown'
import { ReelTranscriptView } from './ReelTranscriptView'
import { GoogleExportButton } from './GoogleExportButton'

interface Props {
  payload: SingleReelResultPayload
}

export function SingleReelResultMessage({ payload }: Props) {
  const { result, shortCode } = payload

  const [showTranscript, setShowTranscript] = useState(false)
  const [copied, setCopied] = useState(false)

  const hasTranscript = result.transcript.trim().length > 0

  return (
    <div className="flex items-start gap-2">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(var(--ai-rgb),0.12)] flex items-center justify-center mt-0.5">
        <Bot size={14} className="text-[var(--color-ai-tint)]" />
      </div>
      <div className="flex flex-col gap-3 max-w-[80%] min-w-0">
        {/* Case study — markdown rendered with the themed renderer. */}
        <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(var(--border-rgb),0.08)]">
          <div className="flex items-center gap-2 mb-2">
            <Bot size={14} className="text-[var(--color-ai-tint)] flex-shrink-0" />
            <span className="font-semibold text-primary text-sm">Reel case study</span>
          </div>
          <CaseStudyMarkdown markdown={result.markdown} />
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(result.markdown)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-[rgba(var(--accent-rgb),0.12)] text-[var(--color-accent-light)] border border-[rgba(var(--accent-rgb),0.30)] hover:bg-[rgba(var(--accent-rgb),0.20)] transition-colors"
          >
            <Copy size={12} />
            {copied ? 'Copied' : 'Copy case study'}
          </button>
        </div>

        {/* Collapsible transcript */}
        {hasTranscript && (
          <div className="rounded-xl bg-surface border border-[rgba(var(--border-rgb),0.08)] overflow-hidden">
            <button
              onClick={() => setShowTranscript((v) => !v)}
              aria-expanded={showTranscript}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-surface-raised transition-colors"
            >
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted">Transcript</span>
              {showTranscript ? (
                <ChevronUp size={14} className="text-muted" />
              ) : (
                <ChevronDown size={14} className="text-muted" />
              )}
            </button>
            {showTranscript && (
              <div className="px-4 pb-3 pt-1 border-t border-[rgba(var(--border-rgb),0.08)]">
                <ReelTranscriptView result={result} />
              </div>
            )}
          </div>
        )}

        {/* Export — always at the bottom of the response */}
        <GoogleExportButton
          kind="doc"
          buildPayload={() => ({
            kind: 'doc',
            title: `Reel case study${shortCode ? ` — ${shortCode}` : ''}`,
            markdown: result.markdown,
          })}
        />
      </div>
    </div>
  )
}
