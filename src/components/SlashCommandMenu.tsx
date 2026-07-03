/**
 * SlashCommandMenu — the "/" tool picker that floats above the chat input.
 *
 * Purely presentational: it renders whatever filtered command list it's handed
 * and reports clicks/hovers upward. It owns NO keyboard state — ChatPage lifts
 * `highlightedIndex` and the open/closed decision, and drives Arrow/Enter/Escape
 * through the textarea's existing keydown handler. This keeps a single source of
 * truth for keyboard state (see plan-eng-review Issue 1) instead of a second
 * document-level listener racing the textarea.
 *
 *   ┌─ SlashCommandMenu (absolute, bottom-full) ─┐
 *   │  Find competitors     see who's winning     │ ← highlightedIndex row
 *   │  Discover by city     creators in a place    │
 *   │  …                                           │
 *   └──────────────────────────────────────────────┘
 *   ┌─ textarea (relative wrapper) ────────────────┐
 *   │ /re|                                          │
 *   └──────────────────────────────────────────────┘
 */

import type { ChatToolCommand } from '../shared/utils/toolCommands'

interface SlashCommandMenuProps {
  /** The already-filtered commands to show. Empty array renders the no-match state. */
  commands: ChatToolCommand[]
  /** Index of the highlighted row (keyboard selection). Ignored when commands is empty. */
  highlightedIndex: number
  /** Fired when a row is clicked or Enter-selected upstream. */
  onSelect: (command: ChatToolCommand) => void
  /** Fired on mouse hover so the keyboard highlight follows the pointer. */
  onHighlight: (index: number) => void
}

export function SlashCommandMenu({
  commands,
  highlightedIndex,
  onSelect,
  onHighlight,
}: SlashCommandMenuProps) {
  return (
    // z-50 sits above the "Jump to latest" button (z-40) so the two never
    // collide when both are visible (plan-eng-review Issue 2).
    <div
      role="listbox"
      aria-label="Tool commands"
      className="absolute bottom-full left-0 right-0 mb-2 z-50 max-h-64 overflow-y-auto rounded-2xl border border-[rgba(var(--border-rgb),0.12)] bg-[var(--color-surface-elevated)] shadow-lg py-1.5"
    >
      {commands.length === 0 ? (
        <div className="px-3.5 py-2.5 text-sm text-muted">No matching tools</div>
      ) : (
        commands.map((command, index) => {
          const active = index === highlightedIndex
          return (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={active}
              // onMouseDown (not onClick) so selection fires before the textarea
              // blur that a click would otherwise trigger, keeping focus in the input.
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(command)
              }}
              onMouseEnter={() => onHighlight(index)}
              className={`w-full text-left px-3.5 py-2 transition-colors ${
                active ? 'bg-[var(--color-surface-raised)]' : 'hover:bg-[var(--color-surface-raised)]'
              }`}
            >
              <span className="block text-xs font-semibold text-[var(--color-accent-light)]">
                {command.label}
              </span>
              <span className="block text-[11px] text-muted mt-0.5">{command.hint}</span>
            </button>
          )
        })
      )}
    </div>
  )
}
