import type { RunKind } from '../domain/runs'
import { useRunsStore } from '../store/runsStore'
import { abortRun, registerController } from '../lib/runControllers'

/** Create one run per url and launch it with its own AbortSignal. No sibling aborts. */
export function launchReelUrlRuns(
  kind: Extract<RunKind, 'transcript' | 'single-reel'>,
  urls: string[],
  conversationId: string,
  start: (runId: string, url: string, signal: AbortSignal) => void,
): void {
  for (const url of urls) {
    const runId = useRunsStore.getState().createRun({
      conversationId, kind, targetLabel: url, progress: kind === 'transcript' ? 'Transcribing…' : 'Analysing…',
    })
    const signal = registerController(runId)
    start(runId, url, signal)
  }
}

export function launchHeavyRun(
  kind: Exclude<RunKind, 'transcript' | 'single-reel'>,
  targetLabel: string,
  conversationId: string,
  initialProgress: string,
  start: (signal: AbortSignal) => void,
): void {
  // One-at-a-time within kind: supersede any existing active run of this kind.
  for (const r of Object.values(useRunsStore.getState().runs)) {
    if (r.kind === kind && r.conversationId === conversationId && (r.status === 'running' || r.status === 'queued')) {
      abortRun(r.id)
      useRunsStore.getState().removeRun(r.id)
    }
  }
  const runId = useRunsStore.getState().createRun({ conversationId, kind, targetLabel, progress: initialProgress })
  const signal = registerController(runId)
  start(signal)
}
