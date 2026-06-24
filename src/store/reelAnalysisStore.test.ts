import { describe, it, expect, beforeEach } from 'vitest'
import { useReelAnalysisStore } from './reelAnalysisStore'
import type { ReelData } from './reelAnalysisStore'

describe('reelAnalysisStore', () => {
  beforeEach(() => {
    useReelAnalysisStore.getState().reset()
  })

  it('initialState has all required fields', () => {
    const state = useReelAnalysisStore.getState()
    expect(state.selectedHandles).toEqual([])
    expect(state.creatorStates).toEqual({})
    expect(state.synthesisStatus).toBe('idle')
    expect(state.synthesis).toBeNull()
    expect(state.synthesisError).toBeNull()
  })

  it('reset() returns to initialState', () => {
    const store = useReelAnalysisStore.getState()
    store.setSelectedHandles(['user1', 'user2'])
    store.setCreatorState('user1', { handle: 'user1', status: 'done', reels: [], analyses: {} })
    store.setSynthesisStatus('running')
    store.reset()
    const after = useReelAnalysisStore.getState()
    expect(after.selectedHandles).toEqual([])
    expect(after.creatorStates).toEqual({})
    expect(after.synthesisStatus).toBe('idle')
    expect(after.synthesisError).toBeNull()
  })

  it('setCreatorState does deep merge — preserves existing reels when updating status', () => {
    const store = useReelAnalysisStore.getState()
    const mockReels: ReelData[] = [
      {
        shortCode: 'abc',
        url: '',
        displayUrl: '',
        videoViewCount: 1000,
        likesCount: 50,
        commentsCount: 5,
        videoDuration: 30,
        caption: 'test',
        hashtags: [],
      },
    ]
    store.setCreatorState('creator1', { handle: 'creator1', status: 'scraping', reels: [], analyses: {} })
    store.setCreatorState('creator1', { reels: mockReels, status: 'analyzing' })
    const state = useReelAnalysisStore.getState()
    // Both reels AND status should be present — not wiped
    expect(state.creatorStates['creator1'].reels).toHaveLength(1)
    expect(state.creatorStates['creator1'].status).toBe('analyzing')
    expect(state.creatorStates['creator1'].handle).toBe('creator1')  // not wiped by partial
  })

  it('CreatorStatus type includes no-reels', () => {
    const store = useReelAnalysisStore.getState()
    store.setCreatorState('creator1', { handle: 'creator1', status: 'no-reels', reels: [], analyses: {} })
    expect(useReelAnalysisStore.getState().creatorStates['creator1'].status).toBe('no-reels')
  })

  it('setSelectedHandles replaces the full array', () => {
    const store = useReelAnalysisStore.getState()
    store.setSelectedHandles(['a', 'b', 'c'])
    expect(useReelAnalysisStore.getState().selectedHandles).toEqual(['a', 'b', 'c'])
    store.setSelectedHandles(['x'])
    expect(useReelAnalysisStore.getState().selectedHandles).toEqual(['x'])
  })

  it('setSynthesisStatus updates synthesisStatus', () => {
    const store = useReelAnalysisStore.getState()
    store.setSynthesisStatus('running')
    expect(useReelAnalysisStore.getState().synthesisStatus).toBe('running')
  })

  it('setSynthesisError sets error and marks synthesisStatus as failed', () => {
    const store = useReelAnalysisStore.getState()
    store.setSynthesisError('Something went wrong')
    const state = useReelAnalysisStore.getState()
    expect(state.synthesisError).toBe('Something went wrong')
    expect(state.synthesisStatus).toBe('failed')
  })

  it('setSynthesis stores output and marks synthesisStatus as done', () => {
    const store = useReelAnalysisStore.getState()
    const output = {
      topPatterns: [{ archetype: 'hook', count: 3, example: 'abc' }],
      benchmarks: { medianViews: 5000, likesViewsRatio: 0.05, commentsLikesRatio: 0.1 },
      replicateTips: ['tip1', 'tip2', 'tip3'],
      avoidTips: ['avoid1', 'avoid2'],
    }
    store.setSynthesis(output)
    const state = useReelAnalysisStore.getState()
    expect(state.synthesis).toEqual(output)
    expect(state.synthesisStatus).toBe('done')
  })

  it('multiple creators can be tracked independently', () => {
    const store = useReelAnalysisStore.getState()
    store.setCreatorState('alice', { handle: 'alice', status: 'scraping', reels: [], analyses: {} })
    store.setCreatorState('bob', { handle: 'bob', status: 'done', reels: [], analyses: {} })
    const state = useReelAnalysisStore.getState()
    expect(state.creatorStates['alice'].status).toBe('scraping')
    expect(state.creatorStates['bob'].status).toBe('done')
  })
})

describe('setReelCaseStudy', () => {
  it('merges per-reel status and result into a creator without clobbering siblings', () => {
    const s = useReelAnalysisStore.getState()
    s.setCreatorState('alice', { handle: 'alice', status: 'analyzing', reels: [], analyses: {} })
    s.setReelCaseStudy('alice', 'r1', { status: 'analyzing' })
    s.setReelCaseStudy('alice', 'r2', { status: 'pending' })
    s.setReelCaseStudy('alice', 'r1', {
      status: 'done',
      result: { transcript: 't', segments: [], videoAnalysis: {} as never, markdown: '# m' },
    })
    const c = useReelAnalysisStore.getState().creatorStates['alice']
    expect(c.caseStudyStatus).toEqual({ r1: 'done', r2: 'pending' })
    expect(c.caseStudies?.r1?.markdown).toBe('# m')
    expect(c.caseStudies?.r2).toBeUndefined()
  })

  it('does nothing when the creator does not exist (never mints from a case-study update)', () => {
    useReelAnalysisStore.getState().setReelCaseStudy('ghost', 'r1', { status: 'done' })
    expect(useReelAnalysisStore.getState().creatorStates['ghost']).toBeUndefined()
  })
})
