import { describe, it, expect } from 'vitest'
import { buildDeepReelPrompt } from '../deepReelPrompt'

describe('server buildDeepReelPrompt mirrors the client', () => {
  const p = buildDeepReelPrompt('comment GUIDE for the checklist')
  it('has the strengthened rules', () => {
    expect(p).toMatch(/\[m:ss\]/)
    expect(p).toMatch(/never fabricate a timestamp/i)
    expect(p).toMatch(/compound/i)
    expect(p).toMatch(/funnel/i)
    expect(p).toMatch(/because/i)
  })
})
