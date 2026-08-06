/**
 * StrategyDeckPage — renders the FOBET deck (/strategy/deck/:clientId, or `sample`).
 *
 * ponytail: the deck goes in an IFRAME, not dangerouslySetInnerHTML. The template ships global
 * rules (`*{}`, `body{}`, a fixed grid overlay) that would leak out and wreck the app's own
 * styling. srcDoc isolates it for free and makes browser print produce the deck alone.
 */
import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer, Sparkles, Loader2 } from 'lucide-react'
import { fillDeck, slotsFromBrief, type SlotKey } from '../lib/deckTemplate'
import { fillDeckSlots } from '../lib/meetingsClient'
import { SAMPLE_RESULT } from '../lib/sampleStrategy'
import { useStrategyStore } from '../store/strategyStore'
import { useMutation } from '@tanstack/react-query'

export function StrategyDeckPage() {
  const { clientId = '' } = useParams()
  const storeBrief = useStrategyStore((s) => s.brief)
  const storeResult = useStrategyStore((s) => s.result)
  const isSample = clientId === 'sample'
  const [aiSlots, setAiSlots] = useState<Partial<Record<SlotKey, string>>>({})

  const brief = isSample ? SAMPLE_RESULT.brief : storeBrief
  const doc = isSample ? SAMPLE_RESULT.doc : storeResult?.doc

  const fill = useMutation({
    mutationFn: () => fillDeckSlots(brief, doc),
    onSuccess: (r) => setAiSlots(r.slots),
  })

  // Slots the model has not written stay as the template's dashed blanks — that is how a
  // strategist sees what still needs writing, rather than reading filler as finished work.
  const html = useMemo(
    () => fillDeck({ ...slotsFromBrief(brief, new Date()), ...aiSlots }),
    [brief, aiSlots],
  )

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-3">
        <Link to="/strategy" className="inline-flex items-center gap-1.5 text-muted hover:text-primary text-sm">
          <ArrowLeft size={14} /> Strategy
        </Link>
        {isSample && (
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-warning)]">
            Preview · sample data
          </span>
        )}
        <button
          onClick={() => fill.mutate()}
          disabled={fill.isPending}
          className="ml-auto flex items-center gap-1.5 text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5 disabled:opacity-40"
        >
          {fill.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {fill.data ? 'Rewrite' : 'Write the blanks'}
        </button>
        <button
          onClick={() => document.querySelector('iframe')?.contentWindow?.print()}
          className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
        >
          <Printer size={14} /> Print / PDF
        </button>
      </div>

      {fill.isError && (
        <p className="text-[var(--color-error)] text-sm mb-2">Could not write the blanks — try again.</p>
      )}
      {fill.data && fill.data.blank.length > 0 && (
        <p className="text-muted text-xs mb-2">
          {fill.data.blank.length} slot(s) left blank — the model had nothing solid to say. Write those by hand.
        </p>
      )}

      <iframe
        title="Content strategy deck"
        srcDoc={html}
        className="w-full rounded-lg border border-[rgba(var(--border-rgb),0.12)] bg-white"
        style={{ height: 'calc(100dvh - 130px)' }}
      />
    </div>
  )
}
