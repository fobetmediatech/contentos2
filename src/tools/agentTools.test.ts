/**
 * Tests for the T8 agent tool registry + validate/repair layer.
 *
 * The agent loop (useAgentConversation, T8) hands every Gemini functionCall through
 * validateToolCall before dispatching. Unknown tool names (hallucinations) and
 * invalid args become a 'repair' signal the loop feeds back to the model for one
 * retry, then falls back to ask_clarification. This module is that gate — pure,
 * no React, fully testable.
 */

import { describe, it, expect } from 'vitest'
import { AGENT_TOOLS, validateToolCall } from './agentTools'

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
