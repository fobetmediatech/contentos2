// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PaneCounterList } from './PaneCounterList'
import type { RunRecord } from '../../domain/runs'

afterEach(cleanup)

const r = (id: string, status: RunRecord['status']): RunRecord =>
  ({ id, status, kind: 'transcript', conversationId: 'c1', progress: '', targetLabel: `reel ${id}`, startedAt: 0 })

describe('PaneCounterList', () => {
  it('renders a row per run and a running count badge', () => {
    render(<PaneCounterList runs={[r('1', 'running'), r('2', 'running')]} />)
    expect(screen.getByText(/2 running/i)).toBeTruthy()
    expect(screen.getByText('reel 1')).toBeTruthy()
    expect(screen.getByText('reel 2')).toBeTruthy()
  })
})
