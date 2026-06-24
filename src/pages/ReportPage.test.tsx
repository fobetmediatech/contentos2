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
import { summaryToMarkdown } from '../shared/utils/export'
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
    expect(screen.getByText(/Copy as Markdown/)).toBeTruthy()
    expect(screen.getByText(/Alice consistently uses bold claims/)).toBeTruthy()
    expect(screen.getByText('Bold claim')).toBeTruthy() // dominant hook pattern
  })

  it('also includes the individual reel case studies (for the page + PDF)', () => {
    useReelAnalysisStore.getState().setCreatorState('alice', {
      handle: 'alice',
      status: 'done',
      reels: [{ shortCode: 'r1', url: 'https://www.instagram.com/reel/r1/', displayUrl: '', videoViewCount: 1000, likesCount: 100, commentsCount: 10, videoDuration: 9, caption: 'c', hashtags: [] }],
      analyses: {},
      caseStudyStatus: { r1: 'done' },
      caseStudies: { r1: { transcript: 't', segments: [], videoAnalysis: {} as never, markdown: '## Why this reel worked' } },
    })
    useReelAnalysisStore.getState().setHookSummary('alice', summary)

    render(
      <MemoryRouter>
        <ReportPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('Reel-by-reel breakdown')).toBeTruthy()
    expect(screen.getByText('Why this reel worked')).toBeTruthy() // the per-reel case-study markdown
  })
})

describe('summaryToMarkdown', () => {
  it('serializes the hook summary into portable markdown', () => {
    const md = summaryToMarkdown(summary)
    expect(md).toContain('# @alice — Reel Hook Report')
    expect(md).toContain('_10 reels analyzed_')
    expect(md).toContain('> Alice consistently uses bold claims')
    expect(md).toContain('## Benchmarks')
    expect(md).toContain('Median views: 50,000')
    expect(md).toContain('## Dominant hooks')
    expect(md).toContain('**Bold claim** (5×)')
    expect(md).toContain('## Replicable templates')
  })

  it('omits empty sections', () => {
    const md = summaryToMarkdown({ ...summary, dominantHooks: [], replicableTemplates: [] })
    expect(md).not.toContain('## Dominant hooks')
    expect(md).not.toContain('## Replicable templates')
    expect(md).toContain('## What consistently works')
  })
})
