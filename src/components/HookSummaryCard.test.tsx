// @vitest-environment jsdom
/**
 * Render tests for HookSummaryCard — the creator-level hook summary shown for
 * single-handle profile runs.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { HookSummaryCard } from './HookSummaryCard'
import type { CreatorHookSummary } from '../ai/prompts/creatorHookSummary'

afterEach(cleanup)

describe('HookSummaryCard', () => {
  const mockSummary: CreatorHookSummary = {
    handle: 'test_creator',
    reelCount: 10,
    dominantHooks: [
      { pattern: 'Story hook', count: 5, example: 'This happened to me...' },
      { pattern: 'Question hook', count: 3, example: 'Have you ever...?' },
    ],
    recurringOpenings: ['This happened to me', 'You need to know'],
    whatConsistentlyWorks: ['Cliff hanger at 3 seconds', 'Pattern interrupts', 'Relatable narrative'],
    replicableTemplates: ['Story → Problem → Solution', 'Question → Reveal → CTA'],
    narrative: 'This creator excels at personal storytelling hooks that hook viewers instantly.',
    benchmarks: {
      medianViews: 150_000,
      medianLikes: 5_000,
      commentsLikesRatio: 0.15,
    },
  }

  it('renders the title with reel count', () => {
    render(<HookSummaryCard summary={mockSummary} />)
    expect(screen.getByText('Hook summary')).toBeTruthy()
    expect(screen.getByText('10 reels')).toBeTruthy()
  })

  it('renders the narrative text', () => {
    render(<HookSummaryCard summary={mockSummary} />)
    expect(screen.getByText(/This creator excels at personal storytelling/)).toBeTruthy()
  })

  it('renders dominant hooks with pattern, count, and example', () => {
    render(<HookSummaryCard summary={mockSummary} />)
    expect(screen.getByText('Story hook')).toBeTruthy()
    expect(screen.getAllByText(/This happened to me/).length).toBeGreaterThan(0)
    expect(screen.getByText('×5')).toBeTruthy()
  })

  it('renders whatConsistentlyWorks section with items', () => {
    render(<HookSummaryCard summary={mockSummary} />)
    expect(screen.getByText('What consistently works')).toBeTruthy()
    expect(screen.getByText('Cliff hanger at 3 seconds')).toBeTruthy()
    expect(screen.getByText('Pattern interrupts')).toBeTruthy()
  })

  it('renders replicableTemplates section with items', () => {
    render(<HookSummaryCard summary={mockSummary} />)
    expect(screen.getByText('Replicate')).toBeTruthy()
    expect(screen.getByText('Story → Problem → Solution')).toBeTruthy()
  })

  it('renders formatted benchmarks', () => {
    render(<HookSummaryCard summary={mockSummary} />)
    expect(screen.getByText('150.0K')).toBeTruthy() // median views formatted
    expect(screen.getByText('5.0K')).toBeTruthy() // median likes formatted
    expect(screen.getByText('15.0%')).toBeTruthy() // comments/likes ratio
  })

  it('renders recurring openings section when present', () => {
    render(<HookSummaryCard summary={mockSummary} />)
    expect(screen.getByText('Recurring openings')).toBeTruthy()
    expect(screen.getByText('This happened to me')).toBeTruthy()
  })

  it('skips sections with empty arrays', () => {
    const minimalSummary: CreatorHookSummary = {
      ...mockSummary,
      recurringOpenings: [],
      replicableTemplates: [],
    }
    render(<HookSummaryCard summary={minimalSummary} />)
    expect(screen.getByText('What consistently works')).toBeTruthy()
    // The empty sections should not render any heading
    const recurringHeadings = screen.queryAllByText('Recurring openings')
    expect(recurringHeadings.length).toBe(0)
    const replicateHeadings = screen.queryAllByText('Replicate')
    expect(replicateHeadings.length).toBe(0)
  })
})
