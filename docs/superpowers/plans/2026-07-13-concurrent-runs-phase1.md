# Concurrent Runs — Phase 1 (Registry Foundation + Transcript/Single-Reel Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a multi-run registry that replaces the single-run model for the two reel-URL tools (transcript, single-reel), and render concurrent runs in a split-pane "cockpit" — proving the panes + same-tool counter + queue patterns end-to-end.

**Architecture:** A new `runsStore` (Zustand, persisted) holds `Record<RunId, RunRecord>`; AbortControllers live in a non-persisted module `Map`. The transcript and single-reel pipeline hooks are refactored to be run-scoped (`startX(runId, args, signal)` writing into the registry). The agent loop creates a run per dispatch instead of aborting siblings. A new `RunCockpit` reads active runs for the current conversation and renders one pane per tool-kind, with same-kind runs grouped into a counter. On finish, a run snapshots into a `type:'result'` transcript message (existing pattern) and leaves the active set.

**Tech Stack:** React, Zustand (+ persist middleware, supabaseStorage), TypeScript, vitest, Tailwind.

## Global Constraints

- Package manager is **bun** (`bun run test`, `bun run build`, `bun run lint`). Never npm/yarn.
- Persisted Zustand stores MUST have `version: N` + a `migrate(state, version)` function (per CLAUDE.md).
- Persisted payload `kind` discriminants are **frozen** — reuse `ResultPayload` shapes from `src/domain/chat.ts` verbatim.
- Design system (DESIGN.md): background `#1A1410` (`bg-chai`), accent saffron `#E07B3A` (`--color-accent`), AI content violet `#A78BFA` (`--color-ai-tint`); fonts Instrument Serif / Outfit / DM Mono. No Inter, no slate grays, no indigo. Match existing result-component class patterns.
- Research-target data never logs in prod — use `devLog` (DEV-only), never `console.log`, for any run/handle data.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.

---

## File Structure

**Create:**
- `src/domain/runs.ts` — `RunId`, `RunKind`, `RunStatus`, `RunRecord` union, helper `makeRunId`.
- `src/store/runsStore.ts` — the registry store + selectors.
- `src/store/runsStore.test.ts` — reducer/selector/migration tests.
- `src/lib/runControllers.ts` — non-persisted AbortController registry.
- `src/lib/runControllers.test.ts` — abort-isolation tests.
- `src/components/runs/RunCockpit.tsx` — layout: one pane per active tool-kind + queued chips.
- `src/components/runs/RunPane.tsx` — a single tool-kind pane (live progress or counter).
- `src/components/runs/PaneCounterList.tsx` — same-kind stacked rows + `n/N` badge + "View all".
- `src/components/runs/runCockpit.model.ts` — pure grouping/queue logic (`groupRunsForCockpit`).
- `src/components/runs/runCockpit.model.test.ts` — grouping/queue tests.

**Modify:**
- `src/hooks/useTranscriptAnalysis.ts` — `startTranscript(runId, reelUrl, signal)` writes to `runsStore`.
- `src/hooks/useSingleReelAnalysis.ts` — `startSingleReel(runId, reelUrl, signal)` writes to `runsStore`.
- `src/hooks/useAgentConversation.ts` — `dispatchTool` creates runs for `get_reel_transcript` / `analyze_single_reel`; scoped abort; fan-out for multiple reel URLs.
- `src/pages/ChatPage.tsx` — render `<RunCockpit>`; snapshot finished registry runs into result messages; focused-pane input + "New run".

**Delete (end of Phase 1, only these two):**
- `src/store/transcriptStore.ts`
- `src/store/singleReelStore.ts`
- (Their result components `TranscriptResultMessage.tsx` / `SingleReelResultMessage.tsx` are reworked to read from a passed run/result, not the deleted stores.)

**Untouched in Phase 1 (migrated in Plan 2):** `analysisStore`, `discoveryStore`, `reelAnalysisStore`, `repurposeStore` and their hooks/components keep working exactly as today.

---

## Task 1: Run domain types

**Files:**
- Create: `src/domain/runs.ts`
- Test: `src/domain/runs.test.ts`

**Interfaces:**
- Produces:
  - `type RunId = string`
  - `type RunKind = 'competitor' | 'discovery' | 'reel' | 'single-reel' | 'repurpose' | 'transcript'`
  - `type RunStatus = 'queued' | 'running' | 'done' | 'failed'`
  - `interface RunRecord { id: RunId; conversationId: string; kind: RunKind; status: RunStatus; progress: string; targetLabel: string; startedAt: number; result?: import('./chat').ResultPayload; error?: string }`
  - `function makeRunId(seq: number): RunId` — deterministic id `run_<seq>` (no `Math.random`/`Date.now` so tests are stable; the store owns the counter).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { makeRunId } from './runs'

describe('makeRunId', () => {
  it('formats a stable id from a sequence number', () => {
    expect(makeRunId(1)).toBe('run_1')
    expect(makeRunId(42)).toBe('run_42')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/domain/runs.test.ts`
Expected: FAIL — cannot find module `./runs`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/domain/runs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/runs.ts src/domain/runs.test.ts
git commit -m "feat(runs): run domain types + makeRunId"
```

---

## Task 2: AbortController registry (runtime, abort isolation)

**Files:**
- Create: `src/lib/runControllers.ts`
- Test: `src/lib/runControllers.test.ts`

**Interfaces:**
- Consumes: `RunId` from `src/domain/runs.ts`.
- Produces:
  - `function registerController(id: RunId): AbortSignal` — creates + stores a fresh `AbortController`, returns its signal.
  - `function abortRun(id: RunId): void` — aborts + disposes that run's controller (no-op if absent).
  - `function disposeController(id: RunId): void` — removes without aborting.
  - `function hasController(id: RunId): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { registerController, abortRun, hasController } from './runControllers'

describe('runControllers', () => {
  it('aborts only the targeted run, leaving siblings live', () => {
    const a = registerController('run_1')
    const b = registerController('run_2')
    abortRun('run_1')
    expect(a.aborted).toBe(true)
    expect(b.aborted).toBe(false)
    expect(hasController('run_1')).toBe(false)
    expect(hasController('run_2')).toBe(true)
  })

  it('abortRun on an unknown id is a no-op', () => {
    expect(() => abortRun('run_nope')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/lib/runControllers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { RunId } from '../domain/runs'

const controllers = new Map<RunId, AbortController>()

export function registerController(id: RunId): AbortSignal {
  const ctrl = new AbortController()
  controllers.set(id, ctrl)
  return ctrl.signal
}

export function abortRun(id: RunId): void {
  const ctrl = controllers.get(id)
  if (!ctrl) return
  ctrl.abort()
  controllers.delete(id)
}

export function disposeController(id: RunId): void {
  controllers.delete(id)
}

export function hasController(id: RunId): boolean {
  return controllers.has(id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/lib/runControllers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runControllers.ts src/lib/runControllers.test.ts
git commit -m "feat(runs): AbortController registry with abort isolation"
```

---

## Task 3: `runsStore` — registry store, actions, selectors

**Files:**
- Create: `src/store/runsStore.ts`
- Test: `src/store/runsStore.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `RunId`, `RunKind`, `makeRunId` from `src/domain/runs.ts`; `supabaseStorage` from `src/store/supabaseStorage.ts`.
- Produces the Zustand store `useRunsStore` with:
  - state: `runs: Record<RunId, RunRecord>`, `seq: number`
  - `createRun(input: { conversationId: string; kind: RunKind; targetLabel: string; progress: string }): RunId` — allocates `run_<++seq>`, inserts with `status:'running'`, `startedAt: 0` (caller may stamp), returns the id.
  - `updateRun(id: RunId, partial: Partial<Pick<RunRecord,'progress'|'status'|'targetLabel'>>): void`
  - `finishRun(id: RunId, result: ResultPayload): void` — sets `status:'done'`, `result`, clears `progress`.
  - `failRun(id: RunId, error: string): void` — sets `status:'failed'`, `error`, clears `progress`.
  - `removeRun(id: RunId): void`
  - pure selector helpers exported alongside (not store methods): `selectActiveRuns(state, conversationId): RunRecord[]` (status `queued`|`running`), `selectRunsByKind(runs: RunRecord[]): Map<RunKind, RunRecord[]>`.
- Persist: `name:'contentos-runs'`, `storage: supabaseStorage`, `skipHydration:true`, `version:1`, `partialize` → `{ runs, seq }`, `migrate:(s)=>s`, and a `merge` that marks any restored `running`/`queued` run as `failed` with `error:'Interrupted by reload'` (Phase 3 will replace this with resume).

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/store/runsStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
          runs: { ...s.runs, [id]: { id, status: 'running', startedAt: 0, ...input } },
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/store/runsStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/runsStore.ts src/store/runsStore.test.ts
git commit -m "feat(runs): runsStore registry with active/by-kind selectors + reload guard"
```

---

## Task 4: Cockpit grouping/queue model (pure)

**Files:**
- Create: `src/components/runs/runCockpit.model.ts`
- Test: `src/components/runs/runCockpit.model.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `RunKind` from `src/domain/runs.ts`.
- Produces:
  - `interface CockpitPane { kind: RunKind; runs: RunRecord[] }`
  - `interface CockpitLayout { panes: CockpitPane[]; queuedKinds: RunKind[] }`
  - `function groupRunsForCockpit(active: RunRecord[], maxPanes = 4): CockpitLayout` — one pane per kind, ordered by the earliest `startedAt`/insertion of that kind; kinds beyond `maxPanes` become `queuedKinds` (their runs are not shown as panes). Same-kind runs stay together in one pane.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/runs/runCockpit.model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/components/runs/runCockpit.model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/runs/runCockpit.model.ts src/components/runs/runCockpit.model.test.ts
git commit -m "feat(runs): pure cockpit grouping + >4 queue model"
```

---

## Task 5: Refactor `useTranscriptAnalysis` to be run-scoped

**Files:**
- Modify: `src/hooks/useTranscriptAnalysis.ts` (currently `startTranscript(reelUrl, signal)` writing to `transcriptStore` — see map: `startRun`/`setProgress`/`setResult`/`setError`).
- Test: `src/hooks/useTranscriptAnalysis.test.ts`

**Interfaces:**
- Consumes: `useRunsStore` from `src/store/runsStore.ts`.
- Produces: `startTranscript(runId: RunId, reelUrl: string, signal: AbortSignal): Promise<void>` — resolves the shortCode, writes progress via `useRunsStore.getState().updateRun(runId, { progress })`, and on success calls `finishRun(runId, { kind:'transcript', reelUrl, transcript, segments })`; on failure `failRun(runId, message)`. Abort → silent return (no store write), matching current guards.

**Field mapping (old → new):**
| Old (`transcriptStore`) | New (`runsStore`) |
|---|---|
| `startRun(shortCode, url, convId)` | run already created by caller; `updateRun(runId,{progress:'Transcribing…'})` |
| `setProgress('Transcribing…')` | `updateRun(runId,{progress:'Transcribing…'})` |
| `setResult(json.result)` | `finishRun(runId, { kind:'transcript', reelUrl: canonicalUrl, transcript: json.result.transcript, segments: json.result.segments })` |
| `setError(msg)` | `failRun(runId, msg)` |

- [ ] **Step 1: Write the failing test** (drives the new signature + finishRun payload)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRunsStore } from '../store/runsStore'
import { useTranscriptAnalysis } from './useTranscriptAnalysis'

vi.mock('../lib/reelScraper', () => ({ resolveShortCode: () => 'abc', canonicalReelUrl: (u: string) => u }))
// Mock the transcript fetch used by the hook to return a known result.
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ result: { transcript: 'hi', segments: [] } }) }))

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('useTranscriptAnalysis run-scoped', () => {
  it('finishes the run with a transcript result payload', async () => {
    const runId = useRunsStore.getState().createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'r', progress: '' })
    const { result } = renderHook(() => useTranscriptAnalysis())
    await result.current.startTranscript(runId, 'https://insta/reel/abc', new AbortController().signal)
    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('done')
    expect(run.result).toMatchObject({ kind: 'transcript', transcript: 'hi' })
  })
})
```

> NOTE: adapt the `vi.mock` target to the actual scraper import in the current file (check the import block of `useTranscriptAnalysis.ts` — the map shows it resolves a shortCode + canonical URL and POSTs to a transcript endpoint). Mock exactly those imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/hooks/useTranscriptAnalysis.test.ts`
Expected: FAIL — `startTranscript` signature mismatch / still writes to old store.

- [ ] **Step 3: Implement — change the signature and swap the store writes**

Edit `src/hooks/useTranscriptAnalysis.ts`:
- Change `const startTranscript = useCallback(async (reelUrl: string, signal?: AbortSignal) => {` to `async (runId: RunId, reelUrl: string, signal: AbortSignal) => {` (import `RunId` from `../domain/runs`).
- Remove the `useTranscriptStore` import and its `startRun/setProgress/setResult/setError` calls; replace per the mapping table using `useRunsStore.getState()`.
- Keep all abort guards (`if (signal.aborted) return`) unchanged.
- Keep the shortCode/canonical-URL resolution + fetch logic unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/hooks/useTranscriptAnalysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTranscriptAnalysis.ts src/hooks/useTranscriptAnalysis.test.ts
git commit -m "refactor(runs): make transcript hook run-scoped against runsStore"
```

---

## Task 6: Refactor `useSingleReelAnalysis` to be run-scoped

**Files:**
- Modify: `src/hooks/useSingleReelAnalysis.ts` (currently `startSingleReel(reelUrl, signal)` writing to `singleReelStore`).
- Test: `src/hooks/useSingleReelAnalysis.test.ts`

**Interfaces:**
- Produces: `startSingleReel(runId: RunId, reelUrl: string, signal: AbortSignal): Promise<void>`.
- The single-reel result has no existing `ResultPayload` member (the case study lives in `singleReelStore.result: SingleReelResult`). Add a new frozen payload kind to `src/domain/chat.ts`:
  - `interface SingleReelResultPayload { kind: 'single-reel'; reelUrl: string; shortCode: string | null; result: import('../store/singleReelStore').SingleReelResult }` — BUT `singleReelStore` is being deleted, so first move the `SingleReelResult`/`ReelExtraction`/`ReelSegment`/`ReelVideoAnalysis` type definitions from `singleReelStore.ts` into `src/domain/reel.ts` (new file) and re-export; then reference them from `chat.ts`.
  - Add `SingleReelResultPayload` to the `ResultPayload` union and add `'single-reel'` result rendering (Task 9).

**Field mapping (old → new):**
| Old (`singleReelStore`) | New (`runsStore`) |
|---|---|
| `startRun(shortCode, url, convId)` | run created by caller; `updateRun(runId,{ progress:'Scraping reel…', targetLabel: shortCode ?? url })` |
| `setProgress('Transcribing & analysing…')` | `updateRun(runId,{ progress:'Transcribing & analysing…' })` |
| `setResult(json.result)` | `finishRun(runId, { kind:'single-reel', reelUrl: canonicalUrl, shortCode, result: json.result })` |
| `setError(msg)` | `failRun(runId, msg)` |
| corpus `rememberContent([...])` | unchanged (fire-and-forget) |

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRunsStore } from '../store/runsStore'
import { useSingleReelAnalysis } from './useSingleReelAnalysis'

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ result: { markdown: '# case', transcript: '', segments: [], videoAnalysis: {} } }) }))
// mock scraper import(s) as in the current file to yield shortCode 'abc' + canonical url

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('useSingleReelAnalysis run-scoped', () => {
  it('finishes with a single-reel result payload', async () => {
    const runId = useRunsStore.getState().createRun({ conversationId: 'c1', kind: 'single-reel', targetLabel: 'r', progress: '' })
    const { result } = renderHook(() => useSingleReelAnalysis())
    await result.current.startSingleReel(runId, 'https://insta/reel/abc', new AbortController().signal)
    const run = useRunsStore.getState().runs[runId]
    expect(run.status).toBe('done')
    expect(run.result).toMatchObject({ kind: 'single-reel' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/hooks/useSingleReelAnalysis.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

1. Create `src/domain/reel.ts` and move `ReelSegment`, `ReelVideoAnalysis`, `ReelExtraction`, `SingleReelResult` type defs there (cut from `singleReelStore.ts`). Update any importers of these types to import from `../domain/reel` (grep: `from '../store/singleReelStore'` type-only imports; e.g. `reelAnalysisStore.ts`, components using `SingleReelResult`).
2. In `src/domain/chat.ts`: `import type { SingleReelResult } from './reel'`, add `SingleReelResultPayload`, extend `ResultPayload`.
3. In `useSingleReelAnalysis.ts`: change signature to `(runId: RunId, reelUrl: string, signal: AbortSignal)`, remove `useSingleReelStore` usage, apply the mapping table via `useRunsStore.getState()`. Keep abort guards + corpus harvest unchanged.

- [ ] **Step 4: Run test to verify it passes + typecheck**

Run: `bunx vitest run src/hooks/useSingleReelAnalysis.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS + 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain/reel.ts src/domain/chat.ts src/hooks/useSingleReelAnalysis.ts src/hooks/useSingleReelAnalysis.test.ts
git commit -m "refactor(runs): run-scope single-reel hook + move reel types to domain, add single-reel payload"
```

---

## Task 7: Agent-loop dispatch — create runs + scoped abort + fan-out (transcript & single-reel only)

**Files:**
- Modify: `src/hooks/useAgentConversation.ts` — the `dispatchTool` branches for `get_reel_transcript` and `analyze_single_reel` (map: lines ~286–292 and ~314–318), and the latest-wins abort (lines ~172–178, ~362).
- Test: `src/hooks/useAgentConversation.runs.test.ts`

**Interfaces:**
- Consumes: `useRunsStore.createRun`, `registerController`, `abortRun`, `makeRunId`.
- Behavior:
  - For `get_reel_transcript` / `analyze_single_reel`: read `args.reelUrl` OR `args.reelUrls: string[]` (fan-out). For each URL, `createRun({...})` → `const sig = registerController(runId)` → call `startTranscript(runId, url, sig)` / `startSingleReel(runId, url, sig)`. Do NOT `addMessage(type:'transcript'|'single-reel')` markers anymore (the cockpit renders active runs). Do NOT abort siblings.
  - Keep the OLD marker+abort path for the four not-yet-migrated tools unchanged.
  - `abort()` (exposed) stays for the legacy pipelines; add nothing that aborts registry runs globally.

- [ ] **Step 1: Write the failing test**

```ts
// Verifies a fan-out transcript dispatch creates N runs and does not abort siblings.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRunsStore, selectActiveRuns } from '../store/runsStore'
// Import the dispatch helper. If dispatchTool is not individually exported, extract the
// transcript/single-reel run-launch into a pure helper `launchReelUrlRuns(kind, urls, conversationId, start)` in
// src/hooks/agentRunLaunch.ts and test THAT (recommended — keeps the hook thin and testable).
import { launchReelUrlRuns } from './agentRunLaunch'

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('launchReelUrlRuns', () => {
  it('creates one run per url and invokes the starter with a fresh signal each', () => {
    const started: Array<{ runId: string; url: string; aborted: boolean }> = []
    launchReelUrlRuns('transcript', ['u1', 'u2', 'u3'], 'c1', (runId, url, sig) => {
      started.push({ runId, url, aborted: sig.aborted })
    })
    expect(started.map((s) => s.url)).toEqual(['u1', 'u2', 'u3'])
    expect(started.every((s) => !s.aborted)).toBe(true)
    expect(selectActiveRuns(useRunsStore.getState(), 'c1')).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/hooks/useAgentConversation.runs.test.ts`
Expected: FAIL — `agentRunLaunch` not found.

- [ ] **Step 3: Implement**

Create `src/hooks/agentRunLaunch.ts`:

```ts
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
```

Then in `useAgentConversation.ts` `dispatchTool`, replace the `get_reel_transcript` and `analyze_single_reel` branches:

```ts
if (name === 'get_reel_transcript') {
  const urls = (args.reelUrls as string[] | undefined) ?? [String(args.reelUrl ?? '')].filter(Boolean)
  const convId = useConversationsStore.getState().activeId ?? ''
  launchReelUrlRuns('transcript', urls, convId, (rid, url, sig) => void startTranscript(rid, url, sig))
  return
}
if (name === 'analyze_single_reel') {
  const urls = (args.reelUrls as string[] | undefined) ?? [String(args.reelUrl ?? '')].filter(Boolean)
  const convId = useConversationsStore.getState().activeId ?? ''
  launchReelUrlRuns('single-reel', urls, convId, (rid, url, sig) => void startSingleReel(rid, url, sig))
  return
}
```

(`startTranscript`/`startSingleReel` now come from the run-scoped hooks with the new signatures. Remove the old `addMessage(type:'transcript'|'single-reel')` calls for these two branches.)

- [ ] **Step 4: Run test + typecheck**

Run: `bunx vitest run src/hooks/useAgentConversation.runs.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS + 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/agentRunLaunch.ts src/hooks/useAgentConversation.ts src/hooks/useAgentConversation.runs.test.ts
git commit -m "feat(runs): dispatch transcript/single-reel as registry runs with fan-out, no sibling abort"
```

---

## Task 8: `PaneCounterList` component (same-kind counter)

**Files:**
- Create: `src/components/runs/PaneCounterList.tsx`
- Test: `src/components/runs/PaneCounterList.test.tsx`

**Interfaces:**
- Consumes: `RunRecord`.
- Produces: `PaneCounterList({ runs }: { runs: RunRecord[] })` — renders a `n/N done` badge (N = runs.length, n = runs with `status==='done'`... note done runs leave the active set, so track via a `total` prop instead — see below) and one compact row per run (icon by status: done=check/success, running=loader/warning, queued=clock/tertiary, failed=alert/danger) showing `targetLabel`. A "View all N ›" affordance calls an `onViewAll?` prop.
- Because finished runs leave `selectActiveRuns`, the counter's denominator comes from grouping BEFORE filtering out done. Phase 1 keeps it simple: show the active same-kind runs as rows with their live status; the badge reads `${runs.length} running`. (Full done/total counter arrives in Plan 2 when finished runs briefly linger.)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaneCounterList } from './PaneCounterList'
import type { RunRecord } from '../../domain/runs'

const r = (id: string, status: RunRecord['status']): RunRecord =>
  ({ id, status, kind: 'transcript', conversationId: 'c1', progress: '', targetLabel: `reel ${id}`, startedAt: 0 })

describe('PaneCounterList', () => {
  it('renders a row per run and a running count badge', () => {
    render(<PaneCounterList runs={[r('1', 'running'), r('2', 'running')]} />)
    expect(screen.getByText(/2 running/i)).toBeInTheDocument()
    expect(screen.getByText('reel 1')).toBeInTheDocument()
    expect(screen.getByText('reel 2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/runs/PaneCounterList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (match existing result-component Tailwind idioms: `bg-surface`, `border-[rgba(var(--border-rgb),0.08)]`, `text-secondary`, `text-[var(--color-accent)]`)

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/components/runs/PaneCounterList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/runs/PaneCounterList.tsx src/components/runs/PaneCounterList.test.tsx
git commit -m "feat(runs): PaneCounterList same-kind counter rows"
```

---

## Task 9: `RunPane` + `RunCockpit` components

**Files:**
- Create: `src/components/runs/RunPane.tsx`, `src/components/runs/RunCockpit.tsx`
- Test: `src/components/runs/RunCockpit.test.tsx`

**Interfaces:**
- `RunPane({ pane, focused, onFocus }: { pane: CockpitPane; focused: boolean; onFocus: () => void })` — header (kind icon + label + status), body: if `pane.runs.length > 1` render `<PaneCounterList runs={pane.runs} />`, else render the single run's live progress (icon + `run.progress`). `focused` adds a `border-[var(--color-accent)]` ring; clicking calls `onFocus`.
- `RunCockpit({ conversationId, focusedRunId, onFocusKind }: { conversationId: string; focusedRunId: string | null; onFocusKind: (kind: RunKind) => void })` — reads `useRunsStore` active runs, `groupRunsForCockpit`, and:
  - 0 panes → renders `null`.
  - 1 pane with 1 run → renders `null` (single active run stays in the normal inline flow — Task 10 keeps the legacy inline block for that case). Cockpit only renders when there are **2+ panes OR a counter (pane with >1 run)**.
  - else → a responsive grid (`grid grid-cols-1 md:grid-cols-2 gap-3`) of `RunPane`s + queued chips row for `queuedKinds`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useRunsStore } from '../../store/runsStore'
import { RunCockpit } from './RunCockpit'

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('RunCockpit', () => {
  it('renders nothing for a single active run', () => {
    useRunsStore.getState().createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'r', progress: 'x' })
    const { container } = render(<RunCockpit conversationId="c1" focusedRunId={null} onFocusKind={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders two panes for two different-kind runs', () => {
    const s = useRunsStore.getState()
    s.createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'reel A', progress: 'Transcribing…' })
    s.createRun({ conversationId: 'c1', kind: 'single-reel', targetLabel: 'reel B', progress: 'Analysing…' })
    render(<RunCockpit conversationId="c1" focusedRunId={null} onFocusKind={() => {}} />)
    expect(screen.getByText('reel A')).toBeInTheDocument()
    expect(screen.getByText('reel B')).toBeInTheDocument()
  })

  it('renders a counter pane for two same-kind runs', () => {
    const s = useRunsStore.getState()
    s.createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'reel A', progress: '' })
    s.createRun({ conversationId: 'c1', kind: 'transcript', targetLabel: 'reel B', progress: '' })
    render(<RunCockpit conversationId="c1" focusedRunId={null} onFocusKind={() => {}} />)
    expect(screen.getByText(/2 running/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/runs/RunCockpit.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** (`RunPane.tsx` then `RunCockpit.tsx`)

`RunPane.tsx`:
```tsx
import { FileText, Video, Loader2 } from 'lucide-react'
import type { RunKind } from '../../domain/runs'
import type { CockpitPane } from './runCockpit.model'
import { PaneCounterList } from './PaneCounterList'

const kindIcon: Record<RunKind, typeof FileText> = {
  transcript: FileText, 'single-reel': Video, reel: Video, discovery: Video, competitor: Video, repurpose: Video,
}
const kindLabel: Record<RunKind, string> = {
  transcript: 'Transcript', 'single-reel': 'Case study', reel: 'Reel hooks', discovery: 'Discovery', competitor: 'Competitors', repurpose: 'Repurpose',
}

export function RunPane({ pane, focused, onFocus }: { pane: CockpitPane; focused: boolean; onFocus: () => void }) {
  const Icon = kindIcon[pane.kind]
  const single = pane.runs.length === 1 ? pane.runs[0] : null
  return (
    <button onClick={onFocus} className={`text-left bg-surface border rounded-2xl p-3 flex flex-col gap-2 ${focused ? 'border-[var(--color-accent)]' : 'border-[rgba(var(--border-rgb),0.08)]'}`}>
      <div className="flex items-center gap-1.5">
        <Icon size={14} className="text-secondary" />
        <span className="text-xs font-semibold text-primary">{kindLabel[pane.kind]}</span>
      </div>
      {single ? (
        <div className="flex items-center gap-1.5 text-xs text-secondary">
          <Loader2 size={12} className="animate-spin text-warning" />
          <span className="truncate">{single.progress || single.targetLabel}</span>
        </div>
      ) : (
        <PaneCounterList runs={pane.runs} />
      )}
    </button>
  )
}
```

`RunCockpit.tsx`:
```tsx
import { useRunsStore, selectActiveRuns } from '../../store/runsStore'
import type { RunKind } from '../../domain/runs'
import { groupRunsForCockpit } from './runCockpit.model'
import { RunPane } from './RunPane'

export function RunCockpit({ conversationId, focusedKind, onFocusKind }: { conversationId: string; focusedKind: RunKind | null; onFocusKind: (kind: RunKind) => void }) {
  const runs = useRunsStore((s) => selectActiveRuns(s, conversationId))
  const { panes, queuedKinds } = groupRunsForCockpit(runs)
  const isCounter = panes.some((p) => p.runs.length > 1)
  if (panes.length < 2 && !isCounter) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {panes.map((pane) => (
          <RunPane key={pane.kind} pane={pane} focused={focusedKind === pane.kind} onFocus={() => onFocusKind(pane.kind)} />
        ))}
      </div>
      {queuedKinds.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          {queuedKinds.map((k) => (
            <span key={k} className="px-2 py-1 rounded-full border border-[rgba(var(--border-rgb),0.10)]">{k} queued</span>
          ))}
        </div>
      )}
    </div>
  )
}
```

> The `focusedRunId`/`focusedKind` prop names in the test must match the component. The test above uses `focusedRunId`; align to `focusedKind` (update the test to `focusedKind={null}`) — panes are keyed by kind, so focus is per-kind.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/components/runs/RunCockpit.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/runs/RunPane.tsx src/components/runs/RunCockpit.tsx src/components/runs/RunCockpit.test.tsx
git commit -m "feat(runs): RunCockpit + RunPane split-pane/counter rendering"
```

---

## Task 10: Wire the cockpit into ChatPage + snapshot finished runs

**Files:**
- Modify: `src/pages/ChatPage.tsx`
- Modify: `src/components/TranscriptResultMessage.tsx`, `src/components/SingleReelResultMessage.tsx` — read from a passed `payload`/`run` prop instead of the deleted stores (Transcript already supports a `payload` prop; single-reel needs a `payload` prop path added mirroring the transcript one).

**Interfaces:**
- Consumes: `useRunsStore`, `selectActiveRuns`, `RunCockpit`, `addMessageTo`.
- Behavior:
  1. Render `<RunCockpit conversationId={activeConversationId} focusedKind={focusedKind} onFocusKind={setFocusedKind} />` just above the composer (inside the message column, after the transcript map, before the input area).
  2. Add a snapshot effect: subscribe to `useRunsStore`; when a run for the active conversation transitions to `done`, `addMessageTo(run.conversationId, { role:'assistant', type:'result', content: <summary>, result: run.result })` then `removeRun(run.id)` + `disposeController(run.id)`. When it transitions to `failed`, `addMessageTo(..., { type:'error', content: run.error })` then remove. Guard with an `armed` set of run ids already snapshotted (avoid double-adds), mirroring the existing `*ArmedRef` pattern.
  3. Keep the single-active-run inline behavior: when exactly one transcript/single-reel run is active (cockpit returns null), the existing inline `message.type==='transcript'|'single-reel'` blocks should still show it. Simplest: keep those inline blocks but drive them from the active run (look up the single active run of that kind) instead of the deleted stores. Since markers are no longer added (Task 7), instead render a single inline `RunPane`-style progress block when `selectActiveRuns` has exactly one run and cockpit is null.
  4. `focusedKind` state: `const [focusedKind, setFocusedKind] = useState<RunKind | null>(null)`. The composer's send still calls `agentConv.sendMessage`; Phase 1 does not yet route steering per-pane (documented as Plan 2). Add a "New run" button next to send that is a no-op-friendly affordance: it focuses the composer with a hint (Plan 2 makes it branch). For Phase 1, ship the button visually disabled-with-tooltip OR wire it to simply clear focus so the next message starts fresh — pick the clear-focus behavior.

- [ ] **Step 1: Write the failing test** (snapshot-on-finish, at the model level to avoid full-page render)

Create `src/pages/chatRunSnapshot.ts` with a pure helper and test it:

```ts
// src/pages/chatRunSnapshot.test.ts
import { describe, it, expect } from 'vitest'
import { runToMessage } from './chatRunSnapshot'

describe('runToMessage', () => {
  it('maps a done transcript run to a result message', () => {
    const msg = runToMessage({ id: 'run_1', kind: 'transcript', status: 'done', conversationId: 'c1', progress: '', targetLabel: 'r', startedAt: 0, result: { kind: 'transcript', reelUrl: 'u', transcript: 'hi', segments: [] } })
    expect(msg).toMatchObject({ role: 'assistant', type: 'result', result: { kind: 'transcript' } })
  })
  it('maps a failed run to an error message', () => {
    const msg = runToMessage({ id: 'run_2', kind: 'single-reel', status: 'failed', conversationId: 'c1', progress: '', targetLabel: 'r', startedAt: 0, error: 'boom' })
    expect(msg).toMatchObject({ role: 'assistant', type: 'error', content: 'boom' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/pages/chatRunSnapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runToMessage` + wire the effect + cockpit into ChatPage**

`src/pages/chatRunSnapshot.ts`:
```ts
import type { RunRecord } from '../domain/runs'
import type { ChatMessage } from '../domain/chat'

const summary: Record<RunRecord['kind'], string> = {
  transcript: 'Transcript ready.', 'single-reel': 'Reel case study ready.',
  reel: 'Reel breakdown ready.', discovery: 'Discovery complete.', competitor: 'Analysis complete.', repurpose: 'Repurpose ready.',
}

export function runToMessage(run: RunRecord): Omit<ChatMessage, 'id' | 'timestamp'> {
  if (run.status === 'failed') return { role: 'assistant', content: run.error ?? 'Something went wrong.', type: 'error' }
  return { role: 'assistant', content: summary[run.kind], type: 'result', result: run.result }
}
```

In `ChatPage.tsx`:
- `import { useRunsStore, selectActiveRuns } from '../store/runsStore'`, `import { RunCockpit } from '../components/runs/RunCockpit'`, `import { runToMessage } from './chatRunSnapshot'`, `import { disposeController } from '../lib/runControllers'`, `import type { RunKind } from '../domain/runs'`.
- Add state `const [focusedKind, setFocusedKind] = useState<RunKind | null>(null)`.
- Add a subscribe-based effect (once): watch `useRunsStore` for runs in `activeConversationId` whose `status` is `done`/`failed` and not yet snapshotted (track a `useRef<Set<string>>`); for each, `addMessageTo(run.conversationId, runToMessage(run))`, then `useRunsStore.getState().removeRun(run.id)` and `disposeController(run.id)`.
- Render `<RunCockpit conversationId={activeConversationId} focusedKind={focusedKind} onFocusKind={setFocusedKind} />` right before the input area block (after the messages `.map(...)`, inside the scroll container's sibling or just above the composer).

- [ ] **Step 4: Run tests + typecheck + build**

Run: `bunx vitest run src/pages/chatRunSnapshot.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS + 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ChatPage.tsx src/pages/chatRunSnapshot.ts src/pages/chatRunSnapshot.test.ts src/components/TranscriptResultMessage.tsx src/components/SingleReelResultMessage.tsx
git commit -m "feat(runs): render RunCockpit + snapshot finished runs into the transcript"
```

---

## Task 11: Delete the two migrated singleton stores + cleanup

**Files:**
- Delete: `src/store/transcriptStore.ts`, `src/store/singleReelStore.ts`
- Modify: any remaining importers (grep `from '../store/transcriptStore'` and `from '../store/singleReelStore'`), the old ChatPage live-progress gates for `type:'transcript'|'single-reel'` markers (now handled by the cockpit/inline run), and remove the now-dead `*ArmedRef` transcript/single-reel snapshot effects (replaced by Task 10).

**Interfaces:** none new.

- [ ] **Step 1: Find all importers**

Run: `grep -rn "store/transcriptStore\|store/singleReelStore\|useTranscriptStore\|useSingleReelStore" src/`
Expected: a finite list — ChatPage effects/selectors, the two result components, possibly tests.

- [ ] **Step 2: Remove usages**

- Delete the transcript & single-reel snapshot `useEffect`s and their selectors in `ChatPage.tsx` (superseded by Task 10's registry snapshot).
- Update `TranscriptResultMessage.tsx` / `SingleReelResultMessage.tsx` to require the `payload` prop (they already render finished results from a payload in the transcript; drop the live-store branch).
- Delete the two store files.
- Delete/curate their store tests if any.

- [ ] **Step 3: Typecheck + full suite + lint + build**

Run: `bunx tsc --noEmit -p tsconfig.json && bun run test && bun run lint && bun run build`
Expected: 0 type errors, all tests pass, lint clean, build succeeds.

- [ ] **Step 4: Manual smoke (documented for the reviewer)**

Start `bun run dev`; in one conversation: (a) transcribe one reel → inline progress → result lands in transcript; (b) transcribe three reels in one message → a transcript counter pane shows "3 running" → three results land; (c) start a single-reel case study while a transcript runs → two panes appear side by side; when each finishes its pane disappears and the result lands in the chat.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(runs): remove transcript/single-reel singleton stores (registry is source of truth)"
```

---

## Self-Review (completed)

- **Spec coverage:** Registry (Tasks 1–3), controllers/abort-isolation (Task 2), run-scoped hooks (Tasks 5–6), agent dispatch + fan-out + no-sibling-abort (Task 7), cockpit panes + counter + >4 queue (Tasks 4, 8, 9), collapse-to-transcript on finish (Task 10), single-run-stays-inline default (Tasks 9–10), persist + reload-marks-interrupted (Task 3). Deferred by design: per-pane steering routing and the four heavy pipelines (Plan 2), reload resume (Plan 3) — called out in Tasks 7 & 10.
- **Placeholder scan:** none — every step has concrete code or an exact edit list + grep command.
- **Type consistency:** `RunRecord`/`RunKind`/`RunStatus`/`makeRunId` defined in Task 1 and used verbatim throughout; `createRun`/`updateRun`/`finishRun`/`failRun`/`removeRun` signatures from Task 3 match callers in Tasks 5–7, 10; `groupRunsForCockpit`/`CockpitPane`/`CockpitLayout` from Task 4 match Task 9; `focusedKind` prop name reconciled in Task 9's note.

## Known follow-ons (separate plans)
- **Plan 2:** migrate `reel`, `competitor`, `discovery`, `repurpose` into the registry (their rich intermediate state becomes per-run), full done/total counter, per-pane steering + real "New run" branching, responsive tab-strip below ~900px.
- **Plan 3:** reload auto-resume (re-attach to in-flight Apify runs; resume Gemini steps).
