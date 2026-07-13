import { describe, it, expect } from 'vitest'
import { groupRunsForCockpit } from './runCockpit.model'
import type { RunRecord } from '../../domain/runs'

const run = (id: string, kind: RunRecord['kind'], startedAt: number): RunRecord =>
  ({ id, kind, startedAt, conversationId: 'c1', status: 'running', progress: '', targetLabel: id })

describe('groupRunsForCockpit', () => {
  it('makes one pane per kind, grouping same-kind runs', () => {
    const layout = groupRunsForCockpit([run('1', 'transcript', 1), run('2', 'transcript', 2), run('3', 'single-reel', 3)])
    expect(layout.panes.map((p) => p.kind)).toEqual(['transcript', 'single-reel'])
    expect(layout.panes[0].runs.map((r) => r.id)).toEqual(['1', '2'])
    expect(layout.queuedKinds).toEqual([])
  })

  it('queues kinds beyond the 4-pane cap', () => {
    const kinds: RunRecord['kind'][] = ['transcript', 'single-reel', 'reel', 'discovery', 'competitor']
    const layout = groupRunsForCockpit(kinds.map((k, i) => run(String(i), k, i)))
    expect(layout.panes).toHaveLength(4)
    expect(layout.queuedKinds).toEqual(['competitor'])
  })
})
