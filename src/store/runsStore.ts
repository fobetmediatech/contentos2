import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ResultPayload } from '../domain/chat'
import type { RunId, RunKind, RunRecord } from '../domain/runs'
import { makeRunId } from '../domain/runs'
import { supabaseStorage } from './supabaseStorage'

interface RunsState {
  runs: Record<RunId, RunRecord>
  seq: number
  createRun: (input: { conversationId: string; kind: RunKind; targetLabel: string; progress: string }) => RunId
  updateRun: (id: RunId, partial: Partial<Pick<RunRecord, 'progress' | 'status' | 'targetLabel'>>) => void
  finishRun: (id: RunId, result: ResultPayload) => void
  failRun: (id: RunId, error: string) => void
  removeRun: (id: RunId) => void
}

export const useRunsStore = create<RunsState>()(
  persist(
    (set) => ({
      runs: {},
      seq: 0,
      createRun: (input) => {
        const seq = useRunsStore.getState().seq + 1
        const id = makeRunId(seq)
        set((s) => ({
          seq,
          runs: { ...s.runs, [id]: { id, status: 'running', startedAt: Date.now(), ...input } },
        }))
        return id
      },
      updateRun: (id, partial) =>
        set((s) => (s.runs[id] ? { runs: { ...s.runs, [id]: { ...s.runs[id], ...partial } } } : {})),
      finishRun: (id, result) =>
        set((s) => (s.runs[id] ? { runs: { ...s.runs, [id]: { ...s.runs[id], status: 'done', progress: '', result } } } : {})),
      failRun: (id, error) =>
        set((s) => (s.runs[id] ? { runs: { ...s.runs, [id]: { ...s.runs[id], status: 'failed', progress: '', error } } } : {})),
      removeRun: (id) =>
        set((s) => {
          const next = { ...s.runs }
          delete next[id]
          return { runs: next }
        }),
    }),
    {
      name: 'contentos-runs',
      storage: supabaseStorage,
      skipHydration: true,
      version: 1,
      partialize: (s) => ({ runs: s.runs, seq: s.seq }),
      migrate: (s) => s,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<RunsState>
        const runs: Record<RunId, RunRecord> = {}
        for (const [id, run] of Object.entries(p.runs ?? {})) {
          runs[id] =
            run.status === 'running' || run.status === 'queued'
              ? { ...run, status: 'failed', progress: '', error: 'Interrupted by reload' }
              : run
        }
        return { ...current, runs, seq: p.seq ?? current.seq }
      },
    },
  ),
)

export function selectActiveRuns(state: RunsState, conversationId: string): RunRecord[] {
  return Object.values(state.runs).filter(
    (r) => r.conversationId === conversationId && (r.status === 'running' || r.status === 'queued'),
  )
}

export function selectRunsByKind(runs: RunRecord[]): Map<RunKind, RunRecord[]> {
  const map = new Map<RunKind, RunRecord[]>()
  for (const run of runs) {
    const list = map.get(run.kind) ?? []
    list.push(run)
    map.set(run.kind, list)
  }
  return map
}

export function selectActiveRunOfKind(
  state: { runs: Record<RunId, RunRecord> },
  kind: RunKind,
  conversationId: string,
): RunRecord | undefined {
  return Object.values(state.runs)
    .filter((r) => r.kind === kind && r.conversationId === conversationId && (r.status === 'running' || r.status === 'queued'))
    .sort((a, b) => a.startedAt - b.startedAt)[0]
}
