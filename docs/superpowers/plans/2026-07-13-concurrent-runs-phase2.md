# Concurrent Runs — Phase 2 (Heavy Pipelines → Cockpit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the four heavy pipelines (competitor, discovery, reel, repurpose) into the run registry + cockpit so each runs in parallel with *other* tools (up to 4 panes), while staying one-at-a-time within its own kind.

**Architecture:** Each heavy dispatch creates a registry run and gets its OWN `registerController` signal (instead of the shared latest-wins `currentRun`), so a new chat message no longer aborts it. The pipeline's existing singleton store is untouched (rich intermediate state stays there); a per-tool effect mirrors a summary progress string into the run so the cockpit pane shows live progress. The old inline progress blocks are removed (the pane replaces them); the competitor clarification card stays inline. On completion the existing snapshot effects still add the full result message, and additionally remove the run from the registry so its pane closes.

**Tech Stack:** React, Zustand, TypeScript, vitest, Tailwind.

## Global Constraints

- Package manager **bun** (`bun run test`, `bun run build`, `bun run lint`, `bunx vitest run <file>`, `bunx tsc --noEmit -p tsconfig.json`).
- Persisted `kind` discriminants are frozen; reuse `ResultPayload` shapes from `src/domain/chat.ts` verbatim.
- Design system (DESIGN.md): `bg-chai` bg, saffron `--color-accent`, AI violet `--color-ai-tint`; fonts Instrument Serif / Outfit / DM Mono. No Inter/slate/indigo.
- Research-target data (handles/cities/urls) only via `devLog`/`devWarn`, never `console.log`.
- New-array Zustand selectors MUST be consumed with `useShallow` (else infinite render loop) — mirror `RunCockpit.tsx`.
- Heavy tools are **one-at-a-time within their kind**: launching a 2nd run of the same kind supersedes (aborts + removes) the prior one. Different kinds run concurrently.
- Registry API (Phase 1, already built): `useRunsStore` with `createRun({conversationId,kind,targetLabel,progress})→RunId`, `updateRun(id,{progress|status|targetLabel})`, `finishRun`, `failRun`, `removeRun(id)`; selector `selectActiveRuns(state, convId)`. Controllers: `registerController(id)→AbortSignal`, `abortRun(id)`, `disposeController(id)` from `src/lib/runControllers.ts`. Kinds: `competitor | discovery | reel | single-reel | repurpose | transcript`.

---

## File Structure

**Create:**
- `src/hooks/agentRunLaunch.ts` — EXTEND with `launchHeavyRun(...)` (file already exists from Phase 1 with `launchReelUrlRuns`).
- `src/store/runsStore.ts` — EXTEND with a pure `selectActiveRunOfKind(state, kind, conversationId)` selector (file exists).
- `src/pages/heavyRunLabels.ts` — pure per-tool summary-label functions.
- `src/pages/heavyRunLabels.test.ts` — tests for the label functions.
- `src/hooks/agentRunLaunch.heavy.test.ts` — tests for `launchHeavyRun`.
- `src/store/runsStore.selectKind.test.ts` — test for `selectActiveRunOfKind`.

**Modify:**
- `src/hooks/useAgentConversation.ts` — the four heavy dispatch branches use `launchHeavyRun` with an own-controller signal.
- `src/pages/ChatPage.tsx` — add per-tool progress-mirror effects; add run removal to the completion effects; remove the four inline live-progress blocks (keep the competitor `ClarificationCard`, re-gated).

---

## Task 1: `selectActiveRunOfKind` selector

**Files:**
- Modify: `src/store/runsStore.ts` (add export)
- Test: `src/store/runsStore.selectKind.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `RunKind` from `src/domain/runs.ts`.
- Produces: `selectActiveRunOfKind(state: { runs: Record<RunId, RunRecord> }, kind: RunKind, conversationId: string): RunRecord | undefined` — the single active (`running`|`queued`) run of `kind` in `conversationId`, or undefined. If several exist (shouldn't for heavy kinds), returns the earliest by `startedAt`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useRunsStore, selectActiveRunOfKind } from './runsStore'

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('selectActiveRunOfKind', () => {
  it('returns the active run of a kind for a conversation', () => {
    const s = useRunsStore.getState()
    const d = s.createRun({ conversationId: 'c1', kind: 'discovery', targetLabel: 'KL', progress: '' })
    s.createRun({ conversationId: 'c1', kind: 'competitor', targetLabel: 'x', progress: '' })
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'discovery', 'c1')?.id).toBe(d)
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'reel', 'c1')).toBeUndefined()
  })

  it('ignores finished runs and other conversations', () => {
    const s = useRunsStore.getState()
    const d = s.createRun({ conversationId: 'c1', kind: 'discovery', targetLabel: 'a', progress: '' })
    useRunsStore.getState().finishRun(d, { kind: 'discovery', results: [], city: '', profiles: [], didExpand: false, locationRelaxed: false })
    s.createRun({ conversationId: 'c2', kind: 'discovery', targetLabel: 'b', progress: '' })
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'discovery', 'c1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`bunx vitest run src/store/runsStore.selectKind.test.ts` — `selectActiveRunOfKind` not exported)

- [ ] **Step 3: Implement** (append to `src/store/runsStore.ts`)

```ts
export function selectActiveRunOfKind(
  state: { runs: Record<RunId, RunRecord> },
  kind: RunKind,
  conversationId: string,
): RunRecord | undefined {
  return Object.values(state.runs)
    .filter((r) => r.kind === kind && r.conversationId === conversationId && (r.status === 'running' || r.status === 'queued'))
    .sort((a, b) => a.startedAt - b.startedAt)[0]
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `git add src/store/runsStore.ts src/store/runsStore.selectKind.test.ts && git commit -m "feat(runs): selectActiveRunOfKind selector"`

---

## Task 2: `launchHeavyRun` helper

**Files:**
- Modify: `src/hooks/agentRunLaunch.ts`
- Test: `src/hooks/agentRunLaunch.heavy.test.ts`

**Interfaces:**
- Consumes: `useRunsStore`, `registerController`, `abortRun`, `RunKind`.
- Produces: `launchHeavyRun(kind: Exclude<RunKind,'transcript'|'single-reel'>, targetLabel: string, conversationId: string, initialProgress: string, start: (signal: AbortSignal) => void): void` — supersedes any existing active run of the same kind in the conversation (`abortRun` + `removeRun`), then `createRun` + `registerController` + `start(signal)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useRunsStore, selectActiveRunOfKind } from '../store/runsStore'
import { launchHeavyRun } from './agentRunLaunch'

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('launchHeavyRun', () => {
  it('creates a running heavy run and invokes start with a live signal', () => {
    let seen: AbortSignal | null = null
    launchHeavyRun('discovery', 'KL food', 'c1', 'Starting…', (sig) => { seen = sig })
    const run = selectActiveRunOfKind(useRunsStore.getState(), 'discovery', 'c1')
    expect(run?.targetLabel).toBe('KL food')
    expect(run?.progress).toBe('Starting…')
    expect(seen).not.toBeNull()
    expect(seen!.aborted).toBe(false)
  })

  it('supersedes a prior active run of the same kind (aborts its signal)', () => {
    let firstSig: AbortSignal | null = null
    launchHeavyRun('discovery', 'first', 'c1', '', (s) => { firstSig = s })
    launchHeavyRun('discovery', 'second', 'c1', '', () => {})
    expect(firstSig!.aborted).toBe(true)
    const runs = Object.values(useRunsStore.getState().runs).filter((r) => r.kind === 'discovery')
    expect(runs).toHaveLength(1)
    expect(runs[0].targetLabel).toBe('second')
  })

  it('does not supersede a different kind', () => {
    launchHeavyRun('discovery', 'd', 'c1', '', () => {})
    launchHeavyRun('competitor', 'c', 'c1', '', () => {})
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'discovery', 'c1')).toBeDefined()
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'competitor', 'c1')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`launchHeavyRun` not exported)

- [ ] **Step 3: Implement** (append to `src/hooks/agentRunLaunch.ts`)

```ts
import { abortRun } from '../lib/runControllers'
// (registerController + useRunsStore already imported in this file)

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
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `git add src/hooks/agentRunLaunch.ts src/hooks/agentRunLaunch.heavy.test.ts && git commit -m "feat(runs): launchHeavyRun (own-signal, supersede-within-kind)"`

---

## Task 3: per-tool progress-label functions

**Files:**
- Create: `src/pages/heavyRunLabels.ts`, `src/pages/heavyRunLabels.test.ts`

**Interfaces:**
- Consumes: `CreatorAnalysisState` from `src/store/reelAnalysisStore.ts`; the step-label constants (`STEP_LABELS` from `analysisStore`, `DISCOVERY_STEP_LABELS` from `discoveryStore`, `PIPELINE_REGISTRY` from `src/tools/registry.ts`). READ those files first to import the real names.
- Produces pure functions returning the cockpit-pane summary string:
  - `competitorRunLabel(status: string, currentStep: number, stepProgressDetail: string): string`
  - `discoveryRunLabel(currentStep: number, stepProgressDetail: string | null): string`
  - `repurposeRunLabel(status: string): string`
  - `reelRunLabel(creatorStates: Record<string, CreatorAnalysisState>, synthesisStatus: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { competitorRunLabel, discoveryRunLabel, repurposeRunLabel, reelRunLabel } from './heavyRunLabels'

describe('heavyRunLabels', () => {
  it('competitor: clarifying shows a wait message; running shows step detail', () => {
    expect(competitorRunLabel('clarifying', 5, '')).toMatch(/answer/i)
    expect(competitorRunLabel('running', 3, 'Found 47 accounts')).toMatch(/47/)
    expect(competitorRunLabel('running', 3, '')).toMatch(/./) // non-empty step label fallback
  })
  it('discovery: uses step detail then step label', () => {
    expect(discoveryRunLabel(2, 'Scraping posts…')).toMatch(/Scraping/)
    expect(discoveryRunLabel(1, null)).toMatch(/./)
  })
  it('repurpose: maps each stage to a label', () => {
    expect(repurposeRunLabel('building-profile')).toMatch(/./)
    expect(repurposeRunLabel('rewriting')).toMatch(/./)
  })
  it('reel: summarizes creator progress', () => {
    const cs = { a: { status: 'done' }, b: { status: 'analyzing' }, c: { status: 'scraping' } } as never
    expect(reelRunLabel(cs, 'running')).toMatch(/3/) // mentions the 3 creators / progress
    expect(reelRunLabel({} as never, 'running')).toMatch(/./)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

- [ ] **Step 3: Implement** `src/pages/heavyRunLabels.ts`. Read the constants first; example shape (adjust imports to real exports):

```ts
import { STEP_LABELS } from '../store/analysisStore'
import { DISCOVERY_STEP_LABELS } from '../store/discoveryStore'
import { PIPELINE_REGISTRY } from '../tools/registry'
import type { CreatorAnalysisState } from '../store/reelAnalysisStore'

export function competitorRunLabel(status: string, currentStep: number, stepProgressDetail: string): string {
  if (status === 'clarifying') return 'Waiting for your answer…'
  return stepProgressDetail ? `${stepProgressDetail}…` : STEP_LABELS[currentStep] ?? 'Analyzing competitors…'
}

export function discoveryRunLabel(currentStep: number, stepProgressDetail: string | null): string {
  return stepProgressDetail ? `${stepProgressDetail}` : DISCOVERY_STEP_LABELS[currentStep] ?? 'Finding creators…'
}

export function repurposeRunLabel(status: string): string {
  const steps = PIPELINE_REGISTRY.repurpose.steps
  if (status === 'building-profile') return steps[0]
  if (status === 'analyzing-source') return steps[1]
  if (status === 'rewriting') return steps[2]
  return 'Repurposing…'
}

export function reelRunLabel(creatorStates: Record<string, CreatorAnalysisState>, synthesisStatus: string): string {
  const handles = Object.values(creatorStates)
  const done = handles.filter((c) => c.status === 'done' || c.status === 'no-reels' || c.status === 'failed').length
  if (synthesisStatus === 'running') return 'Synthesizing cross-creator patterns…'
  return handles.length ? `Analyzing ${handles.length} creator${handles.length !== 1 ? 's' : ''} (${done}/${handles.length})…` : 'Scraping reels…'
}
```

> If `STEP_LABELS`/`DISCOVERY_STEP_LABELS` are keyed differently (e.g. 1-indexed record or array), adjust indexing so a valid step yields a non-empty string. Verify exact export names by reading the two store files.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `git add src/pages/heavyRunLabels.ts src/pages/heavyRunLabels.test.ts && git commit -m "feat(runs): heavy-tool cockpit progress-label functions"`

---

## Task 4: migrate DISCOVERY to the cockpit

**Files:**
- Modify: `src/hooks/useAgentConversation.ts` (the `discover_by_location` branch, ~lines 320-331)
- Modify: `src/pages/ChatPage.tsx` (discovery snapshot effect ~323-351; the inline discovery `ProgressBubble` ~915-924; add a mirror effect)

**Interfaces:** consumes `launchHeavyRun`, `selectActiveRunOfKind`, `discoveryRunLabel`, `disposeController`.

- [ ] **Step 1: Dispatch — own signal.** In `useAgentConversation.ts` `discover_by_location`, replace `discover({...}, signal)` with:

```ts
if (name === 'discover_by_location') {
  const city = String(args.city ?? '')
  const niche = String(args.niche ?? '')
  const convId = useConversationsStore.getState().activeId
  launchHeavyRun('discovery', [city, niche].filter(Boolean).join(' ') || 'discovery', convId, 'Finding creators…', (runSignal) => {
    discover({ city, niche, depth: (args.depth as 'standard' | 'deep') ?? 'standard', clientName: '' }, runSignal)
  })
  return
}
```

- [ ] **Step 2: Progress-mirror effect** (add to `ChatPage.tsx`, near the discovery effect). Read the discovery selectors already in ChatPage (`discoveryStatus`, discovery `currentStep`, `stepProgressDetail`). Add:

```ts
useEffect(() => {
  const run = selectActiveRunOfKind(useRunsStore.getState(), 'discovery', activeConversationId)
  if (run) useRunsStore.getState().updateRun(run.id, { progress: discoveryRunLabel(discoveryCurrentStep, discoveryStepProgressDetail) })
}, [discoveryStatus, discoveryCurrentStep, discoveryStepProgressDetail, activeConversationId])
```
(Add `discoveryCurrentStep`/`discoveryStepProgressDetail` selectors if not already present — read them from `useDiscoveryStore`.)

- [ ] **Step 3: Completion cleanup.** In the existing discovery snapshot effect (`discoveryStatus === 'done'` branch, and add an `=== 'error'` branch if absent), after the `addMessageTo(...)`/`resetDiscovery()`, remove the run:

```ts
const run = selectActiveRunOfKind(useRunsStore.getState(), 'discovery', activeConversationId)
if (run) { useRunsStore.getState().removeRun(run.id); disposeController(run.id) }
```

- [ ] **Step 4: Remove the inline discovery `ProgressBubble` block** (`ChatPage.tsx` ~915-924, the `{isDiscoveryRunning && (<ProgressBubble .../>)}`). The cockpit pane now shows discovery progress.

- [ ] **Step 5: Verify + commit.** `bunx tsc --noEmit -p tsconfig.json && bun run test`. Manual smoke (reviewer): run a discovery + a transcript together → two panes; discovery pane shows step progress; on done its result lands in chat and the pane closes.
`git add -A && git commit -m "feat(runs): discovery runs in the cockpit (own signal, summary pane)"`

---

## Task 5: migrate REPURPOSE to the cockpit

**Files:**
- Modify: `src/hooks/useAgentConversation.ts` (`repurpose_reel` branch ~294-311)
- Modify: `src/pages/ChatPage.tsx` (repurpose snapshot effect ~356-389; inline repurpose block ~844-866; add mirror effect)

- [ ] **Step 1: Dispatch — own signal + drop marker.** Replace the `repurpose_reel` branch body: remove the `addMessage({type:'repurpose'})` marker; wrap in `launchHeavyRun`:

```ts
if (name === 'repurpose_reel') {
  const convId = useConversationsStore.getState().activeId
  const label = args.clientHandle ? `@${String(args.clientHandle)}` : 'client'
  launchHeavyRun('repurpose', label, convId, 'Building voice profile…', (runSignal) => {
    startRepurpose({
      sourceReelUrl: String(args.sourceReelUrl ?? ''),
      shortCode: args.shortCode ? String(args.shortCode) : undefined,
      clientHandle: args.clientHandle ? String(args.clientHandle) : undefined,
      pastedScripts: Array.isArray(args.pastedScripts) ? (args.pastedScripts as string[]) : [],
    }, runSignal)
  })
  return
}
```

- [ ] **Step 2: Mirror effect** (ChatPage):
```ts
useEffect(() => {
  const run = selectActiveRunOfKind(useRunsStore.getState(), 'repurpose', activeConversationId)
  if (run) useRunsStore.getState().updateRun(run.id, { progress: repurposeRunLabel(repurposeStatus) })
}, [repurposeStatus, activeConversationId])
```

- [ ] **Step 3: Completion cleanup.** In the existing repurpose effect, both the `done` and `error` branches, after `resetRepurpose()` add:
```ts
const run = selectActiveRunOfKind(useRunsStore.getState(), 'repurpose', activeConversationId)
if (run) { useRunsStore.getState().removeRun(run.id); disposeController(run.id) }
```
(Read the run BEFORE `resetRepurpose` if reset clears the conversation binding; if so capture `activeConversationId` — it's stable.)

- [ ] **Step 4: Remove the inline repurpose block** (`ChatPage.tsx` ~844-866 — the whole `message.type === 'repurpose' ? (...)` live branch). Legacy markers fall through to `<ChatMessage>`. Remove now-unused `lastRepurposeMarkerId` if nothing else uses it.

- [ ] **Step 5: Verify + commit.** `bunx tsc --noEmit && bun run test`. Smoke: repurpose + discovery together → two panes; repurpose pane steps through profile→analyze→rewrite; result lands in chat; pane closes.
`git add -A && git commit -m "feat(runs): repurpose runs in the cockpit"`

---

## Task 6: migrate COMPETITOR to the cockpit (keep clarification inline)

**Files:**
- Modify: `src/hooks/useAgentConversation.ts` (`discover_competitors` fall-through ~333-357)
- Modify: `src/pages/ChatPage.tsx` (competitor snapshot effect ~237-309; inline competitor block ~882-912; add mirror effect)

- [ ] **Step 1: Dispatch — own signal.** Wrap BOTH the handle path and the niche-only path in a single heavy run. Because the niche-only path does async work (`generateHashtags`/`scrapeHashtagUsernames`) before `analyze`, put the whole thing inside the `start` callback and thread `runSignal`:

```ts
// discover_competitors (fall-through)
const handles = (args.knownHandles as string[]) ?? []
const niche = String(args.niche ?? '')
const segment = String(args.segment ?? 'all')
const mode = (args.mode as 'precise' | 'broad') ?? 'precise'
const nicheContext = segment !== 'all' && niche ? `${niche} — ${segment}` : niche
const convId = useConversationsStore.getState().activeId
const label = handles.length ? handles.map((h) => `@${h}`).join(', ') : niche || 'competitors'
launchHeavyRun('competitor', label, convId, 'Discovering competitors…', async (runSignal) => {
  if (handles.length > 0) { analyze({ handles, depth: 'standard', clientName: '', nicheContext, mode }, runSignal); return }
  const { hashtags } = await generateHashtags(geminiKeys, '', niche, 'standard', runSignal)
  const seeds = await scrapeHashtagUsernames(hashtags, apifyKeys, runSignal)
  if (runSignal.aborted) return
  if (seeds.length === 0 && !niche) { bot(`Couldn't find accounts for "${niche}" automatically. Know any @handles I can start from?`); return }
  analyze({ handles: seeds.slice(0, SEED_LIMIT), depth: 'standard', clientName: '', nicheContext, mode }, runSignal)
})
return
```
(`launchHeavyRun`'s `start` is `(signal)=>void`; passing an async function is fine — it returns a floating promise. Keep it.)

- [ ] **Step 2: Mirror effect** (ChatPage) — depends on competitor `status`, `currentStep`, `stepProgressDetail`:
```ts
useEffect(() => {
  const run = selectActiveRunOfKind(useRunsStore.getState(), 'competitor', activeConversationId)
  if (run) useRunsStore.getState().updateRun(run.id, { progress: competitorRunLabel(status, currentStep, stepProgressDetail) })
}, [status, currentStep, stepProgressDetail, activeConversationId])
```

- [ ] **Step 3: Completion cleanup.** In the competitor snapshot effect's `status === 'done'` branch (after `setStatus('chatting')`), and add an `status === 'error'` cleanup branch, remove the run:
```ts
const run = selectActiveRunOfKind(useRunsStore.getState(), 'competitor', activeConversationId)
if (run) { useRunsStore.getState().removeRun(run.id); disposeController(run.id) }
```

- [ ] **Step 4: Trim the inline block, KEEP the clarification card.** In `ChatPage.tsx` ~882-912, remove the `ProgressBubble` (the pane replaces it) but KEEP the `ClarificationCard` sub-block. Re-gate it on just `isAnalysisClarifying && pendingDiscovery` (drop the surrounding ProgressBubble). The clarification card stays inline and interactive; the competitor pane meanwhile shows "Waiting for your answer…" (from `competitorRunLabel`).

- [ ] **Step 5: Verify + commit.** `bunx tsc --noEmit && bun run test`. Smoke: start a competitor analysis + a transcript → two panes; competitor pane shows step progress; when it hits clarification the pane says "Waiting for your answer…" and the inline clarification card appears; answering resumes; result lands in chat; pane closes.
`git add -A && git commit -m "feat(runs): competitor runs in the cockpit; clarification stays inline"`

---

## Task 7: migrate REEL to the cockpit (summary pane, full grid on completion)

**Files:**
- Modify: `src/hooks/useAgentConversation.ts` (`analyze_reels` branch ~272-285)
- Modify: `src/pages/ChatPage.tsx` (reel live block ~791-843; reel completion/snapshot path ~500 `snapshotCurrentReelRun`; reel content harvest effect ~414-421; add mirror effect)

- [ ] **Step 1: Dispatch — own signal + drop marker.** Replace the `analyze_reels` branch: keep `setReelConversationId(convId)`, remove the `addMessage({type:'reel'})` marker, wrap in `launchHeavyRun`:
```ts
if (name === 'analyze_reels') {
  const handles = (args.handles as string[]) ?? []
  const convId = useConversationsStore.getState().activeId
  useReelAnalysisStore.getState().setReelConversationId(convId)
  launchHeavyRun('reel', handles.map((h) => `@${h}`).join(', '), convId, 'Scraping reels…', (runSignal) => {
    startReelAnalysis(handles, runSignal)
  })
  return
}
```

- [ ] **Step 2: Mirror effect** (ChatPage) — depends on `creatorStates`, `synthesisStatus`:
```ts
useEffect(() => {
  const run = selectActiveRunOfKind(useRunsStore.getState(), 'reel', activeConversationId)
  if (run) useRunsStore.getState().updateRun(run.id, { progress: reelRunLabel(creatorStates, synthesisStatus) })
}, [creatorStates, synthesisStatus, activeConversationId])
```

- [ ] **Step 3: Completion cleanup.** Find where a finished reel run is snapshotted into a `type:'result', kind:'reel'` message (`snapshotCurrentReelRun` ~line 500 and/or the reel completion effect). READ that code. When the reel run reaches a terminal state (`synthesisStatus === 'done'` or `'failed'`, and — for the single-handle path — the creator terminal state that triggers the existing snapshot), after the snapshot add:
```ts
const run = selectActiveRunOfKind(useRunsStore.getState(), 'reel', activeConversationId)
if (run) { useRunsStore.getState().removeRun(run.id); disposeController(run.id) }
```
Do NOT change the existing snapshot logic itself — only add the run removal alongside it. If the snapshot is triggered imperatively (not in an effect), add the removal at the same call site.

- [ ] **Step 4: Remove the inline reel LIVE block** (`ChatPage.tsx` ~791-843 — the `message.type === 'reel'` branch that renders the header + `InlineReelResults` live + Retry/Start-over). The cockpit pane now shows reel progress; the full grid appears in the finished `ReelResultMessage` (result branch, unchanged). Remove now-unused `lastReelMarkerId` if nothing else references it. NOTE: keep the `message.type === 'result' && message.result?.kind === 'reel'` branch (the finished snapshot render) — that's unchanged.

- [ ] **Step 5: Verify + commit.** `bunx tsc --noEmit && bun run test`. Smoke: analyze reels for 2 handles + run a transcript → two panes; reel pane shows "Analyzing 2 creators (x/2)…" then "Synthesizing…"; on done the full reel breakdown appears in chat and the pane closes.
`git add -A && git commit -m "feat(runs): reel analysis runs in the cockpit (summary pane, full grid on completion)"`

---

## Task 8: cleanup + full verification

**Files:** `src/pages/ChatPage.tsx` and any now-dead helpers.

- [ ] **Step 1: Remove dead code.** Grep for now-unused ChatPage symbols left by Tasks 4-7: `isDiscoveryRunning`, `isAnalysisRunning` (if only the removed blocks used them), `lastReelMarkerId`, `lastRepurposeMarkerId`, elapsed timers (`reelElapsed`, `discoveryElapsed`, `analysisElapsed`) if their only consumers were the removed inline blocks, and unused imports (`ProgressBubble`, `InlineReelResults`, `Video`, `formatElapsed`). Remove only symbols with zero remaining references (let `bunx tsc` + `bun run lint` confirm). Keep anything still used by the clarification card or result branches.

- [ ] **Step 2: Full gate.** `bunx tsc --noEmit -p tsconfig.json` (0) → `bun run test` (all pass) → `bun run lint` (clean) → `bun run build` (success). Fix all fallout.

- [ ] **Step 3: Manual smoke (documented for reviewer).** In one conversation, start all four heavy tools in quick succession + a couple of transcripts: confirm up to 4 panes tile, the 5th kind queues, each pane shows live progress, competitor clarification appears inline and resumes, and every finished run drops its full result into the chat and closes its pane. Reload mid-run → interrupted runs are marked failed (Phase 1 guard), no stuck spinners.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore(runs): remove dead inline-progress code after heavy-tool cockpit migration"`

---

## Self-Review (completed)

- **Spec coverage:** own-signal parallelism (Task 2 + per-tool Step 1); one-at-a-time within kind (Task 2 supersede); cockpit summary panes (Task 3 labels + per-tool mirror effects); results still land in transcript (existing snapshot effects, untouched); panes close on completion (per-tool Step 3 removeRun); clarification stays interactive (Task 6 Step 4). Reel live-streaming→summary is the accepted tradeoff (Task 7). Stop button intentionally dropped (documented). Reload guard unchanged (Phase 1).
- **Placeholder scan:** none — every step has concrete code or an exact edit + grep. The label functions note to verify real constant export names by reading the store files (a concrete instruction, not a placeholder).
- **Type consistency:** `launchHeavyRun`/`selectActiveRunOfKind`/`*RunLabel` signatures defined in Tasks 1-3 are used verbatim in Tasks 4-7; `removeRun`/`disposeController`/`createRun`/`registerController` are the Phase-1 APIs.

## Known follow-ons (later)
- Per-pane **cancel/stop** for heavy runs (abort + store reset) — deferred.
- The explicit **"New run" button** + per-pane steering — deferred (Plan 3 territory).
- **Reload auto-resume** (re-attach to in-flight Apify runs) — separate later plan.
