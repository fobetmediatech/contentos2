// @vitest-environment jsdom
/**
 * Tests for useConversation — Phase 1a clarification loop.
 *
 * Phase 1a (10C) makes the orchestrator ACT on the needsClarification signal the
 * intent parser already emits, instead of best-guessing and dispatching. The cap
 * was raised 1 → 2 (CLARIFICATION_CAP) so the parser can hold a real clarifying
 * exchange before forcing a fallback.
 *
 * Behaviour under test (the "ask before searching" fix):
 *   A. Ambiguous intent → asks the clarifying question, does NOT dispatch.
 *   B. Two consecutive ambiguous turns → asks BOTH times (cap=2 allows a 2nd).
 *   C. A third ambiguous turn → forced handle fallback, stops asking.
 *   D. Ambiguous → then resolved → exits the loop into routing (setParsedIntent).
 *
 *           sendMessage(ambiguous)        sendMessage(ambiguous)      sendMessage(ambiguous)
 *   turns=0 ───────ask Q───────► turns=1 ───────ask Q───────► turns=2 ────fallback────► reset 0
 *                  │
 *                  └─ sendMessage(resolved) ──► setParsedIntent ──► dispatch (no more asks)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConversation } from './useConversation'

// ── Store mocks ───────────────────────────────────────────────────────────────

const mockStoreState = {
  status: 'chatting' as string,
  conversationMessages: [] as Array<{ role: string; content: string; type: string }>,
  parsedIntent: null as unknown,
  discoveredSeeds: [] as string[],
  currentStep: 0,
  niche: '',
  error: null,
}

const mockStoreActions = {
  setStatus: vi.fn((s: string) => { mockStoreState.status = s }),
  addMessage: vi.fn((m: unknown) => {
    mockStoreState.conversationMessages.push(m as typeof mockStoreState.conversationMessages[number])
  }),
  startChat: vi.fn(),
  reset: vi.fn(),
  setParsedIntent: vi.fn((p: unknown) => { mockStoreState.parsedIntent = p }),
  setDiscoveredSeeds: vi.fn((s: string[]) => { mockStoreState.discoveredSeeds = s }),
}

vi.mock('../store/analysisStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/analysisStore')>()
  return {
    ...actual,
    useAnalysisStore: vi.fn(() => ({
      get status() { return mockStoreState.status },
      get conversationMessages() { return mockStoreState.conversationMessages },
      get parsedIntent() { return mockStoreState.parsedIntent },
      get discoveredSeeds() { return mockStoreState.discoveredSeeds },
      get currentStep() { return mockStoreState.currentStep },
      get niche() { return mockStoreState.niche },
      get error() { return mockStoreState.error },
      ...mockStoreActions,
    })),
  }
})

vi.mock('../store/discoveryStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/discoveryStore')>()
  return {
    ...actual,
    useDiscoveryStore: vi.fn(() => ({ status: 'idle', error: null, reset: vi.fn() })),
  }
})

vi.mock('../store/keysStore', () => ({
  useKeysStore: vi.fn(() => ({
    geminiKey: 'test-key',
    pickKey: vi.fn(() => 'test-apify-key'),
    isReady: vi.fn(() => true),
  })),
}))

vi.mock('./useCompetitorAnalysis', () => ({
  useCompetitorAnalysis: vi.fn(() => ({ analyze: vi.fn(), answerClarification: vi.fn(), isPending: false })),
}))
vi.mock('./useLocationDiscovery', () => ({
  useLocationDiscovery: vi.fn(() => ({ discover: vi.fn() })),
  MIN_LOCATION_RESULTS: 4,
}))
vi.mock('./useReelAnalysis', () => ({
  useReelAnalysis: vi.fn(() => ({ startAnalysis: vi.fn() })),
}))

const parseIntentMock = vi.hoisted(() => vi.fn())
vi.mock('../ai/intentParser', () => ({ parseIntent: parseIntentMock }))

// Resolve hashtag discovery cleanly so the resolved-turn path (D) doesn't throw.
const scrapeHashtagUsernamesMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/apifyClient', () => ({ scrapeHashtagUsernames: scrapeHashtagUsernamesMock }))
const generateHashtagsMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/hashtagGenerator', () => ({ generateHashtags: generateHashtagsMock }))

// ── Helpers ───────────────────────────────────────────────────────────────────

const AMBIGUOUS = { needsClarification: true, question: 'Which kind of accounts — food, fitness, or travel?' }
const RESOLVED = {
  needsClarification: false, niche: 'fitness creators', location: '', knownHandles: [],
  depth: 'standard', clientName: '', pipelineType: 'competitor', routingConfidence: 'high',
}

// A prose message with common words so it does NOT trip the @handles fast path.
const VAGUE_MSG = 'find me some good accounts to look at'

beforeEach(() => {
  vi.clearAllMocks()
  mockStoreState.status = 'chatting'
  mockStoreState.conversationMessages = []
  mockStoreState.parsedIntent = null
  mockStoreState.discoveredSeeds = []
  generateHashtagsMock.mockResolvedValue({ hashtags: ['tag'] })
  scrapeHashtagUsernamesMock.mockResolvedValue(['found_handle'])
})

const lastAssistant = () =>
  [...mockStoreState.conversationMessages].reverse().find((m) => m.role === 'assistant')

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useConversation — Phase 1a clarification loop', () => {
  it('A. ambiguous intent → asks the clarifying question, does NOT dispatch', async () => {
    parseIntentMock.mockResolvedValue(AMBIGUOUS)
    const { result } = renderHook(() => useConversation())

    await act(async () => { await result.current.sendMessage(VAGUE_MSG) })

    // The assistant asked the parser's question
    expect(lastAssistant()?.content).toBe(AMBIGUOUS.question)
    // It returned to chatting, ready for the answer
    expect(mockStoreActions.setStatus).toHaveBeenLastCalledWith('chatting')
    // It did NOT dispatch: no seeds stored, no hashtag scrape
    expect(mockStoreActions.setDiscoveredSeeds).not.toHaveBeenCalled()
    expect(scrapeHashtagUsernamesMock).not.toHaveBeenCalled()
  })

  it('B. two consecutive ambiguous turns → asks BOTH times (cap raised 1→2)', async () => {
    parseIntentMock.mockResolvedValue(AMBIGUOUS)
    const { result } = renderHook(() => useConversation())

    await act(async () => { await result.current.sendMessage(VAGUE_MSG) })
    await act(async () => { await result.current.sendMessage('still not sure honestly') })

    const questionAsks = mockStoreState.conversationMessages.filter(
      (m) => m.role === 'assistant' && m.content === AMBIGUOUS.question,
    )
    // Pre-Phase-1a (cap=1) this would be 1 ask + a fallback. Now: 2 asks.
    expect(questionAsks).toHaveLength(2)
    expect(scrapeHashtagUsernamesMock).not.toHaveBeenCalled()
  })

  it('C. a third ambiguous turn → forced handle fallback, stops asking', async () => {
    parseIntentMock.mockResolvedValue(AMBIGUOUS)
    const { result } = renderHook(() => useConversation())

    await act(async () => { await result.current.sendMessage(VAGUE_MSG) })
    await act(async () => { await result.current.sendMessage('hmm dunno') })
    await act(async () => { await result.current.sendMessage('whatever you think') })

    // Third turn is the cap-exceeded fallback, not another question.
    expect(lastAssistant()?.content).toMatch(/name a handle/i)
    expect(lastAssistant()?.content).not.toBe(AMBIGUOUS.question)
  })

  it('D. ambiguous → then resolved → exits the loop into routing (setParsedIntent)', async () => {
    parseIntentMock.mockResolvedValueOnce(AMBIGUOUS).mockResolvedValueOnce(RESOLVED)
    const { result } = renderHook(() => useConversation())

    await act(async () => { await result.current.sendMessage(VAGUE_MSG) })
    // Ambiguous turn must NOT have set a parsed intent.
    expect(mockStoreActions.setParsedIntent).not.toHaveBeenCalled()

    await act(async () => { await result.current.sendMessage('fitness coaches please') })
    // Resolved turn exits clarification and stores the intent for routing.
    expect(mockStoreActions.setParsedIntent).toHaveBeenCalledWith(
      expect.objectContaining({ niche: 'fitness creators', pipelineType: 'competitor' }),
    )
  })
})
