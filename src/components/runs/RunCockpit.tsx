import { useShallow } from 'zustand/react/shallow'
import { useRunsStore, selectActiveRuns } from '../../store/runsStore'
import type { RunKind } from '../../domain/runs'
import { groupRunsForCockpit } from './runCockpit.model'
import { RunPane } from './RunPane'

export function RunCockpit({
  conversationId,
  focusedKind,
  onFocusKind,
}: {
  conversationId: string
  focusedKind: RunKind | null
  onFocusKind: (kind: RunKind) => void
}) {
  const runs = useRunsStore(useShallow((s) => selectActiveRuns(s, conversationId)))
  const { panes, queuedKinds } = groupRunsForCockpit(runs)
  const isCounter = panes.some((p) => p.runs.length > 1)
  if (panes.length < 2 && !isCounter) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {panes.map((pane) => (
          <RunPane
            key={pane.kind}
            pane={pane}
            focused={focusedKind === pane.kind}
            onFocus={() => onFocusKind(pane.kind)}
          />
        ))}
      </div>
      {queuedKinds.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          {queuedKinds.map((k) => (
            <span
              key={k}
              className="px-2 py-1 rounded-full border border-[rgba(var(--border-rgb),0.10)]"
            >
              {k} queued
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
