import type { RunKind } from '../domain/runs'
import { useRunsStore } from '../store/runsStore'
import { registerController } from '../lib/runControllers'

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
