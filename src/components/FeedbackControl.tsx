/**
 * FeedbackControl — the Phase 3 capture surface (self-training signal).
 *
 * Two toggle buttons (save / dismiss) wired straight to the corpus store. Reads the creator's
 * current verdict synchronously from the store mirror, writes through `setFeedback` on click
 * (toggling per `nextFeedback`, so tapping the active verdict clears it). Every click
 * stopPropagation()s so it never also toggles the card's selection. Self-contained — drop it
 * on any card that has a username.
 *
 * Palette (DESIGN.md): "saved" uses saffron, the brand active-state colour; "dismissed" uses a
 * calm muted treatment — a downrank, not an error, so no alarming red.
 */

import type { MouseEvent } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { useCorpusStore } from '../store/corpusStore'
import { nextFeedback, type Feedback } from '../lib/corpus'

interface Props {
  username: string
  /** Layout classes from the parent card (e.g. alignment). */
  className?: string
}

export function FeedbackControl({ username, className = '' }: Props) {
  const current = useCorpusStore((s) => s.creators[username]?.feedback)

  const set = (clicked: Feedback) => (e: MouseEvent) => {
    e.stopPropagation() // never let a verdict tap also toggle card selection
    void useCorpusStore.getState().setFeedback(username, nextFeedback(current, clicked), Date.now())
  }

  const base = 'p-1.5 rounded-lg transition-colors'
  const idle = 'text-[#7A6A54] hover:text-[#C4A882] hover:bg-[#3D3025]'

  return (
    <div className={`inline-flex items-center gap-1 ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={set('saved')}
        aria-pressed={current === 'saved'}
        aria-label="Save — show more creators like this"
        title="Save — more like this"
        className={`${base} ${current === 'saved' ? 'bg-[rgba(224,123,58,0.15)] text-[#E07B3A]' : idle}`}
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        onClick={set('dismissed')}
        aria-pressed={current === 'dismissed'}
        aria-label="Dismiss — show fewer creators like this"
        title="Dismiss — less like this"
        className={`${base} ${current === 'dismissed' ? 'bg-[#3D3025] text-[#C4A882]' : idle}`}
      >
        <ThumbsDown size={14} />
      </button>
    </div>
  )
}
