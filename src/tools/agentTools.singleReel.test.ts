import { describe, it, expect } from 'vitest'
import { validateToolCall, decideAction, AGENT_TOOLS, AGENT_SYSTEM_PROMPT } from './agentTools'

describe('analyze_single_reel tool', () => {
  it('is registered and declared', () => {
    expect(AGENT_TOOLS.some((t) => t.name === 'analyze_single_reel')).toBe(true)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/analyze_single_reel/)
  })
  it('validates a single reel URL via reelUrl and normalizes to a canonical reelUrls array', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrl: 'https://instagram.com/reel/ABC123?x=1' })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.args.reelUrls).toEqual(['https://www.instagram.com/reel/ABC123/'])
    }
  })
  it('rejects a non-reel URL', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrl: 'https://instagram.com/garyvee' })
    expect(v.ok).toBe(false)
  })
  it('decideAction dispatches it', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrl: 'https://www.instagram.com/reel/ABC/' })
    if (!v.ok) throw new Error('expected ok')
    // GeminiToolResult discriminant is kind: 'call' (not 'functionCall')
    const action = decideAction({ kind: 'call', name: 'analyze_single_reel', args: v.args } as never)
    expect(action).toMatchObject({ type: 'dispatch', name: 'analyze_single_reel' })
  })
})
