// @vitest-environment jsdom
/**
 * Tests for useAgentConversation (Phase 1b T8) — the integration wiring.
 *
 * The pure decision core is unit-tested in agentTools.test.ts. Here we verify the hook
 * routes each Gemini tool result to the right side effect: ask renders a question,
 * dispatch calls the correct pipeline hook (with the abort signal threaded for
 * latest-wins), answer runs the content copilot, and a niche-only competitor request
 * scrapes seeds first. Stores + pipeline hooks + Gemini are mocked — no network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentConversation } from './useAgentConversation'
import type { GeminiToolResult } from '../ai/gemini'

const mockState = { conversationMessages: [] as Array<{ role: string; content: string; type: string }> }
const addMessage = vi.fn((m: { role: string; content: string; type: string }) => {
  mockState.conversationMessages.push(m)
})

// Imperative store state read via getState() inside stopLingeringProgress (steer cleanup).
// Prefixed "mock" so vitest allows the reference inside the hoisted vi.mock factories.
const mockStores = {
  analysisStatus: 'chatting' as string,
  setStatus: vi.fn((s: string) => { mockStores.analysisStatus = s }),
  discoveryStatus: 'idle' as string,
  discoveryReset: vi.fn(),
  reelActiveHandles: [] as string[],
  reelSynthesisStatus: 'idle' as string,
  reelReset: vi.fn(),
}

vi.mock('../store/analysisStore', async (io) => ({
  ...(await io<typeof import('../store/analysisStore')>()),
  // Faithful to Zustand: the HOOK returns a render-time SNAPSHOT (a copy captured when the
  // hook is called), so it goes stale after addMessage within the same tick — exactly the
  // real footgun. getState() returns LIVE state. buildHistory MUST use getState() to see the
  // just-added message; if it reads the hook snapshot it'll be one message behind.
  useAnalysisStore: Object.assign(
    vi.fn(() => ({
      conversationMessages: mockState.conversationMessages.slice(),
      addMessage,
    })),
    {
      getState: () => ({
        get conversationMessages() { return mockState.conversationMessages },
        status: mockStores.analysisStatus,
        setStatus: mockStores.setStatus,
      }),
    },
  ),
}))

// The transcript moved here: addMessage writes to the active conversation, and buildHistory
// reads it via getState(). Wired to the same mockState array so the existing assertions hold.
vi.mock('../store/conversationsStore', () => {
  const convState = {
    get conversations() {
      return { active: { id: 'active', title: '', messages: mockState.conversationMessages, createdAt: 0, updatedAt: 0 } }
    },
    activeId: 'active',
    // Getter so addMessage is read at call-time, not when this hoisted factory runs (TDZ).
    get addMessage() {
      return addMessage
    },
  }
  return {
    useConversationsStore: Object.assign(
      vi.fn((selector?: (s: typeof convState) => unknown) => (selector ? selector(convState) : convState)),
      { getState: () => convState },
    ),
  }
})

vi.mock('../store/discoveryStore', () => ({
  useDiscoveryStore: Object.assign(
    vi.fn(() => ({})),
    { getState: () => ({ status: mockStores.discoveryStatus, reset: mockStores.discoveryReset }) },
  ),
}))

vi.mock('../store/reelAnalysisStore', () => ({
  useReelAnalysisStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: () => ({
        activeHandles: mockStores.reelActiveHandles,
        synthesisStatus: mockStores.reelSynthesisStatus,
        reset: mockStores.reelReset,
      }),
    },
  ),
}))

vi.mock('../store/keysStore', () => ({
  useKeysStore: vi.fn(() => ({ geminiKey: 'test-key', pickKey: () => 'apify-key' })),
}))

const analyzeMock = vi.fn()
const discoverMock = vi.fn()
const reelMock = vi.fn()
vi.mock('./useCompetitorAnalysis', () => ({ useCompetitorAnalysis: vi.fn(() => ({ analyze: analyzeMock })) }))
vi.mock('./useLocationDiscovery', () => ({ useLocationDiscovery: vi.fn(() => ({ discover: discoverMock })), MIN_LOCATION_RESULTS: 4 }))
vi.mock('./useReelAnalysis', () => ({ useReelAnalysis: vi.fn(() => ({ startAnalysis: reelMock })) }))

const callTools = vi.hoisted(() => vi.fn())
const callContent = vi.hoisted(() => vi.fn())
vi.mock('../ai/gemini', async (io) => ({
  ...(await io<typeof import('../ai/gemini')>()),
  callGeminiWithTools: callTools,
  callGeminiContent: callContent,
}))

const genHashtags = vi.hoisted(() => vi.fn())
const scrapeUsers = vi.hoisted(() => vi.fn())
vi.mock('../lib/hashtagGenerator', () => ({ generateHashtags: genHashtags }))
vi.mock('../lib/apifyClient', () => ({ scrapeHashtagUsernames: scrapeUsers }))

const result = (r: GeminiToolResult) => callTools.mockResolvedValue(r)
const lastBot = () => [...mockState.conversationMessages].reverse().find((m) => m.role === 'assistant')

beforeEach(() => {
  vi.clearAllMocks()
  mockState.conversationMessages = []
  mockStores.analysisStatus = 'chatting'
  mockStores.discoveryStatus = 'idle'
  mockStores.reelActiveHandles = []
  mockStores.reelSynthesisStatus = 'idle'
  genHashtags.mockResolvedValue({ hashtags: ['tag'] })
  scrapeUsers.mockResolvedValue(['seed_handle'])
})

describe('useAgentConversation', () => {
  it('sends the LATEST user message to the model (no stale-snapshot off-by-one)', async () => {
    // Regression: buildHistory read the render-time store snapshot, which is one message
    // stale after addMessage — so the first turn sent EMPTY contents (Gemini 400) and later
    // turns answered the PREVIOUS message. It must read live state (getState).
    result({ kind: 'text', text: 'ok' })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('top vegan creators') })
    const contents = callTools.mock.calls[0][1] as Array<{ role: string; parts: { text: string }[] }>
    expect(contents.length).toBeGreaterThan(0) // not empty → no 400 on first turn
    const last = contents[contents.length - 1]
    expect(last.role).toBe('user')
    expect(last.parts[0].text).toBe('top vegan creators')
  })

  it('does NOT show "Switched" when there was no live work (no false steer)', async () => {
    // Regression: a completed turn leaves a non-aborted controller in currentRun, so the
    // next message wrongly read that as a supersede and printed "Switched" every time.
    result({ kind: 'text', text: 'Hello!' })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('hi') })
    await act(async () => { await hook.current.sendMessage('hello again') })
    const switched = mockState.conversationMessages.filter((m) => m.content.startsWith('Switched'))
    expect(switched).toHaveLength(0)
  })

  it('renders the agent question when the model calls ask_clarification', async () => {
    result({ kind: 'call', name: 'ask_clarification', args: { question: 'Which kind of accounts?' } })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('find me good accounts') })
    expect(lastBot()?.content).toBe('Which kind of accounts?')
    expect(analyzeMock).not.toHaveBeenCalled()
  })

  it('renders tappable pills when ask_clarification includes options (TD1)', async () => {
    result({ kind: 'call', name: 'ask_clarification', args: { question: 'Which niche?', options: ['Fitness', 'Food'] } })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('find me good accounts') })
    const last = lastBot() as { content: string; type: string; options?: string[] }
    expect(last.type).toBe('options')
    expect(last.options).toEqual(['Fitness', 'Food'])
  })

  it('dispatches competitor analysis with named handles + threads the abort signal', async () => {
    result({ kind: 'call', name: 'discover_competitors', args: { knownHandles: ['nike.training'] } })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('similar to @nike.training') })
    expect(analyzeMock).toHaveBeenCalledTimes(1)
    const [params, signal] = analyzeMock.mock.calls[0]
    expect(params.handles).toContain('nike.training')
    expect(signal).toBeInstanceOf(AbortSignal) // latest-wins wiring
    expect(scrapeUsers).not.toHaveBeenCalled() // handles given → no seed scrape
  })

  it('dispatches location discovery for an explicit-city request', async () => {
    result({ kind: 'call', name: 'discover_by_location', args: { niche: 'food', city: 'Pune' } })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('food bloggers based in Pune') })
    expect(discoverMock).toHaveBeenCalledTimes(1)
    expect(discoverMock.mock.calls[0][0].city).toBe('Pune')
  })

  it('dispatches reel analysis for named handles', async () => {
    result({ kind: 'call', name: 'analyze_reels', args: { handles: ['garyvee'] } })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('break down @garyvee reels') })
    expect(reelMock).toHaveBeenCalledTimes(1)
    expect(reelMock.mock.calls[0][0]).toContain('garyvee')
  })

  it('answers content questions via the content copilot', async () => {
    result({ kind: 'call', name: 'answer_content', args: { message: 'write 5 hooks' } })
    callContent.mockResolvedValue('Here are 5 hooks for you.')
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('write me 5 hooks') })
    expect(callContent).toHaveBeenCalled()
    expect(lastBot()?.content).toBe('Here are 5 hooks for you.')
    expect(analyzeMock).not.toHaveBeenCalled()
  })

  it('scrapes seeds then analyzes for a niche-only competitor request', async () => {
    result({ kind: 'call', name: 'discover_competitors', args: { niche: 'vegan food creators' } })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('top vegan food creators') })
    expect(genHashtags).toHaveBeenCalled()
    expect(scrapeUsers).toHaveBeenCalled()
    expect(analyzeMock).toHaveBeenCalledTimes(1)
    expect(analyzeMock.mock.calls[0][0].handles).toContain('seed_handle')
  })

  it('steering supersedes a running dispatch: aborts its signal, stops the lingering progress, notes the switch', async () => {
    // Turn 1: dispatch a competitor scrape. The dispatch is fire-and-forget, so its
    // abort signal stays live AFTER sendMessage resolves — the run outlives the turn.
    result({ kind: 'call', name: 'discover_competitors', args: { knownHandles: ['nike.training'] } })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('similar to @nike.training') })
    const firstSignal = analyzeMock.mock.calls[0][1] as AbortSignal
    expect(firstSignal.aborted).toBe(false)

    // The scrape is now "running" — a ProgressBubble would be on screen.
    mockStores.analysisStatus = 'running'

    // Turn 2: a NEW message steers. Latest-wins must cancel the running scrape (abort the
    // live signal), stop the lingering progress (status → chatting, NOT a full reset that
    // would wipe the chat), and drop a muted "Switched…" note before the new turn runs.
    result({ kind: 'call', name: 'discover_by_location', args: { niche: 'food', city: 'Pune' } })
    await act(async () => { await hook.current.sendMessage('actually, food creators in Pune') })

    expect(firstSignal.aborted).toBe(true) // the prior scrape was genuinely cancelled
    expect(mockStores.setStatus).toHaveBeenCalledWith('chatting') // progress stopped, chat kept
    expect(mockState.conversationMessages.some((m) => m.content.startsWith('Switched'))).toBe(true)
    expect(discoverMock).toHaveBeenCalledTimes(1) // the steered-to request dispatched
  })
})
