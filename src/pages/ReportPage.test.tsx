// @vitest-environment jsdom
/**
 * ReportPage tests — empty state (no report) + populated state (renders the report
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
import type { DeepNicheReport } from '../ai/prompts/deepReelAnalysis'

const report: DeepNicheReport = {
  whoIsWinning: 'nike wins with bold claims',
  nicheFormula: 'open with a bold claim',
  gaps: ['underused: questions'],
  replicate: ['cold-open'],
  avoid: ['slow intros'],
  test: ['1s pattern interrupt'],
  archetypeDistribution: [{ archetype: 'Bold claim', count: 5 }],
  comparison: [{ handle: 'nike', reelCount: 8, avgHookScore: 7.5, medianViews: 12000, dominantArchetype: 'Bold claim' }],
  topExemplars: [{ handle: 'nike', shortCode: 'x', hookArchetype: 'Bold claim', hookScore: 9, spokenHookVerbatim: 'stop', visualOpening: 'zoom', views: 50000 }],
}

beforeEach(() => useReelAnalysisStore.getState().reset())
afterEach(cleanup)

describe('ReportPage', () => {
  it('shows an empty state when there is no report', () => {
    render(
      <MemoryRouter>
        <ReportPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/No report yet/)).toBeTruthy()
    expect(screen.getByText(/Go to chat/)).toBeTruthy()
  })

  it('renders the report + Print button when a report exists', () => {
    useReelAnalysisStore.getState().setDeepReport(report)
    render(
      <MemoryRouter>
        <ReportPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('Niche Report')).toBeTruthy()
    expect(screen.getByText(/Print \/ Save as PDF/)).toBeTruthy()
    expect(screen.getByText(/nike wins with bold claims/)).toBeTruthy()
    expect(screen.getByText('@nike')).toBeTruthy() // comparison table row from DeepReportCard
  })
})
