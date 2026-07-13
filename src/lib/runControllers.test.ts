import { describe, it, expect, beforeEach } from 'vitest'
import { registerController, abortRun, disposeController, hasController } from './runControllers'

// Dispose known ids before each test to prevent state leaking between tests.
beforeEach(() => {
  disposeController('run_1')
  disposeController('run_2')
  disposeController('run_dispose_test')
})

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

  it('disposeController removes the controller WITHOUT aborting its signal', () => {
    const signal = registerController('run_dispose_test')
    expect(hasController('run_dispose_test')).toBe(true)
    // Signal should not yet be aborted
    expect(signal.aborted).toBe(false)

    disposeController('run_dispose_test')

    // After dispose: entry is gone but the signal was NOT aborted
    expect(hasController('run_dispose_test')).toBe(false)
    expect(signal.aborted).toBe(false)
  })
})
