/**
 * ChatOptions — inline pill buttons for the confirming state direction choices.
 *
 * T16: Changed from full-width stacked buttons to inline pill layout.
 * Matches chat context without stretching the message bubble to full-width.
 *
 * T4: Uses PROCEED_LABEL from constants.ts (single source of truth).
 */

import { PROCEED_LABEL } from '../lib/constants'

interface ChatOptionsProps {
  options: string[]
  onSelect: (option: string) => void
  /** Disables all buttons once a selection has been made (prevents double-click). */
  disabled?: boolean
}

export function ChatOptions({ options, onSelect, disabled }: ChatOptionsProps) {
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {options.map((option) => {
        const isProceed = option === PROCEED_LABEL
        return (
          <button
            key={option}
            onClick={() => onSelect(option)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-full border text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isProceed
                ? 'border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700'
                : 'border-slate-200 text-slate-700 bg-white hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
