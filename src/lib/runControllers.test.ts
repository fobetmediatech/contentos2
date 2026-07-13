import { describe, it, expect } from 'vitest'
import { registerController, abortRun, hasController } from './runControllers'

describe('runControllers', () => {
  it('aborts only the targeted run, leaving siblings live', () => {
    const a = registerController('run_1')
    const b = registerController('run_2')
    abortRun('run_1')
    expect(a.aborted).toBe(true)
    expect(b.aborted).toBe(false)
    expect(hasController('run_1')).toBe(false)
    expect(hasController('run_2')).toBe(true)
  })

  it('abortRun on an unknown id is a no-op', () => {
    expect(() => abortRun('run_nope')).not.toThrow()
  })
})
