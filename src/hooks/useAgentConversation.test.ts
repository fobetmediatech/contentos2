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

vi.mock('../store/analysisStore', async (io) => ({
  ...(await io<typeof import('../store/analysisStore')>()),
  useAnalysisStore: vi.fn(() => ({
    get conversationMessages() { return mockState.conversationMessages },
    addMessage,
  })),
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
  genHashtags.mockResolvedValue({ hashtags: ['tag'] })
  scrapeUsers.mockResolvedValue(['seed_handle'])
})

describe('useAgentConversation', () => {
  it('renders the agent question when the model calls ask_clarification', async () => {
    result({ kind: 'call', name: 'ask_clarification', args: { question: 'Which kind of accounts?' } })
    const { result: hook } = renderHook(() => useAgentConversation())
    await act(async () => { await hook.current.sendMessage('find me good accounts') })
    expect(lastBot()?.content).toBe('Which kind of accounts?')
    expect(analyzeMock).not.toHaveBeenCalled()
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
})
