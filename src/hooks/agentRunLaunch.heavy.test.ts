import { describe, it, expect, beforeEach } from 'vitest'
import { useRunsStore, selectActiveRunOfKind } from '../store/runsStore'
import { launchHeavyRun } from './agentRunLaunch'

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('launchHeavyRun', () => {
  it('creates a running heavy run and invokes start with a live signal', () => {
    let seen: AbortSignal | null = null
    launchHeavyRun('discovery', 'KL food', 'c1', 'Starting…', (sig) => { seen = sig })
    const run = selectActiveRunOfKind(useRunsStore.getState(), 'discovery', 'c1')
    expect(run?.targetLabel).toBe('KL food')
    expect(run?.progress).toBe('Starting…')
    expect(seen).not.toBeNull()
    expect(seen!.aborted).toBe(false)
  })

  it('supersedes a prior active run of the same kind (aborts its signal)', () => {
    let firstSig: AbortSignal | null = null
    launchHeavyRun('discovery', 'first', 'c1', '', (s) => { firstSig = s })
    launchHeavyRun('discovery', 'second', 'c1', '', () => {})
    expect(firstSig!.aborted).toBe(true)
    const runs = Object.values(useRunsStore.getState().runs).filter((r) => r.kind === 'discovery')
    expect(runs).toHaveLength(1)
    expect(runs[0].targetLabel).toBe('second')
  })

  it('does not supersede a different kind', () => {
    launchHeavyRun('discovery', 'd', 'c1', '', () => {})
    launchHeavyRun('competitor', 'c', 'c1', '', () => {})
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'discovery', 'c1')).toBeDefined()
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'competitor', 'c1')).toBeDefined()
  })
})
