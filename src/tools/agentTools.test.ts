/**
 * Tests for the T8 agent tool registry + validate/repair layer.
 *
 * The agent loop (useAgentConversation, T8) hands every Gemini functionCall through
 * validateToolCall before dispatching. Unknown tool names (hallucinations) and
 * invalid args become a 'repair' signal the loop feeds back to the model for one
 * retry, then falls back to ask_clarification. This module is that gate — pure,
 * no React, fully testable.
 */

import { describe, it, expect, vi } from 'vitest'
import { AGENT_TOOLS, validateToolCall, decideAction, runAgentTurn } from './agentTools'
import type { GeminiToolResult, GeminiTurn } from '../ai/gemini'

describe('AGENT_TOOLS declarations', () => {
  it('declares exactly the 5 agent tools, each with name/description/parameters', () => {
    const names = AGENT_TOOLS.map((t) => t.name).sort()
    expect(names).toEqual([
      'analyze_reels',
      'answer_content',
      'ask_clarification',
      'discover_by_location',
      'discover_competitors',
    ])
    for (const t of AGENT_TOOLS) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
      expect(typeof t.parameters).toBe('object')
    }
  })
})

describe('validateToolCall', () => {
  it('accepts ask_clarification with a question', () => {
    const r = validateToolCall('ask_clarification', { question: 'Which kind of fitness?' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.name).toBe('ask_clarification')
      expect((r.args as { question: string }).question).toBe('Which kind of fitness?')
    }
  })

  it('accepts discover_competitors with handles and NO niche (niche OR handles)', () => {
    const r = validateToolCall('discover_competitors', { knownHandles: ['nike.training'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.args as { knownHandles: string[] }).knownHandles).toContain('nike.training')
  })

  it('accepts discover_competitors with a niche and no handles', () => {
    expect(validateToolCall('discover_competitors', { niche: 'fitness creators' }).ok).toBe(true)
  })

  it('rejects discover_competitors with NEITHER niche nor handles', () => {
    const r = validateToolCall('discover_competitors', {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_args')
  })

  it('requires a city for discover_by_location', () => {
    expect(validateToolCall('discover_by_location', { niche: 'food', city: 'Pune' }).ok).toBe(true)
    const r = validateToolCall('discover_by_location', { niche: 'food' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_args')
  })

  it('requires at least one handle for analyze_reels', () => {
    expect(validateToolCall('analyze_reels', { handles: ['garyvee'] }).ok).toBe(true)
    const r = validateToolCall('analyze_reels', { handles: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_args')
  })

  it('accepts answer_content with a message', () => {
    expect(validateToolCall('answer_content', { message: 'write me 5 hooks' }).ok).toBe(true)
  })

  it('flags an unknown / hallucinated tool name as unknown_tool', () => {
    const r = validateToolCall('frobnicate', { foo: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_tool')
  })

  it('normalizes @handles (strips @, lowercases) for discover_competitors', () => {
    const r = validateToolCall('discover_competitors', { knownHandles: ['@Nike.Training', '@GymShark'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.args as { knownHandles: string[] }).knownHandles).toEqual(['nike.training', 'gymshark'])
  })
})

describe('decideAction', () => {
  it('renders a free-text reply (no tool call) as a message', () => {
    const a = decideAction({ kind: 'text', text: 'Which city did you mean?' })
    expect(a).toEqual({ type: 'message', text: 'Which city did you mean?' })
  })

  it('routes ask_clarification → ask', () => {
    const r: GeminiToolResult = { kind: 'call', name: 'ask_clarification', args: { question: 'Which kind of fitness?' } }
    expect(decideAction(r)).toEqual({ type: 'ask', question: 'Which kind of fitness?' })
  })

  it('routes answer_content → answer', () => {
    const r: GeminiToolResult = { kind: 'call', name: 'answer_content', args: { message: 'write me 5 hooks' } }
    expect(decideAction(r)).toEqual({ type: 'answer', message: 'write me 5 hooks' })
  })

  it('routes a valid pipeline tool → dispatch (with parsed args)', () => {
    const a = decideAction({ kind: 'call', name: 'discover_by_location', args: { niche: 'food', city: 'Pune' } })
    expect(a.type).toBe('dispatch')
    if (a.type === 'dispatch') {
      expect(a.name).toBe('discover_by_location')
      expect((a.args as { city: string }).city).toBe('Pune')
    }
  })

  it('routes an unknown / hallucinated tool → repair', () => {
    const a = decideAction({ kind: 'call', name: 'frobnicate', args: {} })
    expect(a.type).toBe('repair')
    if (a.type === 'repair') expect(a.detail).toMatch(/unknown tool/i)
  })

  it('routes invalid args → repair', () => {
    const a = decideAction({ kind: 'call', name: 'discover_competitors', args: {} })
    expect(a.type).toBe('repair')
  })
})

describe('runAgentTurn', () => {
  const HISTORY: GeminiTurn[] = [{ role: 'user', parts: [{ text: 'top fitness creators' }] }]

  it('returns a valid dispatch with a single model call (no repair)', async () => {
    const callModel = vi.fn().mockResolvedValue({
      kind: 'call', name: 'discover_by_location', args: { niche: 'food', city: 'Pune' },
    } as GeminiToolResult)
    const action = await runAgentTurn(HISTORY, callModel)
    expect(action.type).toBe('dispatch')
    expect(callModel).toHaveBeenCalledTimes(1)
  })

  it('returns a free-text reply as a message', async () => {
    const callModel = vi.fn().mockResolvedValue({ kind: 'text', text: 'which city?' } as GeminiToolResult)
    expect(await runAgentTurn(HISTORY, callModel)).toEqual({ type: 'message', text: 'which city?' })
  })

  it('repairs an invalid call once, then succeeds — 2nd call gets the repair detail', async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'call', name: 'discover_competitors', args: {} } as GeminiToolResult)
      .mockResolvedValueOnce({ kind: 'call', name: 'discover_competitors', args: { niche: 'fitness' } } as GeminiToolResult)
    const action = await runAgentTurn(HISTORY, callModel)
    expect(action.type).toBe('dispatch')
    expect(callModel).toHaveBeenCalledTimes(2)
    expect(callModel.mock.calls[1][1]).toBeTruthy() // repair detail passed on the retry
  })

  it('falls back to ask when repairs are exhausted', async () => {
    const callModel = vi.fn().mockResolvedValue({ kind: 'call', name: 'frobnicate', args: {} } as GeminiToolResult)
    const action = await runAgentTurn(HISTORY, callModel, { maxRepairs: 1 })
    expect(action.type).toBe('ask')
    expect(callModel).toHaveBeenCalledTimes(2) // initial + 1 repair
  })
})
