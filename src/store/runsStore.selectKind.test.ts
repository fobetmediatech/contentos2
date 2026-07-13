import { describe, it, expect, beforeEach } from 'vitest'
import { useRunsStore, selectActiveRunOfKind } from './runsStore'

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('selectActiveRunOfKind', () => {
  it('returns the active run of a kind for a conversation', () => {
    const s = useRunsStore.getState()
    const d = s.createRun({ conversationId: 'c1', kind: 'discovery', targetLabel: 'KL', progress: '' })
    s.createRun({ conversationId: 'c1', kind: 'competitor', targetLabel: 'x', progress: '' })
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'discovery', 'c1')?.id).toBe(d)
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'reel', 'c1')).toBeUndefined()
  })

  it('ignores finished runs and other conversations', () => {
    const s = useRunsStore.getState()
    const d = s.createRun({ conversationId: 'c1', kind: 'discovery', targetLabel: 'a', progress: '' })
    useRunsStore.getState().finishRun(d, { kind: 'discovery', results: [], city: '', profiles: [], didExpand: false, locationRelaxed: false })
    s.createRun({ conversationId: 'c2', kind: 'discovery', targetLabel: 'b', progress: '' })
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'discovery', 'c1')).toBeUndefined()
  })
})
