// @vitest-environment jsdom
/**
 * Tests for useLocationDiscovery — quality gate expansion paths.
 *
 * NOTE: useLocationDiscovery wraps the core logic in useMutation (TanStack Query).
 * We mock useMutation to call the mutationFn directly so tests don't need a
 * QueryClientProvider wrapper.
 *
 * Covers:
 *   A. Expansion catch block: when expansion throws, first-pass results are
 *      surfaced without error (graceful degradation)
 *   B. didExpand=false when expansion throws
 *   C. Deduplication: profiles in both first-pass and expansion are not doubled
 *
 * Strategy: mock discoveryClient.runLocationDiscovery so we can control
 * whether expansion succeeds, fails, or returns overlapping profiles.
 * The hook calls runLocationDiscovery internally for both initial pass and expansion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocationDiscovery } from './useLocationDiscovery'

// Mock useMutation so it calls the mutationFn directly (no QueryClient needed).
// The mock captures the mutationFn passed to useMutation and calls it via
// a `discover` wrapper that the tests call via result.current.discover().
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useMutation: vi.fn((opts: { mutationFn: (params: unknown) => Promise<unknown> }) => {
      const fn = opts.mutationFn
      return {
        mutate: (params: unknown) => fn(params),
        mutateAsync: (params: unknown) => fn(params),
        isPending: false,
        isError: false,
      }
    }),
  }
})

// ── Store mocks ───────────────────────────────────────────────────────────────

const mockDiscoveryActions = {
  startDiscovery: vi.fn(),
  setStep: vi.fn(),
  setStepProgressDetail: vi.fn(),
  setResults: vi.fn(),
  setError: vi.fn(),
  reset: vi.fn(),
}

vi.mock('../store/discoveryStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/discoveryStore')>()
  return {
    ...actual,
    useDiscoveryStore: vi.fn(() => mockDiscoveryActions),
  }
})

vi.mock('../store/keysStore', () => ({
  useKeysStore: vi.fn(() => ({
    geminiKey: 'test-key',
    apifyKeys: ['test-apify-key'],
    pickKey: vi.fn(() => 'test-apify-key'),
  })),
}))

// ── External dependency mocks ─────────────────────────────────────────────────

const runLocationDiscoveryMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/discoveryClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/discoveryClient')>()
  return {
    ...actual,
    runLocationDiscovery: runLocationDiscoveryMock,
  }
})

const generateHashtagsMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/hashtagGenerator', () => ({
  generateHashtags: generateHashtagsMock,
}))

const analyzeDiscoveryMock = vi.hoisted(() => vi.fn())
vi.mock('../ai/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/gemini')>()
  return { ...actual, analyzeDiscovery: analyzeDiscoveryMock }
})

// ── Profile helpers ───────────────────────────────────────────────────────────

import type { NormalizedProfile } from '../lib/transformers'
import type { FilterResult } from '../lib/discoveryClient'

function makeProfile(username: string, city = 'Mumbai'): NormalizedProfile {
  return {
    username,
    fullName: `Creator ${username}`,
    biography: `Based in ${city}`,
    followersCount: 50000,
    followsCount: 500,
    postsCount: 300,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 1000,
    avgComments: 50,
    engagementRate: 2.1,
    relatedHandles: [],
    topHashtags: [],
  }
}

function makeFilterResult(profiles: NormalizedProfile[]): FilterResult {
  return {
    filtered: profiles,
    relaxed: false,
    passedCount: profiles.length,
  }
}

const DISCOVERY_PARAMS = {
  city: 'Mumbai',
  niche: 'food bloggers',
  depth: 'standard' as const,
  clientName: 'TestClient',
}

const GEMINI_OUTPUT = {
  niche: 'food bloggers',
  results: [
    {
      username: 'creator1',
      category: 'top' as const,
      rank: 1,
      rationale: 'Top food blogger',
      specialties: ['indian cuisine'],
      contentFocus: 'restaurant reviews',
      partnershipReady: true,
      locationConfidence: 'confirmed' as const,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: generateHashtags succeeds with 5 hashtags (initial pass)
  generateHashtagsMock.mockResolvedValue({
    hashtags: ['MumbaiFood', 'MumbaiFoodie', 'MumbaiFoodVlogger', 'MumbaiFoodBlogger', 'MumbaiEats'],
    fromAI: false,
  })
  // Default: analyzeDiscovery returns a valid output
  analyzeDiscoveryMock.mockResolvedValue(GEMINI_OUTPUT)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useLocationDiscovery — quality gate expansion', () => {
  it('A. expansion throw → first-pass results surfaced, no mutation error', async () => {
    const firstPassProfiles = [makeProfile('creator1')]

    // First call (initial pass): returns 1 profile — below MIN_LOCATION_RESULTS (4) → triggers expansion
    runLocationDiscoveryMock.mockResolvedValueOnce({
      candidateProfiles: firstPassProfiles,
      filterResult: makeFilterResult(firstPassProfiles),
    })

    // Second call (expansion - generateHashtags for expansion): new hashtags
    generateHashtagsMock.mockResolvedValueOnce({
      hashtags: ['MumbaiFood', 'MumbaiFoodie', 'MumbaiFoodVlogger', 'MumbaiFoodBlogger', 'MumbaiEats'],
      fromAI: false,
    })
    generateHashtagsMock.mockResolvedValueOnce({
      hashtags: ['MumbaiStreetFood', 'MumbaiChef', 'MumbaiEats2'],
      fromAI: false,
    })

    // Expansion run throws
    runLocationDiscoveryMock.mockRejectedValueOnce(new Error('Apify timeout'))

    const { result } = renderHook(() => useLocationDiscovery())

    await act(async () => {
      await (result.current.discover as (p: typeof DISCOVERY_PARAMS) => Promise<void>)(DISCOVERY_PARAMS)
    })

    // setError should NOT have been called (expansion error is swallowed)
    expect(mockDiscoveryActions.setError).not.toHaveBeenCalled()

    // setResults SHOULD have been called (first-pass results surfaced)
    expect(mockDiscoveryActions.setResults).toHaveBeenCalled()

    // didExpand should be false (expansion failed)
    const setResultsCall = mockDiscoveryActions.setResults.mock.calls[0]
    expect(setResultsCall?.[4]).toBe(false) // 5th arg = didExpand
  })

  it('B. didExpand=false when expansion throws', async () => {
    const firstPassProfiles = [makeProfile('creator1')]
    runLocationDiscoveryMock
      .mockResolvedValueOnce({
        candidateProfiles: firstPassProfiles,
        filterResult: makeFilterResult(firstPassProfiles),
      })
      .mockRejectedValueOnce(new Error('Network error'))

    generateHashtagsMock.mockResolvedValue({
      hashtags: ['MumbaiStreetFood', 'MumbaiChef'],
      fromAI: false,
    })

    const { result } = renderHook(() => useLocationDiscovery())

    await act(async () => {
      await (result.current.discover as (p: typeof DISCOVERY_PARAMS) => Promise<void>)(DISCOVERY_PARAMS)
    })

    const setResultsCall = mockDiscoveryActions.setResults.mock.calls[0]
    const didExpand = setResultsCall?.[4]
    expect(didExpand).toBe(false)
  })

  it('C. expansion dedup: overlapping profiles are not doubled', async () => {
    const sharedProfile = makeProfile('shared_creator')
    const uniqueExpansion = makeProfile('unique_from_expansion')

    // First pass: 1 profile (triggers expansion)
    runLocationDiscoveryMock.mockResolvedValueOnce({
      candidateProfiles: [sharedProfile],
      filterResult: makeFilterResult([sharedProfile]),
    })

    generateHashtagsMock.mockResolvedValueOnce({
      hashtags: ['MumbaiFood', 'MumbaiFoodie', 'MumbaiFoodVlogger', 'MumbaiFoodBlogger', 'MumbaiEats'],
      fromAI: false,
    })
    generateHashtagsMock.mockResolvedValueOnce({
      hashtags: ['MumbaiStreetFood', 'MumbaiChef'],
      fromAI: false,
    })

    // Expansion returns the same profile + one new one
    runLocationDiscoveryMock.mockResolvedValueOnce({
      candidateProfiles: [sharedProfile, uniqueExpansion],
      filterResult: makeFilterResult([sharedProfile, uniqueExpansion]),
    })

    const { result } = renderHook(() => useLocationDiscovery())

    await act(async () => {
      await (result.current.discover as (p: typeof DISCOVERY_PARAMS) => Promise<void>)(DISCOVERY_PARAMS)
    })

    const setResultsCall = mockDiscoveryActions.setResults.mock.calls[0]
    const candidateProfiles: NormalizedProfile[] = setResultsCall?.[1] ?? []

    // shared_creator should appear exactly once
    const sharedCount = candidateProfiles.filter(p => p.username === 'shared_creator').length
    expect(sharedCount).toBe(1)

    // unique_from_expansion should appear
    expect(candidateProfiles.some(p => p.username === 'unique_from_expansion')).toBe(true)
  })
})
