import { FileText, Video, Loader2 } from 'lucide-react'
import type { RunKind } from '../../domain/runs'
import type { CockpitPane } from './runCockpit.model'
import { PaneCounterList } from './PaneCounterList'

const kindIcon: Record<RunKind, typeof FileText> = {
  transcript: FileText,
  'single-reel': Video,
  reel: Video,
  discovery: Video,
  competitor: Video,
  repurpose: Video,
}

const kindLabel: Record<RunKind, string> = {
  transcript: 'Transcript',
  'single-reel': 'Case study',
  reel: 'Reel hooks',
  discovery: 'Discovery',
  competitor: 'Competitors',
  repurpose: 'Repurpose',
}

export function RunPane({
  pane,
  focused,
  onFocus,
}: {
  pane: CockpitPane
  focused: boolean
  onFocus: () => void
}) {
  const Icon = kindIcon[pane.kind]
  const single = pane.runs.length === 1 ? pane.runs[0] : null
  return (
    <button
      onClick={onFocus}
      className={`text-left bg-surface border rounded-2xl p-3 flex flex-col gap-2 ${
        focused
          ? 'border-[var(--color-accent)]'
          : 'border-[rgba(var(--border-rgb),0.08)]'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={14} className="text-secondary" />
        <span className="text-xs font-semibold text-primary">{kindLabel[pane.kind]}</span>
      </div>
      {single ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-primary truncate">{single.targetLabel}</span>
          {single.progress && (
            <div className="flex items-center gap-1.5 text-xs text-secondary">
              <Loader2 size={12} className="animate-spin text-warning" />
              <span className="truncate">{single.progress}</span>
            </div>
          )}
        </div>
      ) : (
        <PaneCounterList runs={pane.runs} />
      )}
    </button>
  )
}
