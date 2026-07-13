import type { RunKind, RunRecord } from '../../domain/runs'

export interface CockpitPane { kind: RunKind; runs: RunRecord[] }
export interface CockpitLayout { panes: CockpitPane[]; queuedKinds: RunKind[] }

export function groupRunsForCockpit(active: RunRecord[], maxPanes = 4): CockpitLayout {
  const order: RunKind[] = []
  const byKind = new Map<RunKind, RunRecord[]>()
  for (const run of [...active].sort((a, b) => a.startedAt - b.startedAt)) {
    if (!byKind.has(run.kind)) { byKind.set(run.kind, []); order.push(run.kind) }
    byKind.get(run.kind)!.push(run)
  }
  const shown = order.slice(0, maxPanes)
  const queuedKinds = order.slice(maxPanes)
  return { panes: shown.map((kind) => ({ kind, runs: byKind.get(kind)! })), queuedKinds }
}
