import { describe, it, expect } from 'vitest'
import { makeRunId } from './runs'

describe('makeRunId', () => {
  it('formats a stable id from a sequence number', () => {
    expect(makeRunId(1)).toBe('run_1')
    expect(makeRunId(42)).toBe('run_42')
  })
})
