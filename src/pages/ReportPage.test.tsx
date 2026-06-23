// @vitest-environment jsdom
/**
 * ReportPage tests — empty state (no summary) + populated state (renders the hook summary
 * + Print button), reading from the real store.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

// Prevent the reelAnalysisStore's supabase-backed persist middleware from hitting the
// real Supabase client during tests (no auth → RLS violation).
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      upsert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}))
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReportPage } from './ReportPage'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import type { CreatorHookSummary } from '../ai/prompts/creatorHookSummary'

const summary: CreatorHookSummary = {
  handle: 'alice',
  reelCount: 10,
  dominantHooks: [
    { pattern: 'Bold claim', count: 5, example: 'This will shock you' },
  ],
  recurringOpenings: ['This will shock you', 'Never do this'],
  whatConsistentlyWorks: ['Opening with urgency', 'Visual hooks in first frame'],
  replicableTemplates: ['[Shocking claim] + [proof]', '[Question] → [answer]'],
  narrative: 'Alice consistently uses bold claims paired with visual shock to stop the scroll. Her opener sets expectations for value.',
  benchmarks: { medianViews: 50000, medianLikes: 2000, commentsLikesRatio: 0.15 },
}

beforeEach(() => useReelAnalysisStore.getState().reset())
afterEach(cleanup)

describe('ReportPage', () => {
  it('shows an empty state when there is no hook summary', () => {
    render(
      <MemoryRouter>
        <ReportPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/No report yet/)).toBeTruthy()
    expect(screen.getByText(/Go to chat/)).toBeTruthy()
  })

  it('renders the hook summary + Print button when a summary exists', () => {
    // Seed the store with a creator that has a hookSummary
    useReelAnalysisStore.getState().setCreatorState('alice', { handle: 'alice', status: 'done', reels: [], analyses: {} })
    useReelAnalysisStore.getState().setHookSummary('alice', summary)

    render(
      <MemoryRouter>
        <ReportPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('Reel Hook Report')).toBeTruthy()
    expect(screen.getByText(/Print \/ Save as PDF/)).toBeTruthy()
    expect(screen.getByText(/Alice consistently uses bold claims/)).toBeTruthy()
    expect(screen.getByText('Bold claim')).toBeTruthy() // dominant hook pattern
  })
})
