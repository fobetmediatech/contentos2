import { describe, it, expect } from 'vitest'
import { isCleanReelRun } from './reelPersist'

describe('isCleanReelRun', () => {
  it('is clean when synthesis is done and every creator finished', () => {
    expect(
      isCleanReelRun({ synthesisStatus: 'done', creatorStates: { a: { status: 'done' }, b: { status: 'no-reels' } } }),
    ).toBe(true)
  })

  it('is clean when synthesis failed but no creator is mid-flight', () => {
    expect(
      isCleanReelRun({ synthesisStatus: 'failed', creatorStates: { a: { status: 'failed' } } }),
    ).toBe(true)
  })

  it('is NOT clean while synthesis is still running (interrupted reload)', () => {
    expect(
      isCleanReelRun({ synthesisStatus: 'running', creatorStates: { a: { status: 'done' } } }),
    ).toBe(false)
  })

  it('is NOT clean when any creator is still scraping/analyzing', () => {
    expect(
      isCleanReelRun({ synthesisStatus: 'done', creatorStates: { a: { status: 'done' }, b: { status: 'analyzing' } } }),
    ).toBe(false)
  })

  it('is clean for an empty run (no creators, idle is not terminal → false)', () => {
    expect(isCleanReelRun({ synthesisStatus: 'idle', creatorStates: {} })).toBe(false)
  })
})
