// @vitest-environment jsdom
/**
 * Regression test for the scrape-blocked web fallback (Apify down → rank from web search).
 *
 * THE BUG this guards against: when the Apify scrape hits the internal 150s timeout, the run's
 * abort signal is ALREADY aborted (that timeout is what killed the scrape). The first version of
 * the fallback handed that same dead signal to the web-search call, so the grounded fetch aborted
 * instantly, returned nothing, and the run fell straight back to the "timed out — check your Apify
 * key" error. The fallback could never run on the timeout path — the single most common real block.
 *
 * The fix: the fallback gets its OWN fresh timeout budget (linked only to the external steer signal),
 * so an expired internal timer can't poison it. This test fires the real 150s timer with fake timers,
 * then asserts the fallback was invoked with a NON-aborted signal and produced an unverified result.
 *
 * Strategy mirrors useLocationDiscovery.expansion.test.ts: mock useMutation to call the mutationFn
 * directly (no QueryClientProvider) and mock the stores + the discover/fallback boundaries.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// useMutation → call the mutationFn directly.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useMutation: vi.fn((opts: { mutationFn: (params: unknown) => Promise<unknown> }) => {
      const fn = opts.mutationFn
      return { mutate: (params: unknown) => { void fn(params) }, mutateAsync: (params: unknown) => fn(params), isPending: false, isError: false }
    }),
  }
})

const mockActions = {
  startAnalysis: vi.fn(),
  setStep: vi.fn(),
  setResults: vi.fn(),
  setError: vi.fn(),
  reset: vi.fn(),
  setClarification: vi.fn(),
  setStepProgressDetail: vi.fn(),
  setDidExpand: vi.fn(),
  answerClarification: vi.fn(),
}
const mockState = { pendingDiscovery: null, params: null, clarificationAnswer: null, runConversationId: null }

vi.mock('../store/analysisStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/analysisStore')>()
  return { ...actual, useAnalysisStore: Object.assign(vi.fn(() => mockActions), { getState: vi.fn(() => mockState) }) }
})

vi.mock('../store/conversationsStore', () => ({
  useConversationsStore: Object.assign(vi.fn(() => ({})), { getState: vi.fn(() => ({ activeId: 'conv-1' })) }),
}))

vi.mock('../store/keysStore', () => ({
  useKeysStore: vi.fn(() => ({ geminiKeys: ['g'], apifyKeys: ['a'], pickKey: vi.fn(() => 'a') })),
}))

const discoverCompetitorsMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/apifyClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apifyClient')>()
  return { ...actual, discoverCompetitors: discoverCompetitorsMock }
})

const webFallbackMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/webFallback', () => ({ webFallbackCompetitors: webFallbackMock }))

import { useCompetitorAnalysis } from './useCompetitorAnalysis'

describe('useCompetitorAnalysis — web fallback on Apify timeout', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('runs the web fallback on a FRESH (non-aborted) signal after the scrape times out, and sets an unverified result', async () => {
    // Scrape hangs until its signal aborts (the 150s internal timeout), then rejects — a real block.
    discoverCompetitorsMock.mockImplementation((_h: string[], _k: string[], signal: AbortSignal) =>
      new Promise((_res, rej) => {
        if (signal.aborted) rej(new Error('aborted'))
        else signal.addEventListener('abort', () => rej(new Error('aborted: timed out')), { once: true })
      }),
    )

    let fbSignal: AbortSignal | undefined
    webFallbackMock.mockImplementation((_keys: unknown, _params: unknown, signal: AbortSignal) => {
      fbSignal = signal
      return Promise.resolve({
        output: { competitors: [{ username: 'desifit', category: 'top', rank: 1, rationale: 'leader' }], niche: 'fitness', summary: 's' },
        profiles: [{ username: 'desifit' }],
      })
    })

    const { result } = renderHook(() => useCompetitorAnalysis())
    act(() => { result.current.analyze({ handles: ['someone'], depth: 'standard', clientName: '', nicheContext: 'fitness' }) })

    // Fire the internal 150s timeout → scrape rejects → fallback must run on a fresh budget.
    await act(async () => { await vi.advanceTimersByTimeAsync(150_000) })

    expect(webFallbackMock).toHaveBeenCalledTimes(1)
    // The crux: the fallback must NOT receive the already-fired timeout signal.
    expect(fbSignal?.aborted).toBe(false)
    // And it sets an UNVERIFIED result (5th arg true), not the timeout error.
    expect(mockActions.setResults).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.any(Number), expect.anything(), true,
    )
    expect(mockActions.setError).not.toHaveBeenCalled()
  })
})
