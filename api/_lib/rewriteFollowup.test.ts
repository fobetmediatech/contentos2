import { describe, it, expect } from 'vitest'
import { recentTurns, needsRewrite, type Turn } from './rewriteFollowup.js'

const turn = (i: number): Turn => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `t${i}` })

describe('recentTurns', () => {
  it('returns an empty array for no history', () => {
    expect(recentTurns([])).toEqual([])
  })

  it('keeps the last 4 turns by default, oldest first', () => {
    const out = recentTurns([0, 1, 2, 3, 4, 5].map(turn))
    expect(out.map((t) => t.content)).toEqual(['t2', 't3', 't4', 't5'])
  })

  it('returns everything when history is shorter than the window', () => {
    expect(recentTurns([turn(0), turn(1)]).map((t) => t.content)).toEqual(['t0', 't1'])
  })

  it('honours an explicit window', () => {
    expect(recentTurns([0, 1, 2, 3].map(turn), 2).map((t) => t.content)).toEqual(['t2', 't3'])
  })
})

describe('needsRewrite', () => {
  // The first question has nothing to resolve against, so it must cost no model call at all.
  it('is false with no history', () => {
    expect(needsRewrite([])).toBe(false)
  })

  it('is true once there is a prior turn', () => {
    expect(needsRewrite([turn(0)])).toBe(true)
  })
})
