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

  // --- Deep-report path (audit fix: deep-only runs were silently dropped on reload) ---
  // A deep report finishes via deepReportStatus while synthesisStatus stays 'idle', so the
  // guard must treat a terminal deep report as a finished run too.

  it('is clean when the deep report is done, even though synthesis never ran (deep-only run)', () => {
    expect(
      isCleanReelRun({ synthesisStatus: 'idle', deepReportStatus: 'done', creatorStates: { a: { status: 'done' } } }),
    ).toBe(true)
  })

  it('is clean when the deep report failed (terminal) with no creator mid-flight', () => {
    expect(
      isCleanReelRun({ synthesisStatus: 'idle', deepReportStatus: 'failed', creatorStates: { a: { status: 'done' } } }),
    ).toBe(true)
  })

  it('is NOT clean while the deep report is still running (interrupted deep-only reload)', () => {
    expect(
      isCleanReelRun({ synthesisStatus: 'idle', deepReportStatus: 'running', creatorStates: { a: { status: 'done' } } }),
    ).toBe(false)
  })

  it('is NOT clean when the deep report is done but a creator is still scraping', () => {
    expect(
      isCleanReelRun({ synthesisStatus: 'idle', deepReportStatus: 'done', creatorStates: { a: { status: 'scraping' } } }),
    ).toBe(false)
  })

  it('is clean when the deep report is unavailable (terminal: backend down, not a stuck spinner)', () => {
    expect(
      isCleanReelRun({ synthesisStatus: 'idle', deepReportStatus: 'unavailable', creatorStates: { a: { status: 'done' } } }),
    ).toBe(true)
  })
})
