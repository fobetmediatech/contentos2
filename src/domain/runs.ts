import type { ResultPayload } from './chat'

export type RunId = string
export type RunKind = 'competitor' | 'discovery' | 'reel' | 'single-reel' | 'repurpose' | 'transcript'
export type RunStatus = 'queued' | 'running' | 'done' | 'failed'

export interface RunRecord {
  id: RunId
  conversationId: string
  kind: RunKind
  status: RunStatus
  progress: string
  targetLabel: string
  startedAt: number
  result?: ResultPayload
  error?: string
}

export function makeRunId(seq: number): RunId {
  return `run_${seq}`
}
