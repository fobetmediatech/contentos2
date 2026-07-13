import { describe, it, expect, beforeEach } from 'vitest'
import { useRunsStore, selectActiveRuns, selectRunsByKind } from './runsStore'

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('runsStore', () => {
  it('creates a running run with a sequential id', () => {
    const id = useRunsStore.getState().createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'reel abc', progress: 'Scraping…' })
    expect(id).toBe('run_1')
    const run = useRunsStore.getState().runs[id]
    expect(run.status).toBe('running')
    expect(run.kind).toBe('transcript')
    expect(run.conversationId).toBe('c1')
  })

  it('finishRun stores the result and clears progress', () => {
    const id = useRunsStore.getState().createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'r', progress: 'x' })
    useRunsStore.getState().finishRun(id, { kind: 'transcript', reelUrl: 'u', transcript: 't', segments: [] })
    const run = useRunsStore.getState().runs[id]
    expect(run.status).toBe('done')
    expect(run.progress).toBe('')
    expect(run.result?.kind).toBe('transcript')
  })

  it('selectActiveRuns returns only queued/running runs for a conversation', () => {
    const s = useRunsStore.getState()
    const a = s.createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'a', progress: '' })
    const b = s.createRun({ conversationId: 'c1', kind: 'single-reel', targetLabel: 'b', progress: '' })
    const other = s.createRun({ conversationId: 'c2', kind: 'transcript', targetLabel: 'x', progress: '' })
    useRunsStore.getState().finishRun(b, { kind: 'transcript', reelUrl: 'u', transcript: '', segments: [] })
    const active = selectActiveRuns(useRunsStore.getState(), 'c1')
    expect(active.map((r) => r.id)).toEqual([a])
    expect(selectActiveRuns(useRunsStore.getState(), 'c2').map((r) => r.id)).toEqual([other])
  })

  it('selectRunsByKind groups active runs by tool kind', () => {
    const s = useRunsStore.getState()
    s.createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'a', progress: '' })
    s.createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'b', progress: '' })
    s.createRun({ conversationId: 'c1', kind: 'single-reel', targetLabel: 'c', progress: '' })
    const grouped = selectRunsByKind(selectActiveRuns(useRunsStore.getState(), 'c1'))
    expect(grouped.get('transcript')?.length).toBe(2)
    expect(grouped.get('single-reel')?.length).toBe(1)
  })
})
