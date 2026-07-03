// @vitest-environment jsdom
/**
 * useSlashMenu tests — the "/" tool-picker state machine.
 *
 * Driven through a small harness that pairs real useState (inputText) with the
 * hook, so trigger detection, keyboard delegation, and selection are exercised
 * exactly as ChatPage wires them — but without mounting ChatPage's full hook
 * tree. The Enter-still-sends regression (plan-eng-review REGRESSION RULE) is
 * the headline case: handleKeyDown must return false when the menu is closed.
 */

import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { renderHook, act } from '@testing-library/react'
import { useSlashMenu, type SlashKeyEvent } from './useSlashMenu'
import type { ChatToolCommand } from '../shared/utils/toolCommands'

/** A harness mirroring ChatPage: local inputText state + the slash hook. */
function useHarness(ready = true, onSelectCommand: (c: ChatToolCommand) => void = () => {}) {
  const [inputText, setInputText] = useState('')
  const slash = useSlashMenu({ inputText, setInputText, ready, onSelectCommand })
  return { inputText, ...slash }
}

/** Build a fake keydown event with a spy-able preventDefault. */
function key(k: string, shiftKey = false) {
  return { key: k, shiftKey, preventDefault: vi.fn() } satisfies SlashKeyEvent
}

describe('useSlashMenu — trigger detection', () => {
  it('opens and shows all six tools when "/" is typed into an empty input', () => {
    const { result } = renderHook(() => useHarness())
    expect(result.current.open).toBe(false)
    act(() => result.current.onInputChange('/'))
    expect(result.current.open).toBe(true)
    expect(result.current.commands).toHaveLength(6)
  })

  it('filters as more of the query is typed', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/'))
    act(() => result.current.onInputChange('/transcribe'))
    expect(result.current.open).toBe(true)
    expect(result.current.commands.map((c) => c.id)).toEqual(['get_reel_transcript'])
  })

  it('does NOT open when "/" appears mid-message', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('analyze this/that'))
    expect(result.current.open).toBe(false)
  })

  it('closes when the leading "/" is backspaced away', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/re'))
    expect(result.current.open).toBe(true)
    act(() => result.current.onInputChange(''))
    expect(result.current.open).toBe(false)
  })

  it('never opens when the input is not ready', () => {
    const { result } = renderHook(() => useHarness(false))
    act(() => result.current.onInputChange('/'))
    expect(result.current.open).toBe(false)
  })
})

describe('useSlashMenu — keyboard navigation', () => {
  it('ArrowDown moves the highlight and wraps around', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/')) // 6 items, highlight 0
    act(() => {
      result.current.handleKeyDown(key('ArrowDown'))
    })
    expect(result.current.highlightedIndex).toBe(1)
    // Jump to the last item then wrap to 0.
    act(() => result.current.setHighlightedIndex(5))
    act(() => {
      result.current.handleKeyDown(key('ArrowDown'))
    })
    expect(result.current.highlightedIndex).toBe(0)
  })

  it('ArrowUp wraps from the first item to the last', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/'))
    act(() => {
      result.current.handleKeyDown(key('ArrowUp'))
    })
    expect(result.current.highlightedIndex).toBe(5)
  })

  it('nav keys consume the event (return true, preventDefault called)', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/'))
    const e = key('ArrowDown')
    let consumed = false
    act(() => {
      consumed = result.current.handleKeyDown(e)
    })
    expect(consumed).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
  })
})

describe('useSlashMenu — selection', () => {
  it('Enter arms the highlighted command (via onSelectCommand) and closes, without touching input text', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() => useHarness(true, onSelect))
    act(() => result.current.onInputChange('/'))
    act(() => {
      result.current.handleKeyDown(key('ArrowDown')) // highlight index 1 = discover_by_location
    })
    let consumed = false
    act(() => {
      consumed = result.current.handleKeyDown(key('Enter'))
    })
    expect(consumed).toBe(true)
    expect(result.current.open).toBe(false)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].id).toBe('discover_by_location')
    // The hook must NOT prefill the input — ChatPage clears it when arming.
    expect(result.current.inputText).toBe('/')
  })

  it('clicking (onSelect) fires onSelectCommand and closes', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() => useHarness(true, onSelect))
    act(() => result.current.onInputChange('/'))
    const repurpose = result.current.commands.find((c) => c.id === 'repurpose_reel')!
    act(() => result.current.onSelect(repurpose))
    expect(onSelect).toHaveBeenCalledWith(repurpose)
    expect(result.current.open).toBe(false)
  })
})

describe('useSlashMenu — dismissal', () => {
  it('Escape closes the menu but keeps the typed text', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/re'))
    act(() => {
      result.current.handleKeyDown(key('Escape'))
    })
    expect(result.current.open).toBe(false)
    expect(result.current.inputText).toBe('/re')
  })

  it('stays dismissed while typing more of the same slash string (Escape is sticky)', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/re'))
    act(() => {
      result.current.handleKeyDown(key('Escape'))
    })
    act(() => result.current.onInputChange('/ree'))
    expect(result.current.open).toBe(false)
  })

  it('close() force-closes the menu (used by blur / send)', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/'))
    expect(result.current.open).toBe(true)
    act(() => result.current.close())
    expect(result.current.open).toBe(false)
  })
})

describe('useSlashMenu — send-path preservation (REGRESSION)', () => {
  it('returns false for Enter when the menu is closed, so the caller still sends', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('hello world'))
    expect(result.current.open).toBe(false)
    const e = key('Enter')
    let consumed = true
    act(() => {
      consumed = result.current.handleKeyDown(e)
    })
    // Hook did NOT consume the event and did NOT preventDefault — the textarea's
    // own Enter-sends logic runs untouched.
    expect(consumed).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('swallows Enter (returns true) when the menu is open with zero matches', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/zzzznope'))
    expect(result.current.open).toBe(true)
    expect(result.current.commands).toHaveLength(0)
    const e = key('Enter')
    let consumed = false
    act(() => {
      consumed = result.current.handleKeyDown(e)
    })
    // First Enter closes the no-match menu instead of sending "/zzzznope".
    expect(consumed).toBe(true)
    expect(result.current.open).toBe(false)
  })

  it('returns false for non-nav keys even when the menu is open', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.onInputChange('/'))
    const e = key('a')
    let consumed = true
    act(() => {
      consumed = result.current.handleKeyDown(e)
    })
    expect(consumed).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})
