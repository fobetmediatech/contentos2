// @vitest-environment jsdom
/**
 * Integration tests for useConversation — confirming-state path.
 *
 * Tests the three-stage typed-input handler (pipeline-switch → heuristic →
 * Gemini fallback) and the AD5 retry/lock behaviour.
 *
 * Strategy: mock external dependencies (stores, Gemini, Apify) at the module
 * level so the hook sees a controllable environment. The hook's React state
 * updates are exercised via renderHook + act from @testing-library/react.
 *
 * Covers:
 *   1. Empty text is a no-op (isSendingRef guard)
 *   2. Heuristic match resolves without calling callGeminiConfirmReply
 *   3. Gemini fallback is called when heuristic returns null
 *   4. isConfirmingPending resets to false in the error path (finally block)
 *   5. AD5: second consecutive failure escalates message + locks textarea
 *   6. AD5: successful resolution resets the error counter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConversation } from './useConversation'
import * as geminiModule from '../ai/gemini'

// ── Module-level mocks (hoisted before imports) ───────────────────────────────

// Stores — provide a minimal reactive shape that the hook reads
const mockStoreState = {
  status: 'confirming' as string,
  conversationMessages: [] as Array<{ role: string; content: string; timestamp: number; type: string }>,
  parsedIntent: {
    pipelineType: 'competitor',
    niche: 'fitness creators',
    location: 'Mumbai',
    needsClarification: false,
    depth: 'standard',
    clientName: '',
    discoveredSeeds: ['@seed1', '@seed2'],
    routingConfidence: 'high',
  },
  discoveredSeeds: ['@seed1', '@seed2'],
  currentStep: 0,
  niche: 'fitness creators',
  error: null,
}
const mockStoreActions = {
  setStatus: vi.fn((s: string) => { mockStoreState.status = s }),
  addMessage: vi.fn((m: { role: string; content: string; timestamp: number; type: string }) => {
    mockStoreState.conversationMessages.push(m)
  }),
  startChat: vi.fn(),
  reset: vi.fn(),
  setCurrentStep: vi.fn(),
  setParsedIntent: vi.fn(),
  setDiscoveredSeeds: vi.fn(),
  setPendingDiscovery: vi.fn(),
  clearPendingDiscovery: vi.fn(),
}

vi.mock('../store/analysisStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/analysisStore')>()
  return {
    ...actual,
    // Return an object with getters so the hook sees live mockStoreState values
    // even when sendMessage is called after a state mutation in the test.
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
    useDiscoveryStore: vi.fn(() => ({
      status: 'idle',
      error: null,
      reset: vi.fn(),
      setStatus: vi.fn(),
      setResults: vi.fn(),
    })),
  }
})

vi.mock('../store/keysStore', () => ({
  useKeysStore: vi.fn(() => ({
    geminiKey: 'test-gemini-key',
    pickKey: vi.fn(() => 'test-apify-key'),
    isReady: vi.fn(() => true),
  })),
}))

vi.mock('./useCompetitorAnalysis', () => ({
  useCompetitorAnalysis: vi.fn(() => ({
    analyze: vi.fn(),
    answerClarification: vi.fn(),
    isPending: false,
  })),
}))

vi.mock('./useLocationDiscovery', () => ({
  useLocationDiscovery: vi.fn(() => ({
    discover: vi.fn(),
  })),
}))

// vi.hoisted() is necessary because vi.mock factories run before variable initializers.
// Any variable referenced inside a vi.mock factory must be created via vi.hoisted().
const parseIntentMock = vi.hoisted(() => vi.fn())

vi.mock('../ai/intentParser', () => ({
  parseIntent: parseIntentMock,
}))

vi.mock('../lib/hashtagGenerator', () => ({
  generateHashtags: vi.fn(),
}))

vi.mock('../lib/apifyClient', () => ({
  scrapeHashtagUsernames: vi.fn(),
}))

// ── Test setup ────────────────────────────────────────────────────────────────

const callGeminiConfirmReplySpy = vi.spyOn(geminiModule, 'callGeminiConfirmReply')

beforeEach(() => {
  vi.clearAllMocks()
  // Reset store state
  mockStoreState.status = 'confirming'
  mockStoreState.conversationMessages = []
  mockStoreState.parsedIntent = {
    pipelineType: 'competitor',
    niche: 'fitness creators',
    location: 'Mumbai',
    needsClarification: false,
    depth: 'standard',
    clientName: '',
    discoveredSeeds: ['@seed1', '@seed2'],
    routingConfidence: 'high',
  }
  mockStoreState.discoveredSeeds = ['@seed1', '@seed2']
  // Reset Gemini mock to reject by default (overridden in specific tests)
  callGeminiConfirmReplySpy.mockRejectedValue(new Error('Network error'))
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useConversation — confirming path', () => {
  it('1. empty text is a no-op — no message added, no Gemini call', async () => {
    const { result } = renderHook(() => useConversation())
    await act(async () => {
      await result.current.sendMessage('   ')
    })
    expect(mockStoreActions.addMessage).not.toHaveBeenCalled()
    expect(callGeminiConfirmReplySpy).not.toHaveBeenCalled()
  })

  it('2. heuristic match resolves without calling callGeminiConfirmReply', async () => {
    const { result } = renderHook(() => useConversation())
    await act(async () => {
      await result.current.sendMessage('micro please')
    })
    // Gemini should NOT be called — heuristic handles it
    expect(callGeminiConfirmReplySpy).not.toHaveBeenCalled()
    // Should echo a "Got it" message
    const echoMsg = mockStoreActions.addMessage.mock.calls.find(
      ([m]) => m.content.startsWith('Got it'),
    )
    expect(echoMsg).toBeTruthy()
    expect(echoMsg![0].content).toContain('Micro')
  })

  it('3. Gemini fallback is called when heuristic returns null', async () => {
    callGeminiConfirmReplySpy.mockResolvedValue('Proceed')
    const { result } = renderHook(() => useConversation())
    await act(async () => {
      await result.current.sendMessage('something completely ambiguous here')
    })
    expect(callGeminiConfirmReplySpy).toHaveBeenCalledOnce()
    expect(callGeminiConfirmReplySpy).toHaveBeenCalledWith(
      'test-gemini-key',
      'something completely ambiguous here',
      expect.any(Array),
      expect.any(AbortSignal),
    )
  })

  it('4. isConfirmingPending resets to false in the error path (finally always runs)', async () => {
    // Gemini throws — confirms that finally clears the pending state
    callGeminiConfirmReplySpy.mockRejectedValue(new Error('API failure'))
    const { result } = renderHook(() => useConversation())

    // Feed ambiguous text so we reach the Gemini path
    await act(async () => {
      await result.current.sendMessage('something completely ambiguous here')
    })

    // isConfirmingPending must be false after the throw (finally ran)
    expect(result.current.isConfirmingPending).toBe(false)
    // An error message should have been added
    const errMsg = mockStoreActions.addMessage.mock.calls.find(
      ([m]) => m.type === 'text' || m.type === 'error',
    )
    expect(errMsg).toBeTruthy()
  })

  describe('AD5 — retry counter + escalation', () => {
    it('5a. first failure shows the "try differently" message, textarea stays unlocked', async () => {
      callGeminiConfirmReplySpy.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useConversation())

      await act(async () => {
        await result.current.sendMessage('something ambiguous')
      })

      // First failure — standard message, not escalation
      const lastMsg = mockStoreActions.addMessage.mock.calls.at(-1)?.[0]
      expect(lastMsg?.content).toContain('try describing it differently')
      expect(result.current.isConfirmingLocked).toBe(false)
    })

    it('5b. second consecutive failure escalates and locks the textarea', async () => {
      callGeminiConfirmReplySpy.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useConversation())

      // First failure
      await act(async () => {
        await result.current.sendMessage('ambiguous one')
      })
      // Second failure (counter now 2)
      await act(async () => {
        await result.current.sendMessage('ambiguous two')
      })

      const lastMsg = mockStoreActions.addMessage.mock.calls.at(-1)?.[0]
      expect(lastMsg?.content).toContain("Let's keep it simple")
      expect(lastMsg?.type).toBe('error')
      expect(result.current.isConfirmingLocked).toBe(true)
    })

    it('6. button click (confirmSeeds) resets the error counter after a lock', async () => {
      callGeminiConfirmReplySpy.mockRejectedValue(new Error('fail'))
      const { result } = renderHook(() => useConversation())

      // Two failures — now locked
      await act(async () => { await result.current.sendMessage('ambiguous one') })
      await act(async () => { await result.current.sendMessage('ambiguous two') })
      expect(result.current.isConfirmingLocked).toBe(true)

      // User gives up typing and clicks a button instead — this resets the counter.
      // The real user journey: after 2 typing failures, the user uses the "Quick picks" buttons.
      await act(async () => {
        result.current.confirmSeeds('Proceed')
      })

      expect(result.current.isConfirmingLocked).toBe(false)
    })
  })
})

// ── PARSE_ERROR error message path ───────────────────────────────────────────
//
// Verifies that when parseIntent throws GeminiError('PARSE_ERROR'), the
// chat shows "unexpected response" instead of the misleading "Network error".

import { GeminiError } from '../ai/gemini'

describe('useConversation — chatting PARSE_ERROR message', () => {
  beforeEach(() => {
    mockStoreState.status = 'chatting'
    mockStoreState.conversationMessages = []
    // Explicitly reset the Gemini confirm spy — tests in this block never reach it
    // but resetting prevents confusion if new tests are added here later.
    callGeminiConfirmReplySpy.mockReset()
    parseIntentMock.mockReset()
  })

  it('shows "unexpected response" when parseIntent throws PARSE_ERROR', async () => {
    parseIntentMock.mockRejectedValue(
      new GeminiError('PARSE_ERROR', 'Gemini returned invalid JSON: SyntaxError...', false),
    )

    const { result } = renderHook(() => useConversation())
    await act(async () => {
      await result.current.sendMessage('find fitness creators')
    })

    const errorMsg = mockStoreActions.addMessage.mock.calls.find(
      ([m]: [{ type: string; content: string }]) => m.type === 'error',
    )?.[0] as { content: string } | undefined

    expect(errorMsg).toBeDefined()
    expect(errorMsg?.content).toBe('Gemini returned an unexpected response — try again.')
    expect(errorMsg?.content).not.toContain('Network error')
    // Status must reset to 'chatting' so the UI doesn't get stuck
    expect(mockStoreActions.setStatus).toHaveBeenCalledWith('chatting')
  })
})
