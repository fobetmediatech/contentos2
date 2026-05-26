<!-- /autoplan restore point: /Users/adityaraj0421/.gstack/projects/ContentOS2.0/feat-location-discovery-autoplan-restore-20260527-025441.md -->
# Plan: Fix Creator Pool Contamination in Location Discovery

**Branch:** feat/location-discovery
**Date:** 2026-05-27
**Author:** autoplan (aditya.raj@findmygenie.com)

---

## Problem

The location discovery pipeline (`src/lib/discoveryClient.ts`) scrapes hashtags (e.g. `#MumbaiEats`, `#MumbaiFoodie`) to find Instagram creator handles. Even though these are "content hashtags" that creators use when posting their own food content, **restaurant and food-brand accounts post MORE heavily under the same hashtags** than individual creators do. 

Result: the 40-handle candidate pool (PROFILE_CAP) going into Gemini is dominated by `isBusinessAccount: true` accounts (restaurants), so Gemini's BALANCE RULE cannot compensate — it can only select from what exists in the pool.

**Observed failure:**
- Input: "food vloggers, Mumbai, Standard depth"
- Hashtags scraped: `#MumbaiFoodvloggers, #MumbaiEats, #MumbaiFoodie` (5 total)
- Candidate pool: ~40 handles → ~38 restaurants, ~2 personal creators
- Gemini output: 10 restaurants, 0 food vloggers
- Root cause: volume dominance by business accounts in hashtag feeds, not wrong hashtag type

## Goal

When a user searches for food creators (or any creator niche) in a city, the result set should include real content creators — **at least 5 of the 10 results should be personal-account creators** (`isBusinessAccount: false`) when creator-focused keywords are used ("vlogger", "blogger", "creator").

## Constraints

- No external API keys in source code (runtime user input only, stored in localStorage)
- No `.env` file — all runtime
- Stay within 150s timeout budget (current Standard depth uses ~45s)
- No new Apify actors — use `apify/instagram-profile-scraper` (already in `src/lib/actors.ts`)
- No UI changes required (this is a pipeline fix)

## Proposed Solution: Creator Pool Enrichment

### Core Insight

The `normalizeProfile` function already extracts `relatedHandles` from each profile's `relatedProfiles` field. For creator accounts, their Instagram "related profiles" are other creators in the same niche — not businesses. This gives us a **creator graph signal** that bypasses the hashtag→business-dominated pipeline.

### Three-layer fix

**Layer 1 — `src/lib/discoveryClient.ts` (primary change)**

After the existing profile scraping step, split candidates by `isBusinessAccount`:
- `creatorProfiles`: `isBusinessAccount === false`
- `businessProfiles`: `isBusinessAccount === true`

If `creatorProfiles.length < MIN_CREATOR_THRESHOLD (8)`:
1. Collect `relatedHandles` from ALL profiles (businesses AND creators both have related profiles)
2. Deduplicate against already-scraped handles
3. Profile-scrape up to `EXPANSION_CAP = 20` additional handles
4. Split the new batch by `isBusinessAccount`
5. Add new creators to `creatorProfiles`, new businesses to `businessProfiles`

Assemble the final candidate list for Gemini:
- Up to `MAX_CREATORS = 15` creators (prioritizing creators)
- Up to `MAX_BUSINESSES = 10` businesses
- Concatenated as the `candidateProfiles` array passed to `analyzeDiscovery()`

**Layer 2 — `src/ai/prompts.ts` (prompt reinforcement)**

The discovery prompt already has a BALANCE RULE. Strengthen it by injecting the actual creator/business ratio in the candidate list, so Gemini knows the pool composition:

```
CANDIDATE POOL COMPOSITION: [N] creator accounts (type: creator) + [M] business accounts (type: business)
```

This makes the instruction data-grounded, not aspirational.

**Layer 3 — `src/lib/discoveryClient.ts` (public API change)**

Export the enriched `creatorCount` and `businessCount` from `DiscoveryPipelineResult` so `useLocationDiscovery.ts` can surface a warning if enrichment still didn't find enough creators.

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/discoveryClient.ts` | Creator enrichment logic (primary) |
| `src/ai/prompts.ts` | Inject pool composition into BALANCE RULE |
| `src/hooks/useLocationDiscovery.ts` | Consume new `creatorCount`/`businessCount` fields |

### Files to NOT Change

- `src/lib/hashtagGenerator.ts` — content hashtags are correct; the issue is volume dominance, not hashtag type
- `src/lib/locationFilter.ts` — filter is correct; issue is upstream
- `src/lib/transformers.ts` — already extracts `relatedHandles` correctly
- `src/lib/actors.ts` — no new actors needed
- All UI components — no UI changes needed

### Constants (all in discoveryClient.ts)

```typescript
const MIN_CREATOR_THRESHOLD = 8    // below this, trigger expansion
const EXPANSION_CAP = 20           // max handles to scrape in expansion round
const MAX_CREATORS = 15            // max creators in final candidate set
const MAX_BUSINESSES = 10          // max businesses in final candidate set
```

## Timing Budget

**Standard depth (before fix):** ~45s  
**Standard depth (with expansion, worst case):**
- Hashtag run: ~30s (unchanged)
- Profile scrape batch 1 (40 handles, 4×10 parallel): ~15s (unchanged)
- Expansion profile scrape (20 handles, 2×10 parallel): ~10s (new)
- **Total: ~55s** (still well within 150s budget)

**Deep depth:** adds ~5s for extra posts-per-hashtag. Total ~60s. Still fine.

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No creators from hashtags at all | Expansion still runs using ALL profiles' `relatedHandles`; if still 0 creators → pass business-only pool to Gemini with explicit prompt note |
| relatedHandles overlap with already-scraped handles | Deduplicate set ensures no re-scraping |
| Expansion profile scrape fails | Catch + log, proceed with original pool |
| City is very niche (few accounts) | Location filter relaxation already handles this (existing) |
| Creator accounts have empty relatedProfiles | Expansion yields fewer handles; graceful fallback |
| niche keyword has "vlogger/blogger/creator" | prompts.ts BALANCE RULE already skews 6-7 creators |

## Test Approach

Manual (via existing `scripts/test-discovery.mjs`):
1. `food` + `Mumbai` → verify ≥5 results have `isBusinessAccount: false`
2. `food vloggers` + `Indore` → same check
3. `fitness` + `Bangalore` → creator-heavy niche, should still work
4. `restaurants` + `Delhi` → business-heavy search, 5 businesses should be acceptable

Automated (future, out of scope for this fix):
- Unit test for `MIN_CREATOR_THRESHOLD` trigger logic in discoveryClient
- Unit test for expansion dedup logic

## Implementation Order

1. Modify `src/lib/discoveryClient.ts` — add enrichment
2. Modify `src/ai/prompts.ts` — inject pool composition
3. Modify `src/hooks/useLocationDiscovery.ts` — consume new fields
4. Test end-to-end with food + Mumbai

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
