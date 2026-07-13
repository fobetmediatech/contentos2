import { Check, Loader2, Clock, AlertTriangle } from 'lucide-react'
import type { RunRecord, RunStatus } from '../../domain/runs'

const icon = (status: RunStatus) => {
  if (status === 'done') return <Check size={12} className="text-success" />
  if (status === 'failed') return <AlertTriangle size={12} className="text-danger" />
  if (status === 'queued') return <Clock size={12} className="text-[var(--color-text-muted)]" />
  return <Loader2 size={12} className="animate-spin text-warning" />
}

export function PaneCounterList({ runs, onViewAll }: { runs: RunRecord[]; onViewAll?: () => void }) {
  const running = runs.filter((r) => r.status === 'running' || r.status === 'queued').length
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-text-muted)]">{running} running</span>
      {runs.map((r) => (
        <div key={r.id} className="flex items-center gap-1.5 text-xs text-secondary">
          {icon(r.status)}
          <span className="truncate">{r.targetLabel}</span>
        </div>
      ))}
      {onViewAll && (
        <button onClick={onViewAll} className="self-start text-xs text-[var(--color-accent)] hover:underline">
          View all {runs.length} ›
        </button>
      )}
    </div>
  )
}
