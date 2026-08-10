/**
 * StrategyDeckPage — the deck on its own route (/strategy/deck/:clientId, or `sample`).
 *
 * Rendering lives in <FobetDeck> so this and the form (/strategy/brief) cannot drift apart.
 */
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { FobetDeck } from '../components/FobetDeck'
import { SAMPLE_RESULT } from '../lib/sampleStrategy'
import { useStrategyStore } from '../store/strategyStore'

export function StrategyDeckPage() {
  const { clientId = '' } = useParams()
  const storeResult = useStrategyStore((s) => s.result)
  const isSample = clientId === 'sample'
  const result = isSample ? SAMPLE_RESULT : storeResult

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
      </div>

      {result ? (
        <FobetDeck result={result} />
      ) : (
        <p className="text-secondary text-sm py-16 text-center">
          No strategy generated yet.{' '}
          <Link to="/strategy/brief" className="text-[var(--color-accent)] hover:underline">Start from the brief</Link>.
        </p>
      )}
    </div>
  )
}
