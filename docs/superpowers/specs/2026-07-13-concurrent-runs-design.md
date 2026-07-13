# Concurrent multi-run execution + split-pane cockpit

**Date:** 2026-07-13
**Status:** Approved — implementing (Phases 1–2; Phase 3 deferred)

## Goal

Let the user run multiple tools at once (same or different) instead of the current
one-run-at-a-time "latest-wins" model, surfaced as a split-pane "cockpit". Build it on a
new multi-run registry that also enables reload auto-resume later.

## Decisions (from brainstorming)

- **Sequencing:** foundation → concurrency → resume. Resume is **low priority / deferred**
  (separate future spec). This spec = foundation + concurrency.
- **How a second run starts:** explicit **"New run"** control branches a parallel run; the
  agent also **auto fans out** when one message implies many (e.g. "transcribe these 3 reels").
  A follow-up into an existing pane still steers/aborts **that pane only**.
- **Pane lifecycle:** live "cockpit" — panes exist only while runs are active; a finished
  result flows into the normal single-column transcript and its pane closes; the cockpit
  collapses when nothing is active.
- **Same-tool repeats:** grouped into one **counter** pane — compact status rows
  (done/running/queued) + `n/N` badge + "View all" to expand full results.
- **Overflow >4 tool-kinds:** the 5th kind is **queued** (chip) until a pane frees.
- **Input:** one shared composer targets the **focused** pane (click to focus) + a "New run" button.
- **Defaults locked:** a single active run stays inline (split only at 2+); panes are keyed by
  **tool-kind** (two reel analyses group into one counter pane, not two panes).

## Architecture

### Unit 1 — `runsStore` (the registry)
Zustand store, persisted (`version: 1` + `migrate`). Replaces the six singleton stores.
- State: `runs: Record<RunId, RunRecord>`.
- `RunRecord` — discriminated union on `kind` (`competitor | discovery | reel | single-reel |
  repurpose | transcript`) plus common fields:
  `id`, `conversationId`, `kind`, `status` (`queued | running | done | failed`), `progress`
  (string), `startedAt` (number), `targetLabel` (string — handle/city/reel shortCode for the
  pane header), `result?` (the kind's payload), `error?` (user-safe string).
- Actions: `createRun`, `updateRun(id, partial)`, `finishRun(id, result)`, `failRun(id, error)`,
  `removeRun(id)`, `clearFinished(conversationId)`.
- Selectors: `activeRuns(conversationId)` (queued/running), `runsByKind(conversationId)`,
  `focusedRunId`.
- **Persistence:** only serializable fields persist. On rehydrate, any `running`/`queued`
  run is marked `failed` ("interrupted by reload") and excluded from the cockpit — resume
  (Phase 3) will instead re-attach. Finished results already snapshot into conversation
  messages (unchanged), so no history is lost.

### Unit 2 — AbortController registry (runtime only)
A module-level `Map<RunId, AbortController>` in `src/lib/runControllers.ts` — not persisted.
`abortRun(id)`, `registerController(id, ctrl)`, `disposeController(id)`. Aborting one run's
controller never touches another's (isolation).

### Unit 3 — run-scoped pipeline hooks
The existing hooks (`useReelAnalysis`, `useLocationDiscovery`, `useCompetitorAnalysis`,
`useSingleReel`/reel-analysis, repurpose, transcript) change from "mutate the global
singleton" to `startX(runId, args, signal)` that writes progress/result into `runsStore`
under `runId`. Pipeline internals (scrape/analyze/synthesize) are unchanged; only the state
sink and the run identity change.

### Unit 4 — agent loop dispatch
`dispatchTool` in `useAgentConversation`:
- Creates a run via `createRun` and launches its pipeline with a fresh AbortController
  registered under the run id. It **no longer aborts sibling runs**.
- "Latest-wins" is scoped: a follow-up message aimed at the focused pane aborts only that
  run's controller (`abortRun(focusedRunId)`) before starting the new work.
- **Fan-out:** when a validated tool call carries multiple targets, create N runs of that kind
  (they group into one counter pane).
- **Global resource cap:** a shared concurrency limiter (`pLimit`) + the existing
  `keyRotator` cooldown, applied across all runs, so N parallel runs don't exceed
  Apify/Gemini rate limits.

### Unit 5 — cockpit UI
- `RunCockpit` — reads `activeRuns(conversationId)`, groups by kind, renders the tiled layout:
  0 active → nothing (normal chat); 1 active → today's inline live block; 2–4 kinds → grid
  (2 = columns, 3/4 = 2×2). >4 kinds → 4 panes + queued chips.
- `RunPane` — one tool-kind pane: header (icon + `targetLabel` + status), live progress body,
  and the shared "focus" affordance. Renders `PaneCounterList` when the kind has >1 run.
- `PaneCounterList` — the same-kind stacked rows (done/running/queued) + `n/N` badge +
  "View all" expand.
- Finished results reuse the existing `*ResultMessage` components in the transcript (unchanged).
- **Input routing:** the existing composer gains a focused-pane target + "New run" button.
  Below ~900px the cockpit shows the focused pane full-width + a tab strip to switch.

## Data flow

1. Agent validates a tool call → `createRun` (status `queued`→`running`) → registers controller →
   calls `startX(runId, args, signal)`.
2. Pipeline writes `updateRun` progress; cockpit re-renders the run's pane/counter row.
3. On success → `finishRun(id, result)`: the result is snapshotted into a transcript message
   (as today) and the run leaves the active set → its pane closes/collapses.
4. On failure → `failRun(id, error)`: error shows in-pane; siblings unaffected.

## Error handling

- Per-run isolation: one failure never aborts or hides siblings.
- 429/rate limits: existing per-call failover + the global cap.
- Reload: active runs → marked `failed (interrupted)` and dropped from the cockpit for now;
  Phase 3 replaces this with re-attach. Registry already persists stage + Apify run IDs to
  enable that.

## Testing

- **Pure:** `runsStore` reducers (create/update/finish/fail/remove/clearFinished), selectors
  (active-by-conversation, group-by-kind, >4 queue logic), and the persist migration +
  rehydrate-marks-interrupted rule.
- **Controllers:** abort isolation — aborting run A leaves run B's signal untouched.
- **Hooks:** run-scoped progress/result writes land under the right `runId`.
- **Agent loop:** fan-out creates N runs; a follow-up aborts only the focused run; the
  golden-set eval (`agentLoop.eval.test.ts`) stays green.
- **Components:** `RunCockpit` tiling at 1/2/3/4 + queued chips; counter grouping; collapse
  when the last run finishes.
- Full suite (`bun run test`) stays green; typecheck + lint + build pass.

## Scope

- **In scope:** Phase 1 (registry foundation, run-scoped hooks, agent-loop dispatch) +
  Phase 2 (cockpit UI, counter, queue, focused input).
- **Out of scope (Phase 3, later spec):** reload auto-resume (re-attaching to in-flight Apify
  runs + resuming Gemini steps). The registry is built to enable it.

## Migration & back-compat

- Persisted `kind` discriminants stay frozen (per CLAUDE.md) — the result payload shapes are
  reused verbatim, just relocated under `RunRecord.result`.
- The six old stores are removed; `migrate` maps any persisted finished run into the registry
  (or relies on the existing transcript snapshots, which already carry finished results).
- Registry store gets `version: 1` + identity-safe `migrate`, per the store convention.
