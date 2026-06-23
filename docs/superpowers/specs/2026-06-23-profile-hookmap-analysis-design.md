# Profile Analyzer → HookMap-Style Per-Reel Analysis

_Design spec • 2026-06-23 • branch: `feat/galleryv1` (or a follow-up branch)_

## Context

Today a profile (`@handle`) analysis runs a **quick, caption-only** hook analysis (`analyzeReelsBatch`)
and renders shallow per-reel hook cards, plus an optional, separately-triggered **"✦ Generate deep
report"** path (a different multimodal analyzer, `/api/analyze-reel-video` → `DeepReelAnalysis`).

Separately we built a **HookMap single-reel analyzer** (`/api/analyze-single-reel` →
`SingleReelResult`: transcript + timestamped segments + video mechanics + a markdown case study),
currently only reachable by pasting one reel URL. A recent change already calls it for every reel of a
profile run in the background — but only to capture the transcript for the gallery.

We want the profile analyzer to **be** the HookMap analyzer: every scraped reel gets the full case
study, shown per reel, with a creator-level summary across them. The old deep-report path is retired.

## Goals

- A **single-`@handle`** profile run analyzes **all ~10 scraped reels** with the HookMap analyzer.
- Per-reel HookMap case studies **replace** the quick caption hook-cards (single-handle runs only).
- A **creator-level summary** synthesizes across those ~10 case studies, shown **inline in chat** and
  on the **Report page**.
- The **deep-report path is removed** globally (CTA, pipeline, store fields, prompts, cache, exports);
  `ReportPage` is **repurposed** to render the new creator summary.
- Results stream **progressively** (per reel) and reuse the per-reel cache so re-runs are free.

## Non-goals / scope guards

- **Single-handle only.** A run with 2+ handles (creator comparison) keeps the existing quick path +
  cross-creator synthesis **unchanged**. No HookMap pipeline, no creator summary for multi-handle runs.
- No new server function — reuse `/api/analyze-single-reel` as-is.
- The persisted reel payload discriminant (`kind: 'reel'`) stays **frozen** (CLAUDE.md rule).

## Architecture

### 1. Pipeline — `src/hooks/useReelAnalysis.ts`
`startAnalysis` branches on `handles.length`:
- **1 handle →** new `runCreatorHookmapPipeline(handle, signal)`:
  1. `scrapeTopReels(handle, 10, …)` (unchanged).
  2. Seed each reel `caseStudyStatus[shortCode] = 'pending'`.
  3. `scrapeReelVideos(reel.urls, …)` — **reuse** the existing batch video-URL resolver.
  4. Per reel, capped at 3 concurrent, **cache-first** (`getCachedSingleReel`): POST
     `/api/analyze-single-reel` → store the full `SingleReelResult` + `caseStudyStatus = 'done'`
     (`'skipped'` when no downloadable video, `'failed'` on error — failure isolated per reel).
  5. After all reach a terminal state → `synthesizeCreatorHooks(...)` → store `hookSummary`.
  - Gated by `singleReelFnAvailable` (already added); if undeployed, set a clear unavailable note.
  - This **subsumes** today's background `enrichTranscripts` — the transcript still feeds the
    corpus/gallery from the same `SingleReelResult` (harvest unchanged: transcript + caption +
    metrics + thumbnail).
- **≥2 handles →** existing `runCreatorPipeline` (quick `analyzeReelsBatch`) + `synthesizeNiche`,
  untouched.

Concurrency/caching mirror the (removed) deep path: `pLimit(3)`, `singleReelCache` (shared with the
URL-paste feature, so analyzing by handle warms a later URL paste and vice-versa).

### 2. Store — `src/store/reelAnalysisStore.ts`
`CreatorAnalysisState` gains:
```ts
caseStudies?: Record<string, SingleReelResult>          // keyed by shortCode
caseStudyStatus?: Record<string, ReelCaseStatus>        // 'pending'|'analyzing'|'done'|'skipped'|'failed'
hookSummary?: CreatorHookSummary
```
- Remove the deep fields (`deepStatus`, `deepAnalyses`) and the store-level `deepReport` /
  `deepReportStatus`. Keep `analyses` (used by the multi-handle quick path).
- Bump persist `version` (→ 3) + `migrate`: drop unknown deep fields from old persisted state; new
  fields are additive/optional. Per-reel case studies **are persisted** in the snapshot (bounded text;
  avoids re-running expensive video analysis on reload) — unlike the old deep analyses which were
  re-run on demand.

### 3. Summary synthesis — `src/lib/reelAnalyzer.ts` + `src/ai/prompts/`
New `synthesizeCreatorHooks(handle, caseStudies, reels): Promise<CreatorHookSummary>`.
`CreatorHookSummary` (draft): `dominantHooks[]`, `recurringOpenings[]`, `whatConsistentlyWorks[]`,
`replicableTemplates[]`, `narrative`, `benchmarks` (median views, etc., computed in code).

**Context-safety / chunking (required).** Ten full case studies (each with transcript + segments +
`videoAnalysis` + markdown) can exceed Gemini's input window, so synthesis is **token-budgeted with a
map-reduce fallback** — it must never throw a context-overflow:

1. **Digest first (primary control).** Reduce each case study to a compact per-reel digest before
   synthesis — keep the hook fields, the opening line / first transcript segment(s), key
   `videoAnalysis` signals, and metrics; **drop the full markdown and trim the transcript** to a bounded
   prefix. A pure `buildReelDigest(caseStudy, reel)` helper (unit-testable, no Gemini).
2. **Budget check.** Estimate input tokens with a cheap heuristic (`ceil(chars / 4)`) against a
   conservative `SUMMARY_INPUT_TOKEN_BUDGET` constant (well under the model's real window, leaving room
   for the prompt + output). If all digests fit → **single call**.
3. **Map-reduce when over budget.** Split the digests into ordered chunks that each fit the budget →
   summarize each chunk into a **partial** `CreatorHookSummary` (map) → combine the partials in a final
   **reduce** call. If the concatenated partials still exceed the budget (pathologically many reels),
   reduce **recursively** (combine partials in budgeted batches) until one summary remains.
4. **Resilience.** A failed map chunk is dropped (best-effort, logged via `devWarn`) rather than failing
   the whole summary; if every chunk fails, surface a clear "couldn't summarize" state. All calls thread
   the run's `AbortSignal`.

Keep the chunking orchestration (`buildReelDigest`, token estimate, chunk planner, map/reduce loop)
**pure and separately unit-testable** from the Gemini call, so the budget math and chunk boundaries are
verified without the network.

### 4. UI — `src/components/`
- New `ReelCaseStudyCard` (or extend `InlineReelResults`): per reel, progressive
  (pending/analyzing → done/failed), rendering the case study via the existing
  `markdown/CaseStudyMarkdown` + the segment/transcript view extracted from
  `SingleReelResultMessage` (factor the shared piece into a small reusable component).
- New `HookSummaryCard`: renders `CreatorHookSummary` above the reel cards.
- `InlineReelResults`: for single-handle runs render summary + case-study cards; **remove** the
  "✦ Generate deep report" CTA and `DeepReelCard`. Multi-handle rendering path stays as-is.

### 5. Report page — `src/pages/ReportPage.tsx`
Repurpose to render `CreatorHookSummary` (full-page, client-ready) from the store instead of
`DeepReportCard`/`deepReport`. Empty state when no single-handle summary exists.

### 6. Remove the deep-report path
Delete / unwire: `startDeepReport`, `runCreatorDeepPipeline`, the deep `deepFnAvailable`,
`DeepReelCard`, `deepReport`/`deepReportStatus`/`DeepNicheReport`, `deepReelAnalysis` prompts,
`deepReelCache`, `reelVideoClient`'s deep-only helpers (keep `scrapeReelVideos` — reused), deep
export (`export.deepReport`) + their tests. Update `reelSnapshot`, `reelPersist`, `domain/chat`,
`ChatPage` wiring, and the agent golden-set accordingly. **Keep** `/api/analyze-reel-video`
on the server for now (dead but harmless) unless trivially removable.

## Data flow
```
single @handle → scrape 10 reels → resolve video URLs → per-reel /api/analyze-single-reel (cache-first, ×3 concurrency)
   → store SingleReelResult per reel (progressive UI)  → synthesizeCreatorHooks → hookSummary (inline + Report)
   → corpus harvest (transcript + caption + metrics + thumbnail) → Gallery
```

## Cost / UX (deliberate, user-approved)
A single-handle run now performs ~10 video analyses (minutes, not seconds). Mitigated by: progressive
per-reel streaming, `pLimit(3)`, and `singleReelCache`. Each `/api/analyze-single-reel` call does two
Gemini calls (extraction + case study); we now surface both outputs (transcript + markdown).

## Phasing
- **P1 — Pipeline + per-reel UI:** single-handle HookMap pipeline, store fields, progressive
  case-study cards replacing quick cards. (Multi-handle untouched.)
- **P2 — Summary:** `synthesizeCreatorHooks` + `HookSummaryCard` inline + repurpose `ReportPage`.
- **P3 — Remove deep report:** delete the deep path + cleanup across the ~18 dependent files; update
  snapshot/persist/export/domain/agent-eval; full green.

## GitNexus discipline (per request + CLAUDE.md)
- Run `impact({target, direction:'upstream'})` before editing any shared symbol (`CreatorAnalysisState`,
  `useReelAnalysis`, `reelAnalysisStore`, `InlineReelResults`, `ReportPage`, deep-report symbols);
  report HIGH/CRITICAL risk before proceeding.
- Run `detect_changes({scope:'compare', base_ref:'main'})` before each commit to confirm only the
  expected symbols/flows changed. Re-`analyze` the index after large moves.

## Testing
- Pipeline: single-handle branch, progressive per-reel status, cache-first, per-reel failure isolation,
  abort handling, `singleReelFnAvailable` gate; multi-handle still uses the quick path.
- `synthesizeCreatorHooks`: prompt builder + parse (mocked Gemini), code-computed benchmarks.
- **Chunking (pure):** `buildReelDigest` trims/bounds correctly; token estimate; the chunk planner
  packs digests under budget; single-call vs map-reduce path chosen at the right threshold; recursive
  reduce terminates; a failed map chunk is skipped without failing the whole summary. Verified without
  the network (Gemini call mocked).
- UI: per-reel case-study render (pending/done/failed), `HookSummaryCard`, repurposed `ReportPage`.
- Removal: no dangling references; deleted/updated deep tests; agent golden-set green.
- Full suite + `bun run build` (app + api) + `bun run lint` green before each phase lands.

## Risks
- **Latency/cost** of ~10 video analyses per run — accepted; mitigated by streaming + cache.
- **Deep-report removal blast radius** (~18 files incl. `ReportPage`, snapshot, persist, export) — the
  largest risk; gated behind GitNexus `impact`/`detect_changes` and done last (P3).
- **Persisted snapshot size** grows with case studies — bounded text; acceptable. Frozen `kind:'reel'`
  preserved; migrate drops old deep fields.

## Open questions
- None blocking. (Summary schema finalized during P2; benchmark fields computed in code.)
