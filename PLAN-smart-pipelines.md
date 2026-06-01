# Plan: Smart Pipeline Quality Gates

**Branch:** feat/conversational-agent
**Date:** 2026-06-01
**Author:** aditya.raj@findmygenie.com
**Status:** DRAFT — pending review

---

## Problem

Both pipelines have hardcoded execution caps with no quality feedback loop. When a
niche or city has sparse Instagram presence, the pipeline completes with thin results
and neither reports why nor attempts to recover.

### Gap 1 — Discovery: no post-filter expansion

`useLocationDiscovery.ts` calls `runLocationDiscovery()` once. After the location
filter runs, if only 2–3 profiles pass, the pipeline proceeds to Gemini with those
2–3. There is no "I found very little — let me try a different angle" step.

The creator-pool enrichment (`MIN_CREATOR_THRESHOLD = 8`, `EXPANSION_CAP = 20`) in
`discoveryClient.ts` expands the pool **before** the location filter, using
`relatedHandles` from existing profiles. This is a different problem: pool sparsity
(not enough profiles to score) vs. location sparsity (enough profiles, but none in
the target city).

When a city has genuine Instagram presence but the first hashtag batch didn't capture
it, a second batch with different hashtags would help. The `hashtagGenerator.ts` call
in `useLocationDiscovery.ts` runs once; there is no second pass.

### Gap 2 — Competitor: no post-round3 gate

`discoverCompetitors()` in `apifyClient.ts` always runs exactly 3 rounds + hashtag
expansion. After Round 3, `candidateProfiles` is returned regardless of count. If
Round 3 yields 4 profiles, Gemini ranks 4. There is no Round 4.

The `ROUND3_CAP` constant controls how many new handles Round 3 processes, but it
doesn't trigger another round when the result is thin.

### Gap 3 — No user feedback when sparse

When the pipeline produces thin results, the progress bubble advances through all
steps and the completion card says "Found 3 competitors." There is no explanation
("First search found few matches — we expanded the search") that would help the
user understand the result quality or try a different query.

---

## Goal

1. **Discovery post-filter expansion** — after `runLocationDiscovery()` returns, if
   `filterResult.filtered.length < MIN_LOCATION_RESULTS` (threshold: 4), generate a
   second hashtag batch (excluding already-tried hashtags) and run a second scrape +
   filter pass. Merge unique results. Surface as "Expanding search…" step in progress.
2. **Competitor Round 4** — after Round 3, if `candidateProfiles.length < MIN_COMPETITOR_RESULTS`
   (threshold: 8), do one more round: scrape relatedHandles of Round 3 profiles using
   the same `ROUND3_CAP[depth]` cap. Hard limit: 1 expansion round (no infinite loop).
3. **Progress surfacing** — both hooks surface expansion as a new dynamic step in
   `stepProgressDetail`, and the completion bubble states whether expansion ran.

---

## Constraints

- Max 1 expansion per pipeline run (no unbounded loops)
- Existing tests must pass
- No new Apify actors; no new Gemini models
- No new Zustand store fields (use `stepProgressDetail` + `setStep` already in both stores)
- Expansion is additive — the non-expansion paths are unchanged
- Competitor Round 4 is NOT in scope (CEO review: 4-hop graph signal is noise, not signal)
- Discovery expansion must branch on failure mode before re-scraping (CEO review amendment CA1)

---

## Architecture

### Change 1: Discovery post-filter expansion

**Eng review amendments applied:** filter-bottleneck branch eliminated (it's structurally
dead because `locationFilter.ts` auto-relaxes at `MIN_RESULTS=15`; `filterResult.relaxed`
is also `boolean` not `NormalizedProfile[]`). Single expansion path only.

**`src/lib/hashtagGenerator.ts`**

Add optional `excludeHashtags: string[]` parameter to `generateHashtags()`:
```typescript
export async function generateHashtags(
  geminiKey: string,
  city: string,
  niche: string,
  depth: 'standard' | 'deep',
  signal?: AbortSignal,
  excludeHashtags?: string[],   // NEW — sanitized before prompt injection
): Promise<{ hashtags: string[] }>
```

Update `buildHashtagPrompt()` in `prompts.ts`. When `excludeHashtags` is provided,
sanitize each entry (`replace(/[^\w]/g, '').slice(0, 30)`) before embedding:
```
Do not repeat any of these hashtags: [sanitized exclusion list joined by comma]
Generate N fresh hashtags targeting a different angle.
```

**`src/store/discoveryStore.ts`**

Add `stepProgressDetail` field (mirrors `analysisStore.ts` pattern):
```typescript
stepProgressDetail: string | null    // NEW — shown as ProgressBubble label during step 6
setStepProgressDetail: (detail: string | null) => void  // NEW
```
Add to `initialState` and `reset()`.

Widen `DiscoveryStep` type:
```typescript
export type DiscoveryStep = 1 | 2 | 3 | 4 | 5 | 6   // 6 = expanding search
```

Add step 6 label:
```typescript
export const DISCOVERY_STEP_LABELS: Record<number, string> = {
  1: 'Generating hashtags',
  2: 'Scraping hashtag posts',
  3: 'Scraping creator profiles',
  4: 'Filtering by location',
  5: 'Generating AI analysis',
  6: 'Expanding search',        // NEW — conditional, only shown when triggered
}
```

**`src/hooks/useActivePipeline.ts`** (remove from NOT to Change)

Expose `stepProgressDetail` from discovery store as `progressLabel` when step === 6.
Also make `stepLabels` dynamic: include step 6 label only when `discoveryStep >= 6`
so non-expansion runs always render as 5-step bars.

```typescript
// In the discovery pipeline branch:
const baseLabels = Object.entries(DISCOVERY_STEP_LABELS)
  .filter(([k]) => discoveryStep >= 6 || Number(k) <= 5)
  .map(([, v]) => v)
stepLabels: baseLabels,
progressLabel: discoveryStep === 6
  ? (discoveryStepProgressDetail ?? 'Expanding search…')
  : `Discovering creators in ${params?.city}…`
```

**`src/hooks/useLocationDiscovery.ts`**

After `runLocationDiscovery()` returns and before the zero-result guard:

```typescript
const MIN_LOCATION_RESULTS = 4

let finalFiltered = filterResult.filtered
let finalCandidates = candidateProfiles
let didExpand = false

if (filterResult.filtered.length < MIN_LOCATION_RESULTS && !controller.signal.aborted) {
  setStep(6)
  setStepProgressDetail(
    `Found only ${filterResult.filtered.length} creator${filterResult.filtered.length !== 1 ? 's' : ''} in ${safeCity} — trying new hashtags…`
  )

  try {
    const { hashtags: expandedHashtags } = await generateHashtags(
      geminiKey,
      safeCity,
      safeNiche,
      'deep',          // always deep for expansion
      controller.signal,
      scrapedHashtags, // exclude already-tried hashtags (sanitized inside generateHashtags)
    )

    if (expandedHashtags.length > 0 && !controller.signal.aborted) {
      const expansion = await runLocationDiscovery(
        expandedHashtags,
        safeCity,
        apifyKey,
        params.depth,
        controller.signal,
      )
      const existingUsernames = new Set(finalFiltered.map(p => p.username.toLowerCase()))
      const newFiltered = expansion.filterResult.filtered.filter(
        p => !existingUsernames.has(p.username.toLowerCase())
      )
      const newCandidates = expansion.candidateProfiles.filter(
        p => !existingUsernames.has(p.username.toLowerCase())
      )
      finalFiltered = [...finalFiltered, ...newFiltered]
      finalCandidates = [...finalCandidates, ...newCandidates]
      didExpand = true  // ran regardless of yield, so user sees context
    }
  } catch (expansionErr) {
    // Expansion failed — continue with first-pass results rather than throwing
    console.warn('[discovery] expansion failed, surfacing first-pass results:', expansionErr)
  }
}

// All downstream references use finalFiltered and finalCandidates (not filterResult.filtered / candidateProfiles)
// Rebuild knownHandles AFTER expansion merge (eng finding #12):
const knownHandles = new Set(finalCandidates.map(p => p.username.toLowerCase()))
```

Note: `scrapedHashtags` is returned by `runLocationDiscovery()` — already destructured
by the caller at the existing call site.
```

Add step 6 label in `discoveryStore.ts`:
```typescript
export const DISCOVERY_STEP_LABELS: Record<number, string> = {
  1: 'Generating hashtags',
  2: 'Scraping hashtag posts',
  3: 'Scraping creator profiles',
  4: 'Filtering by location',
  5: 'Generating AI analysis',
  6: 'Expanding search',        // NEW — only shown when quality gate triggers
}
```

**`src/hooks/useActivePipeline.ts`**

`stepLabels` is computed from `DISCOVERY_STEP_LABELS`. Step 6 only appears in the
progress bubble if `activePipeline.step >= 6`. No changes needed — the bubble already
renders whatever step count is current.

### Change 2: Competitor thin-result messaging (no Round 4)

CEO review determined Round 4 is not worth building: 4-hop graph profiles are too
noisy to improve ranking quality. Instead, when the competitor pipeline returns < 8
profiles, surface a clear message so the user knows to try a different reference account.

**`src/hooks/useCompetitorAnalysis.ts`**

After `discoverCompetitors()` returns and before `analyzeCompetitors()`:
```typescript
const MIN_COMPETITOR_RESULTS = 8
if (result.candidateProfiles.length < MIN_COMPETITOR_RESULTS) {
  store.setStepProgressDetail(
    `Found only ${result.candidateProfiles.length} profiles — this niche may be sparse on Instagram`
  )
}
```

This surfaces in the progress detail label during the Ranking step so the user
sees context before the results appear. No extra Apify runs.

### Change 3: Completion card shows expansion context

**`ChatPage.tsx`** — completion bubble (already shows count):
```
Found 5 competitors in the AI & Marketing space.
↳ Expanded search (initial pass found 3) — ranking from extended pool.
```

This is conditional on `didExpand` being true in the analysis store. Add
`didExpand?: boolean` to `AnalysisState` and `DiscoveryState`.

---

## Files to Create

| File | Purpose |
|------|---------|
| *(none)* | All changes are in existing files |

## Files to Modify

| File | Change | Risk |
|------|--------|------|
| `src/lib/hashtagGenerator.ts` | Add `excludeHashtags` param to `generateHashtags` | Low |
| `src/ai/prompts.ts` | Update `buildHashtagPrompt` to accept exclusion list | Low |
| `src/lib/apifyClient.ts` | No changes (Round 4 dropped; competitor change is in hook) | — |
| `src/lib/discoveryClient.ts` | Verify `scrapedHashtags` in return type — no change needed if already present | Low |
| `src/store/discoveryStore.ts` | Widen `DiscoveryStep` to include 6; add `stepProgressDetail` + step 6 label | Low |
| `src/store/analysisStore.ts` | Add `didExpand?: boolean` field | Low |
| `src/hooks/useLocationDiscovery.ts` | Post-filter quality gate + expansion path | High |
| `src/hooks/useActivePipeline.ts` | Dynamic step labels (include 6 only when step >= 6); expose `stepProgressDetail` | Low |
| `src/hooks/useCompetitorAnalysis.ts` | Thin-result `stepProgressDetail` message if < 8 candidates | Low |
| `src/pages/ChatPage.tsx` | Show expansion note in completion bubbles when `didExpand` | Low |

## Files NOT to Change

- `src/lib/apifyCore.ts`
- `src/lib/locationFilter.ts`
- `src/lib/transformers.ts`
- `src/lib/keyRotator.ts`
- `src/tools/registry.ts`
- `src/hooks/useConversation.ts`
- All `*.test.ts` files (additions only)

---

## Implementation Order

1. `src/ai/prompts.ts` — `buildHashtagPrompt` exclusion list param (with sanitization)
2. `src/lib/hashtagGenerator.ts` — `excludeHashtags` param
3. `src/store/discoveryStore.ts` — widen `DiscoveryStep`; add `stepProgressDetail`; step 6 label
4. `src/store/analysisStore.ts` — add `didExpand?: boolean`
5. `src/hooks/useActivePipeline.ts` — dynamic step labels; expose `stepProgressDetail`
6. `src/hooks/useLocationDiscovery.ts` — post-filter gate + expansion path + `knownHandles` rebuild
7. `src/hooks/useCompetitorAnalysis.ts` — thin-result progress detail message
8. `src/pages/ChatPage.tsx` — expansion note in completion bubbles

---

## Success Criteria

1. All existing tests pass; TypeScript compiles clean
2. Discovery with a thin-result city (< 4 post-filter) triggers a second hashtag batch; step 6 appears in progress bubble; first-pass hashtags excluded from second batch
3. If expansion fails (Apify error, abort), first-pass results are surfaced — no full pipeline failure
4. If `controller.signal.aborted` before expansion starts, expansion is skipped gracefully
5. Non-expansion discovery runs always show 5 steps (not 6) in the progress bar
6. Competitor pipeline with < 8 candidates shows "This niche may be sparse" in progress detail; no extra Apify call
7. `didExpand: true` in discoveryStore when expansion ran; completion bubble shows context note
8. `knownHandles` hallucination filter includes expansion profiles

---

## Test Plan

### New tests

| File | Tests |
|------|-------|
| `src/lib/hashtagGenerator.test.ts` | ① `generateHashtags` with `excludeHashtags` passes exclusion to prompt ② returned hashtags don't overlap with excluded list (prompt instructs this; test at prompt level) |
| `src/lib/apifyClient.expansion.test.ts` | ① Round 4 not triggered when `candidateProfiles.length >= 8` ② Round 4 triggered and `didExpand: true` when count < 8 ③ Round 4 handles empty `round3Handles` (round3Profiles had no relatedHandles) |

### Existing tests to extend

| File | Addition |
|------|---------|
| `src/ai/prompts.test.ts` | ① `buildHashtagPrompt` with exclusion list includes exclusion text in output |
| `src/hooks/useLocationDiscovery` (integration) | ① expansion step (6) fires when filterResult.filtered.length < 4 ② expansion skipped when >= 4 results ③ merged results dedupe correctly by username |

---

## What's NOT in Scope

- Multi-round discovery expansion (more than 1 extra hashtag batch)
- Competitor Round 5 (more than 1 extra round)
- Changing `MIN_CREATOR_THRESHOLD` or existing creator-enrichment logic
- Analytics on expansion frequency
- UI for the user to set their own quality threshold

---

## CEO Review Amendments

| ID | Finding | Amendment |
|----|---------|-----------|
| CA1 | Filter-bottleneck branch architecturally impossible — `filterResult.relaxed` is boolean; auto-relaxation already handles it | Eliminate filter-bottleneck branch entirely; single expansion path only |
| CA2 | Cost model unexamined — silent 2x Apify consumption | `didExpand` flag + completion bubble context note addresses UX visibility |
| CA3 | Round 4 drops 4-hop graph noise into ranking pool | Drop competitor Round 4; surface thin-result messaging instead |
| CA4 | "Better prompts" alternative not analyzed | Defer to TODOS.md: "investigate whether improving `buildHashtagPrompt` specificity reduces thin results" |

## Eng Review Amendments

| ID | Finding | Amendment |
|----|---------|-----------|
| EA1 | `filterResult.relaxed` is `boolean` not `NormalizedProfile[]` | Eliminated filter-bottleneck branch (CA1 already implied this) |
| EA2 | Filter-bottleneck branch structurally dead (auto-relaxation fires at MIN_RESULTS=15) | Same as EA1 |
| EA3 | `store.setStepProgressDetail()` not on discoveryStore | Add `stepProgressDetail` + `setStepProgressDetail` to `discoveryStore.ts` |
| EA4 | `DiscoveryStep` type rejects step 6 | Widen to `1\|2\|3\|4\|5\|6` |
| EA5 | Step 6 in static registry causes permanent 6-step bar on non-expansion runs | Dynamic step labels in `useActivePipeline.ts` — include step 6 only when `discoveryStep >= 6` |
| EA6 | Expansion + first pass exceed 150s AbortController budget on deep runs | Check `controller.signal.aborted` before expansion; wrap expansion in try/catch |
| EA7 | Expansion throw discards first-pass results | Wrap in try/catch; degrade gracefully — log warning, continue with first-pass results |
| EA8 | `knownHandles` built before expansion — expansion profiles fail hallucination filter | Rebuild `knownHandles` from `finalCandidates` after expansion block |
| EA9 | Round 4 references in implementation order + test plan | Remove all Round 4 references from implementation order, test plan, success criteria |
| EA10 | `didExpand` stays false when expansion ran but added 0 new filtered profiles | Set `didExpand = true` when expansion attempted (not conditioned on yield) |
| EA11 | `excludeHashtags` not sanitized before prompt injection | Sanitize inside `buildHashtagPrompt`: `replace(/[^\w]/g, '').slice(0, 30)` per entry |
| EA12 | `useActivePipeline.ts` in NOT to Change but needs modification | Removed from NOT to Change list |

---

## Decision Audit Trail

<!-- AUTONOMOUS DECISION LOG -->

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO | Accept user-confirmed premise: thin results are a real problem | User-validated | — | User confirmed in session that sparse results occur for niche Indian cities | None |
| 2 | CEO | Eliminate filter-bottleneck branch | Mechanical | P5 | `filterResult.relaxed` is boolean; branch impossible AND `locationFilter.ts` already handles it | Two-branch approach |
| 3 | CEO | Drop competitor Round 4 | Mechanical | P3+P5 | 4-hop graph is noise; thin-result messaging is sufficient, 0 API cost | Round 4 expansion |
| 4 | CEO | Defer "better hashtag prompts" analysis to TODOS.md | Mechanical | P3 | Requires user data to validate; expansion is mechanical and safe without research | Block on research |
| 5 | Eng | Add `stepProgressDetail` to discoveryStore | Mechanical | P5 | Required for expansion messaging; constraint was wrong in original plan | Keep constraint |
| 6 | Eng | Widen `DiscoveryStep` to `1\|2\|3\|4\|5\|6` | Mechanical | P1 | Step 6 call won't compile otherwise | Leave at 5 |
| 7 | Eng | Dynamic step labels in `useActivePipeline.ts` | Mechanical | P5 | Static 6-label array makes non-expansion runs appear incomplete | Static array |
| 8 | Eng | Wrap expansion in try/catch — degrade gracefully | Mechanical | P1 | First-pass results are valid and should survive expansion failure | Let it throw |
| 9 | Eng | Check `controller.signal.aborted` before expansion | Mechanical | P1 | 150s budget can expire during deep first pass | Ignore abort |
| 10 | Eng | Rebuild `knownHandles` after expansion merge | Mechanical | P1 | Expansion profiles would all fail hallucination filter otherwise | One-time build |
| 11 | Eng | Re-sanitize `excludeHashtags` in `buildHashtagPrompt` | Mechanical | P5 | Low-risk but explicit is better than relying on upstream sanitization | Trust upstream |
| 12 | Eng | `didExpand = true` when expansion attempted (not on yield) | Mechanical | P5 | User should see context whenever expansion ran, even if it added 0 profiles | Yield-conditional |

---

## GSTACK REVIEW REPORT

| Phase | Verdict | Key findings |
|-------|---------|--------------|
| CEO Review | APPROVE WITH AMENDMENTS | Critical: filter-bottleneck branch wrong + impossible → eliminated; High: Round 4 noise → dropped; High: cost model → `didExpand` note in UI; Medium: alternatives unanalyzed → TODOS.md |
| Design Review | SKIPPED (no UI scope) | — |
| Eng Review | APPROVE WITH AMENDMENTS | Critical: `FilterResult.relaxed` type mismatch → branch eliminated; Critical: `DiscoveryStep` type gates step 6 → widened; High: store missing `setStepProgressDetail` → added; High: static 6-step bar on normal runs → dynamic labels; High: AbortController budget → guard check + try/catch |
| DX Review | SKIPPED (no developer-facing scope) | — |
| **Final** | **APPROVED WITH AMENDMENTS** | 12 auto-decisions (all mechanical); 0 user challenges; 0 taste decisions; premises confirmed by user |

Auto-decisions applied: 12
User Challenges: 0
Taste Decisions: 0
Deferred to TODOS.md: Better hashtag prompt investigation
