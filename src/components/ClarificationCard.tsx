/**
 * ClarificationCard — mid-run niche refinement prompt.
 *
 * Shown between the discovery phase (steps 1–4) and the ranking phase (step 5).
 * Gemini generates a targeted question based on what it actually found in the
 * candidate pool; the user's answer is injected into the ranking prompt as
 * USER REFINEMENT context so Gemini prioritizes the correct sub-niche direction.
 *
 * "Looks right, proceed as-is" always appears as the last option and passes an
 * empty string as the answer — no refinement is applied, and existing nicheContext
 * (if any) is still used in the ranking prompt.
 */

import { Search } from 'lucide-react'
import type { ClarificationQuestion } from '../ai/prompts'
import { PROCEED_LABEL } from '../lib/constants'

interface ClarificationCardProps {
  question: ClarificationQuestion
  candidateCount: number
  onAnswer: (answer: string) => void
  disabled?: boolean
}

export function ClarificationCard({ question, candidateCount, onAnswer, disabled }: ClarificationCardProps) {
  return (
    <div className="w-full rounded-xl border border-[rgba(var(--accent-rgb),0.2)] bg-[rgba(var(--accent-rgb),0.06)] p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-full bg-[rgba(var(--accent-rgb),0.12)] flex items-center justify-center flex-shrink-0">
          <Search size={18} className="text-[var(--color-accent)]" />
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--color-accent)] uppercase tracking-wide font-mono">One quick check</p>
          <p className="text-sm text-secondary">
            Found <span className="font-semibold text-primary">{candidateCount}</span> candidate accounts
          </p>
        </div>
      </div>

      {/* Question */}
      <p className="text-base font-semibold text-primary mb-4">{question.question}</p>

      {/* Options */}
      <div className="flex flex-col gap-2">
        {question.options.map((option) => (
          <button
            key={option}
            onClick={() => onAnswer(option)}
            disabled={disabled}
            className="w-full text-left px-4 py-3 rounded-lg bg-surface border border-[rgba(var(--border-rgb),0.08)] text-sm text-primary font-medium hover:border-[var(--color-accent)] hover:bg-[rgba(var(--accent-rgb),0.06)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {option}
          </button>
        ))}

        {/* Always-present "proceed as-is" option */}
        <button
          onClick={() => onAnswer('')}
          disabled={disabled}
          className="w-full text-left px-4 py-3 rounded-lg bg-transparent border border-[rgba(var(--border-rgb),0.08)] border-dashed text-sm text-muted hover:text-secondary hover:border-[rgba(var(--border-rgb),0.15)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {PROCEED_LABEL}
        </button>
      </div>

      <p className="text-xs text-[var(--color-text-muted)] mt-3">
        Or type your own answer below and press Enter.
      </p>
    </div>
  )
}
