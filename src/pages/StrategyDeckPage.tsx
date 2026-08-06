/**
 * StrategyDeckPage — renders the FOBET deck (/strategy/deck/:clientId, or `sample`).
 *
 * ponytail: the deck goes in an IFRAME, not dangerouslySetInnerHTML. The template ships global
 * rules (`*{}`, `body{}`, a fixed grid overlay) that would leak out and wreck the app's own
 * styling. srcDoc isolates it for free and makes browser print produce the deck alone.
 */
import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { fillDeck, slotsFromBrief } from '../lib/deckTemplate'
import { SAMPLE_RESULT } from '../lib/sampleStrategy'
import { useStrategyStore } from '../store/strategyStore'

export function StrategyDeckPage() {
  const { clientId = '' } = useParams()
  const storeBrief = useStrategyStore((s) => s.brief)
  const isSample = clientId === 'sample'

  const html = useMemo(() => {
    const brief = isSample ? SAMPLE_RESULT.brief : storeBrief
    // AI slots stay empty for now — they render as the template's dashed blanks, which is exactly
    // how a reviewer sees what still needs writing.
    return fillDeck(slotsFromBrief(brief, new Date()))
  }, [isSample, storeBrief])

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
          onClick={() => document.querySelector('iframe')?.contentWindow?.print()}
          className="ml-auto flex items-center gap-1.5 text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
        >
          <Printer size={14} /> Print / PDF
        </button>
      </div>

      <iframe
        title="Content strategy deck"
        srcDoc={html}
        className="w-full rounded-lg border border-[rgba(var(--border-rgb),0.12)] bg-white"
        style={{ height: 'calc(100dvh - 130px)' }}
      />
    </div>
  )
}
