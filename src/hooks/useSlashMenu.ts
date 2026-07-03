/**
 * useSlashMenu — the "/" tool-picker state machine for the chat input.
 *
 * State lives here but is owned by the ChatPage render tree (the hook is called
 * once from ChatPage). Splitting it out of the component keeps the flagged
 * Enter-still-sends regression path (plan-eng-review) unit-testable without
 * mounting the entire ChatPage hook tree (agent loop, query mutations, stores).
 *
 *   type "/"  ─────────────▶ menu opens, shows all tools
 *   type "/re" ────────────▶ filters to reel/repurpose/etc
 *   ArrowUp/Down ──────────▶ moves highlight (wraps)
 *   Enter (menu open) ─────▶ arms highlighted tool (onSelectCommand), NO send
 *   Enter (menu closed) ───▶ hook returns false → caller sends (regression path)
 *   Escape / blur ─────────▶ closes, keeps typed text
 *   backspace past "/" ────▶ closes (value no longer starts with "/")
 *
 * Escape-dismiss is sticky: typing more of the SAME slash string does not
 * reopen a menu the user closed — only clearing the "/" and typing a fresh one
 * reopens it.
 */

import { useState } from 'react'
import {
  CHAT_TOOL_COMMANDS,
  filterToolCommands,
  type ChatToolCommand,
} from '../shared/utils/toolCommands'

/**
 * Minimal structural shape of the keydown event the hook consumes. React's
 * KeyboardEvent satisfies this, and tests can pass a plain object.
 */
export interface SlashKeyEvent {
  key: string
  shiftKey: boolean
  preventDefault: () => void
}

interface UseSlashMenuParams {
  /** Current input value (the hook derives the query from its leading "/"). */
  inputText: string
  /** Setter used to update the value on change. */
  setInputText: (value: string) => void
  /** Whether the input is interactive; the menu never opens when false. */
  ready: boolean
  /**
   * Called when a command is chosen (click or Enter). ChatPage handles what
   * that means (arm the tool, clear the input, refocus) — the hook only closes
   * the menu. Keeps the hook free of tool-activation policy.
   */
  onSelectCommand: (command: ChatToolCommand) => void
}

export interface UseSlashMenu {
  /** Whether the menu should render right now. */
  open: boolean
  /** The filtered command list for the current query. */
  commands: ChatToolCommand[]
  /** Highlighted row index (keyboard selection). */
  highlightedIndex: number
  /** Sync the highlight to a row (used by mouse hover). */
  setHighlightedIndex: (index: number) => void
  /** Wrap the input's onChange — updates value and opens/closes the menu. */
  onInputChange: (value: string) => void
  /** Select a command: inserts its example and closes the menu. */
  onSelect: (command: ChatToolCommand) => void
  /** Force-close the menu (Escape handled internally; this is for blur/send). */
  close: () => void
  /**
   * Handle a keydown while the input is focused. Returns true when the menu
   * consumed the event (the caller MUST NOT send); false to let the caller's
   * own Enter-sends logic run.
   */
  handleKeyDown: (e: SlashKeyEvent) => boolean
}

export function useSlashMenu({
  inputText,
  setInputText,
  ready,
  onSelectCommand,
}: UseSlashMenuParams): UseSlashMenu {
  const [menuOpen, setMenuOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const query = inputText.startsWith('/') ? inputText.slice(1) : ''
  const commands = filterToolCommands(query, CHAT_TOOL_COMMANDS)
  const open = menuOpen && ready && inputText.startsWith('/')

  const onInputChange = (value: string) => {
    const wasSlash = inputText.startsWith('/')
    const isSlash = value.startsWith('/')
    setInputText(value)
    if (isSlash && ready) {
      // Only auto-open on the transition INTO slash mode, so a prior Escape
      // stays dismissed while the user keeps editing the same slash string.
      if (!wasSlash) setMenuOpen(true)
      setHighlightedIndex(0)
    } else {
      setMenuOpen(false)
    }
  }

  const close = () => setMenuOpen(false)

  const onSelect = (command: ChatToolCommand) => {
    setMenuOpen(false)
    onSelectCommand(command)
  }

  const handleKeyDown = (e: SlashKeyEvent): boolean => {
    if (!open) return false
    const n = commands.length
    if (e.key === 'Escape') {
      e.preventDefault()
      setMenuOpen(false)
      return true
    }
    if (n > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedIndex((i) => (i + 1) % n)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedIndex((i) => (i - 1 + n) % n)
        return true
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const command = commands[Math.min(highlightedIndex, n - 1)]
        if (command) onSelect(command)
        return true
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // No matches: swallow Enter (close menu) so a stray "/xyz" doesn't send;
      // a second Enter then sends normally.
      e.preventDefault()
      setMenuOpen(false)
      return true
    }
    return false
  }

  return {
    open,
    commands,
    highlightedIndex,
    setHighlightedIndex,
    onInputChange,
    onSelect,
    close,
    handleKeyDown,
  }
}
