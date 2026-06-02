// @vitest-environment jsdom
/**
 * Render tests for the deep-report surface in InlineReelResults: the deep grid
 * (done/analyzing/failed/skipped states + analysis fields) and the "Generate deep
 * report" CTA. The quick caption path stays renderable.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InlineReelResults } from './InlineReelResults'

// vitest config has no `globals: true`, so RTL's auto-cleanup isn't registered —
// unmount between tests manually or the DOM accumulates across cases.
afterEach(cleanup)
import type { CreatorAnalysisState, ReelData, ReelAnalysis, StoredDeepReelAnalysis } from '../store/reelAnalysisStore'
import type { DeepNicheReport } from '../ai/prompts/deepReelAnalysis'

const reel = (shortCode: string, views = 1000): ReelData => ({
  shortCode,
  url: `https://www.instagram.com/reel/${shortCode}/`,
  displayUrl: '',
  videoViewCount: views,
  likesCount: 100,
  commentsCount: 10,
  videoDuration: 20,
  caption: '',
  hashtags: [],
})

const deep = (over: Partial<StoredDeepReelAnalysis> = {}): StoredDeepReelAnalysis => ({
  hookArchetype: 'Curiosity gap',
  spokenHookVerbatim: 'wait for it',
  onScreenTextHook: '',
  visualOpening: 'a fast zoom onto a wall',
  hookBreakdown: 'opens mid-action',
  pacingEditing: 'fast cuts',
  audioStrategy: 'music',
  retentionMechanism: 'open loop',
  psychologyTrigger: 'curiosity',
  ctaType: 'none',
  ctaPlacement: 'none',
  replicationTemplate: 'Watch me [X]',
  whatToReplicate: 'the cold open',
  whatToAvoid: 'slow intro',
  hookScore: 8,
  commentsLikesRatio: 0.1,
  ...over,
})

const base = { synthesisStatus: 'idle' as const, synthesis: null, synthesisError: null }

describe('InlineReelResults — deep report', () => {
  it('renders the deep grid with per-reel status badges + analysis', () => {
    const creatorStates: Record<string, CreatorAnalysisState> = {
      nike: {
        handle: 'nike',
        status: 'done',
        reels: [reel('a'), reel('b'), reel('c'), reel('d')],
        analyses: {},
        deepStatus: { a: 'done', b: 'analyzing', c: 'failed', d: 'skipped' },
        deepAnalyses: { a: deep() },
      },
    }
    render(<InlineReelResults handles={['nike']} creatorStates={creatorStates} {...base} />)

    expect(screen.getByText(/1\/4 reels enriched/)).toBeTruthy()
    expect(screen.getByText('Curiosity gap')).toBeTruthy()
    expect(screen.getByText(/hook 8\/10/)).toBeTruthy()
    expect(screen.getByText(/wait for it/)).toBeTruthy()
    // status badges
    expect(screen.getByText('done')).toBeTruthy()
    expect(screen.getByText('analyzing…')).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('no video')).toBeTruthy()
  })

  it('shows the "Generate deep report" CTA on quick results and fires it', () => {
    const analyses: Record<string, ReelAnalysis> = {
      a: { hookArchetype: 'Curiosity gap', commentsLikesRatio: 0.1, retentionMechanism: 'r', psychologyTrigger: 'p', replicationTemplate: 't' },
    }
    const creatorStates: Record<string, CreatorAnalysisState> = {
      nike: { handle: 'nike', status: 'done', reels: [reel('a')], analyses },
    }
    const onDeepReport = vi.fn()
    render(<InlineReelResults handles={['nike']} creatorStates={creatorStates} {...base} onDeepReport={onDeepReport} />)

    const btn = screen.getByText(/Generate deep report/)
    fireEvent.click(btn)
    expect(onDeepReport).toHaveBeenCalledWith(['nike'])
  })

  it('hides the CTA once a deep run is active', () => {
    const creatorStates: Record<string, CreatorAnalysisState> = {
      nike: {
        handle: 'nike',
        status: 'analyzing',
        reels: [reel('a')],
        analyses: {},
        deepStatus: { a: 'analyzing' },
        deepAnalyses: {},
      },
    }
    render(<InlineReelResults handles={['nike']} creatorStates={creatorStates} {...base} onDeepReport={vi.fn()} />)
    expect(screen.queryByText(/Generate deep report/)).toBeNull()
  })
})

const report = (): DeepNicheReport => ({
  whoIsWinning: 'nike dominates with bold-claim hooks',
  nicheFormula: 'Open with a contrarian claim, pay it off in 3 seconds',
  gaps: ['underused: question hooks'],
  replicate: ['cold-open mid-action'],
  avoid: ['slow logo intros'],
  test: ['try a 1s pattern interrupt'],
  archetypeDistribution: [
    { archetype: 'Bold claim', count: 5 },
    { archetype: 'Curiosity gap', count: 3 },
  ],
  comparison: [{ handle: 'nike', reelCount: 8, avgHookScore: 7.5, medianViews: 12000, dominantArchetype: 'Bold claim' }],
  topExemplars: [{ handle: 'nike', shortCode: 'x', hookArchetype: 'Bold claim', hookScore: 9, spokenHookVerbatim: 'stop', visualOpening: 'a fast zoom', views: 50000 }],
})

describe('InlineReelResults — niche report (Phase 2)', () => {
  it('renders the report card: who-winning, formula, comparison row, replicate', () => {
    render(<InlineReelResults handles={[]} creatorStates={{}} {...base} deepReportStatus="done" deepReport={report()} />)
    expect(screen.getByText('Niche report')).toBeTruthy()
    expect(screen.getByText(/nike dominates/)).toBeTruthy()
    expect(screen.getByText(/Open with a contrarian claim/)).toBeTruthy()
    expect(screen.getByText('@nike')).toBeTruthy()
    expect(screen.getByText('cold-open mid-action')).toBeTruthy()
    expect(screen.getAllByText('Bold claim').length).toBeGreaterThan(0)
  })

  it('shows the running state', () => {
    render(<InlineReelResults handles={[]} creatorStates={{}} {...base} deepReportStatus="running" deepReport={null} />)
    expect(screen.getByText(/Synthesizing the niche report/)).toBeTruthy()
  })

  it('shows the failed state', () => {
    render(<InlineReelResults handles={[]} creatorStates={{}} {...base} deepReportStatus="failed" deepReport={null} />)
    expect(screen.getByText(/Niche report synthesis failed/)).toBeTruthy()
  })
})
