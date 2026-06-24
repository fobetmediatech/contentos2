// @vitest-environment jsdom
/**
 * Render tests for ReelCaseStudyCard — the per-reel HookMap case-study card shown for
 * single-handle profile runs. Covers the in-progress state and the done state (markdown +
 * collapsible transcript toggle).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ReelCaseStudyCard } from './ReelCaseStudyCard'

const reel = {
  shortCode: 'r1',
  url: 'https://www.instagram.com/reel/r1/',
  displayUrl: '',
  videoViewCount: 1000,
  likesCount: 10,
  commentsCount: 1,
  videoDuration: 9,
  caption: 'c',
  hashtags: [],
}

afterEach(cleanup)

describe('ReelCaseStudyCard', () => {
  it('shows a pending/analyzing state while in progress', () => {
    render(<ReelCaseStudyCard reel={reel} status="analyzing" />)
    expect(screen.getByText(/analy/i)).toBeTruthy()
  })

  it('renders the case-study markdown when done and reveals the transcript on toggle', () => {
    render(
      <ReelCaseStudyCard
        reel={reel}
        status="done"
        result={{
          transcript: 'hello there',
          segments: [{ start: 0, text: 'hello there' }],
          videoAnalysis: {} as never,
          markdown: '## Why it worked',
        }}
      />,
    )
    expect(screen.getByText('Why it worked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /transcript/i }))
    expect(screen.getByText(/hello there/)).toBeTruthy()
  })
})
