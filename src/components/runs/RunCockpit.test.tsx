// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useRunsStore } from '../../store/runsStore'
import { RunCockpit } from './RunCockpit'

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))
afterEach(cleanup)

describe('RunCockpit', () => {
  it('renders nothing for a single active run', () => {
    useRunsStore.getState().createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'r', progress: 'x' })
    const { container } = render(<RunCockpit conversationId="c1" focusedKind={null} onFocusKind={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders two panes for two different-kind runs', () => {
    const s = useRunsStore.getState()
    s.createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'reel A', progress: 'Transcribing…' })
    s.createRun({ conversationId: 'c1', kind: 'single-reel', targetLabel: 'reel B', progress: 'Analysing…' })
    render(<RunCockpit conversationId="c1" focusedKind={null} onFocusKind={() => {}} />)
    expect(screen.getByText('reel A')).toBeTruthy()
    expect(screen.getByText('reel B')).toBeTruthy()
  })

  it('renders a counter pane for two same-kind runs', () => {
    const s = useRunsStore.getState()
    s.createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'reel A', progress: '' })
    s.createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'reel B', progress: '' })
    render(<RunCockpit conversationId="c1" focusedKind={null} onFocusKind={() => {}} />)
    expect(screen.getByText(/2 running/i)).toBeTruthy()
  })
})
