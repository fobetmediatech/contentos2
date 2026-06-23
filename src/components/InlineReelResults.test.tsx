// @vitest-environment jsdom
/**
 * Render tests for InlineReelResults: the single-handle case-study path and the
 * multi-handle quick-caption path.
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { ReactElement } from 'react'
import { render as rtlRender, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InlineReelResults } from './InlineReelResults'

// InlineReelResults may render a <Link> — wrap every render in a Router so any link
// has the context it needs.
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>)

// vitest config has no `globals: true`, so RTL's auto-cleanup isn't registered —
// unmount between tests manually or the DOM accumulates across cases.
afterEach(cleanup)
import type { CreatorAnalysisState, ReelData, ReelAnalysis } from '../store/reelAnalysisStore'

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

const base = { synthesisStatus: 'idle' as const, synthesis: null, synthesisError: null }

describe('InlineReelResults — single-handle case studies', () => {
  it('renders per-reel case-study cards for a single-handle run', () => {
    const creatorStates: Record<string, CreatorAnalysisState> = {
      nike: {
        handle: 'nike',
        status: 'done',
        reels: [reel('a')],
        analyses: {},
        caseStudyStatus: { a: 'done' },
        caseStudies: {
          a: {
            transcript: 'hello there',
            segments: [{ start: 0, text: 'hello there' }],
            videoAnalysis: {} as never,
            markdown: '## Why it worked',
          },
        },
      },
    }
    render(<InlineReelResults handles={['nike']} creatorStates={creatorStates} {...base} />)

    // Expand the creator section to reveal the per-reel cards.
    fireEvent.click(screen.getByText(/reels analyzed/))
    // Case-study markdown heading (the case-study card) — not the quick caption card.
    expect(screen.getByText('Why it worked')).toBeTruthy()
    expect(screen.getByText('Reel case study')).toBeTruthy()
  })

  it('still renders the quick ReelCards for a two-handle run', () => {
    const analyses: Record<string, ReelAnalysis> = {
      a: { hookArchetype: 'Curiosity gap', commentsLikesRatio: 0.1, retentionMechanism: 'r', psychologyTrigger: 'p', replicationTemplate: 't' },
    }
    const creatorStates: Record<string, CreatorAnalysisState> = {
      nike: { handle: 'nike', status: 'done', reels: [reel('a')], analyses },
      adidas: { handle: 'adidas', status: 'done', reels: [reel('b')], analyses: {} },
    }
    render(<InlineReelResults handles={['nike', 'adidas']} creatorStates={creatorStates} {...base} />)

    // Expand both creator sections.
    screen.getAllByText(/reels analyzed/).forEach((el) => fireEvent.click(el))
    // Quick card surfaces the hook archetype chip; no case-study heading.
    expect(screen.getByText('Curiosity gap')).toBeTruthy()
    expect(screen.queryByText('Reel case study')).toBeNull()
  })
})
