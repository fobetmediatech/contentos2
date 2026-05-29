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
    <div className="w-full max-w-2xl mx-auto mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <Search size={18} className="text-indigo-600" />
        </div>
        <div>
          <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide">One quick check</p>
          <p className="text-sm text-indigo-800">
            Found <span className="font-semibold">{candidateCount}</span> candidate accounts
          </p>
        </div>
      </div>

      {/* Question */}
      <p className="text-base font-semibold text-slate-900 mb-4">{question.question}</p>

      {/* Options */}
      <div className="flex flex-col gap-2">
        {question.options.map((option) => (
          <button
            key={option}
            onClick={() => onAnswer(option)}
            disabled={disabled}
            className="w-full text-left px-4 py-3 rounded-lg bg-white border border-slate-200 text-sm text-slate-800 font-medium hover:border-indigo-400 hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {option}
          </button>
        ))}

        {/* Always-present "proceed as-is" option */}
        <button
          onClick={() => onAnswer('')}
          disabled={disabled}
          className="w-full text-left px-4 py-3 rounded-lg bg-transparent border border-slate-200 border-dashed text-sm text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {PROCEED_LABEL}
        </button>
      </div>
    </div>
  )
}
