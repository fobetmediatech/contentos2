import { describe, it, expect } from 'vitest'
import { chunk, sleep, ApifyError } from './apifyCore'

describe('chunk', () => {
  it('splits an array into evenly-sized chunks', () => {
    expect(chunk([1, 2, 3, 4, 5, 6], 2)).toEqual([[1, 2], [3, 4], [5, 6]])
  })

  it('last chunk is smaller when array length is not divisible by size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns a single chunk when size >= array length', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]])
  })

  it('returns an empty array when input is empty', () => {
    expect(chunk([], 5)).toEqual([])
  })

  it('works with strings', () => {
    const result = chunk(['a', 'b', 'c', 'd'], 3)
    expect(result).toEqual([['a', 'b', 'c'], ['d']])
  })
})

describe('sleep', () => {
  it('resolves after the given milliseconds', async () => {
    const start = Date.now()
    await sleep(20)
    const elapsed = Date.now() - start
    // Allow generous tolerance for CI timer jitter
    expect(elapsed).toBeGreaterThanOrEqual(15)
  })
})

describe('ApifyError', () => {
  it('sets name, code, status, and message correctly', () => {
    const err = new ApifyError('RATE_LIMITED', 'too many requests', 429)
    expect(err.name).toBe('ApifyError')
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.status).toBe(429)
    expect(err.message).toBe('too many requests')
    expect(err instanceof Error).toBe(true)
  })

  it('is instanceof ApifyError', () => {
    const err = new ApifyError('RUN_FAILED', 'failed', 0)
    expect(err instanceof ApifyError).toBe(true)
  })

  it('carries a POLL_TIMEOUT code with status 0', () => {
    const err = new ApifyError('POLL_TIMEOUT', 'timed out', 0)
    expect(err.code).toBe('POLL_TIMEOUT')
    expect(err.status).toBe(0)
  })
})
