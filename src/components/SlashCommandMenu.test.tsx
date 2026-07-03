// @vitest-environment jsdom
/**
 * SlashCommandMenu tests — the presentational "/" tool picker. Covers row
 * rendering, the highlighted-row marker, the empty (no-match) state, and the
 * click/hover callbacks.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SlashCommandMenu } from './SlashCommandMenu'
import { CHAT_TOOL_COMMANDS } from '../shared/utils/toolCommands'

afterEach(cleanup)

const noop = () => {}

describe('SlashCommandMenu', () => {
  it('renders one row per command', () => {
    render(
      <SlashCommandMenu
        commands={CHAT_TOOL_COMMANDS}
        highlightedIndex={0}
        onSelect={noop}
        onHighlight={noop}
      />,
    )
    expect(screen.getAllByRole('option')).toHaveLength(6)
    expect(screen.getByText('Find competitors')).toBeTruthy()
    // The two previously-hidden tools must be visible here.
    expect(screen.getByText('Repurpose a reel')).toBeTruthy()
    expect(screen.getByText('Transcribe a reel')).toBeTruthy()
  })

  it('marks the highlighted row with aria-selected', () => {
    render(
      <SlashCommandMenu
        commands={CHAT_TOOL_COMMANDS}
        highlightedIndex={2}
        onSelect={noop}
        onHighlight={noop}
      />,
    )
    const options = screen.getAllByRole('option')
    expect(options[2].getAttribute('aria-selected')).toBe('true')
    expect(options[0].getAttribute('aria-selected')).toBe('false')
  })

  it('shows a no-match state when the list is empty', () => {
    render(
      <SlashCommandMenu commands={[]} highlightedIndex={0} onSelect={noop} onHighlight={noop} />,
    )
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matching tools')).toBeTruthy()
  })

  it('calls onSelect with the clicked command', () => {
    const onSelect = vi.fn()
    render(
      <SlashCommandMenu
        commands={CHAT_TOOL_COMMANDS}
        highlightedIndex={0}
        onSelect={onSelect}
        onHighlight={noop}
      />,
    )
    // Uses onMouseDown (not click) to fire before the textarea blur.
    fireEvent.mouseDown(screen.getByText('Discover by city'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].id).toBe('discover_by_location')
  })

  it('calls onHighlight with the hovered row index', () => {
    const onHighlight = vi.fn()
    render(
      <SlashCommandMenu
        commands={CHAT_TOOL_COMMANDS}
        highlightedIndex={0}
        onSelect={noop}
        onHighlight={onHighlight}
      />,
    )
    fireEvent.mouseEnter(screen.getByText('Break down hooks'))
    expect(onHighlight).toHaveBeenCalledWith(2)
  })
})
