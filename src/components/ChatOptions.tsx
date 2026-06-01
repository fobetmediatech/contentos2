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
  /**
   * AD1: Optional label shown above the buttons.
   * Pass "Quick picks:" when the confirming state is active so users understand
   * the buttons and typed input are equivalent entry points.
   */
  label?: string
}

export function ChatOptions({ options, onSelect, disabled, label }: ChatOptionsProps) {
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      {label && (
        <p className="text-[11px] font-mono font-medium text-muted tracking-wide uppercase select-none">
          {label}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isProceed = option === PROCEED_LABEL
        return (
          <button
            key={option}
            onClick={() => onSelect(option)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-full border text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isProceed
                ? 'border-dashed border-[rgba(245,237,214,0.12)] text-muted hover:border-[rgba(245,237,214,0.2)] hover:text-secondary'
                : 'border-[rgba(245,237,214,0.10)] text-secondary bg-surface-raised hover:border-[#E07B3A] hover:text-[#F4A97B]'
            }`}
          >
            {option}
          </button>
        )
      })}
      </div>
    </div>
  )
}
