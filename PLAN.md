<!-- /autoplan restore point: /Users/adityaraj0421/.gstack/projects/ContentOS2.0/feat-location-discovery-autoplan-restore-20260528-135859.md -->
# Plan: Fix Low Result Count in Location Discovery (≥10 Results)

**Branch:** feat/location-discovery
**Date:** 2026-05-28
**Author:** autoplan (aditya.raj@findmygenie.com)

---

## Problem

Discovery returns only 4 results for "Indore food vlogger" — user wants ≥10.

### Root Cause: Two sequential count-reducing bugs

**Bug 1 — `src/ai/prompts.ts:205–208` (BALANCE RULE)**
```
Do NOT fill slots with businesses just because there are fewer creator
candidates — reduce the total count instead.
```
This instruction explicitly tells Gemini to return fewer than 10 if not enough
creators exist in the candidate pool. For small cities like Indore where the
hashtag→profile pipeline yields only a handful of pure food vloggers, Gemini
stops at 4 and returns nothing else.

**Bug 2 — `src/hooks/useLocationDiscovery.ts:116–120` (confidence post-filter)**
```typescript
const highConf = results.filter((r) => r.locationConfidence !== 'unknown')
return highConf.length >= 5 ? highConf : results
```
After fixing Bug 1, if Gemini returns 10 results but 6 have confirmed/likely
location and 4 have 'unknown', this filter drops the 4 unknowns and returns 6.
The threshold of 5 is too low — it fires on nearly every real result set.

**Context: Why these bugs appear benign in large cities but hurt small ones**
For Mumbai food vlogger: the candidate pool has 20+ creators → Gemini finds 10
creators easily → BALANCE RULE never fires → confidence filter gets 10 confirmed
results → no reduction. For Indore: only 4 niche-relevant creators → Bug 1 fires
→ returns 4. Even if not, Bug 2 would trim 10 to ~6.

---

## Goal

**Every search returns exactly 10 results (or all candidates if fewer than 10 exist
in the pool).** The mix of creators vs. businesses is secondary — 10 mixed results
are more useful than 4 pure creators.

---

## Constraints

- No new Apify actors
- Stay within 150s timeout budget
- No UI changes required (result cards already show `type: business` vs `type: creator`)
- PROFILE_CAP increase from 40→60 adds ~5s timing (2 extra profile scrape batches)

---

## Fix Plan

### Fix 1 — `src/ai/prompts.ts` (HIGH PRIORITY, primary fix)

**Change the BALANCE RULE** to require 10 results rather than reducing count:

**Remove:**
```
- Do NOT fill slots with businesses just because there are fewer creator candidates — reduce the total count instead.
- A business profile can only take a slot if no more creator profiles remain in the candidate list.
```

**Replace with:**
```
- If fewer creator profiles exist than needed to fill 10 slots, fill the remaining slots with the most niche-relevant businesses from the candidate list.
- MINIMUM RESULT COUNT: Always return exactly 10 results (or all candidates if fewer than 10 exist in the list above). Never reduce the count.
```

Keep the existing creator-preference lines unchanged:
```
- Across all 10 results, aim for at least 5 content creators (type: creator) and at most 5 businesses (type: business).
- If the niche or context mentions "vlogger", "blogger", or "creator", lean heavier on creators: aim for 6-7 creators out of 10.
```

### Fix 2 — `src/hooks/useLocationDiscovery.ts` (HIGH PRIORITY, prevents regression)

**Change the confidence post-filter threshold** from 5 → 10:

```typescript
// BEFORE (too aggressive — drops results when ≥5 are high-confidence)
return highConf.length >= 5 ? highConf : results

// AFTER (only applies when we have more than enough high-confidence results)
return highConf.length >= 10 ? highConf : results
```

This means: only drop 'unknown' location results if 10+ results already have
confirmed/likely location. For any realistic result set from small-to-mid Indian
cities, this filter will be a no-op (which is the right behavior).

### Fix 3 — `src/lib/discoveryClient.ts` (MEDIUM PRIORITY, increases candidate pool)

**Increase PROFILE_CAP from 40 → 60:**

```typescript
// BEFORE
const PROFILE_CAP = 40

// AFTER
const PROFILE_CAP = 60
```

This adds 20 more handles to the initial profile scrape. At 10 handles/batch with
p-limit(3) concurrency, this adds 2 batches and ~5s to timing. Still well within
150s budget. Gives Gemini more candidates for small cities, reducing the chance
that the BALANCE RULE fix gets invoked with only a few relevant profiles.

---

## Files to Modify

| File | Change | Risk |
|------|--------|------|
| `src/ai/prompts.ts` | BALANCE RULE rewrite (2 lines removed, 2 added) | Low — prompt edit, functionally inverts one instruction |
| `src/hooks/useLocationDiscovery.ts` | Confidence threshold 5 → 10 | Low — threshold is a constant change |
| `src/lib/discoveryClient.ts` | PROFILE_CAP 40 → 60 | Low — adds ~5s timing |

## Files NOT to Change

- `src/lib/locationFilter.ts` — filter logic is correct
- `src/lib/hashtagGenerator.ts` — hashtags are correct
- `src/lib/transformers.ts` — already correct
- `src/lib/actors.ts` — no new actors

---

## Timing Budget After Fix 3

| Stage | Before | After |
|-------|--------|-------|
| Hashtag scrape | ~30s | ~30s (unchanged) |
| Profile scrape (40→60 handles, 6×10 batches, p-limit 3) | ~15s | ~20s |
| Creator enrichment expansion (if triggered) | ~10s | ~10s (unchanged) |
| **Total (standard depth)** | ~55s | **~60s** |

Still well within 150s timeout.

---

## Edge Cases After Fix

| Scenario | Behavior |
|----------|----------|
| Pool has 8 candidates total | Gemini returns all 8 (new "return all if <10" instruction) |
| All 10 results are businesses | Returned as-is (Mix is expected and labeled in UI) |
| Gemini returns 10 with 6 confirmed + 4 unknown location | Confidence filter: 6 < 10 → all 10 returned (no trimming) |
| Gemini returns 12 with 11 confirmed | Confidence filter: 11 >= 10 → returns only 11 confirmed (fine) |
| Large city (Mumbai) with 20+ creators | BALANCE RULE creator-preference line still favors creators for vlogger searches |

---

## Implementation Order

1. `src/ai/prompts.ts` — Fix 1 (BALANCE RULE)
2. `src/hooks/useLocationDiscovery.ts` — Fix 2 (confidence threshold)
3. `src/lib/discoveryClient.ts` — Fix 3 (PROFILE_CAP)

---

## Test Approach

Using `scripts/test-discovery.mjs`:
1. `food vloggers` + `Indore` → verify ≥10 results returned
2. `food` + `Mumbai` → verify still ≥10 results, still majority creators for vlogger niche
3. `restaurants` + `Delhi` → verify businesses fill in correctly

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO | Fix both BALANCE RULE + confidence threshold | Mechanical | P1 (completeness) | Both bugs independently reduce count; fixing only one leaves silent regression | Fix BALANCE RULE only |
| 2 | CEO | Increase PROFILE_CAP 40→60 | Mechanical | P2 (boil lake) | Small city candidate pools are thin; 60 gives Gemini more to pick from; timing impact negligible | Leave at 40 |
| 3 | Eng | Confidence threshold 5→10 (not remove) | Mechanical | P5 (explicit) | Threshold of 10 matches the target result count; threshold of 5 is arbitrary and too aggressive | Remove confidence filter entirely |

## GSTACK REVIEW REPORT

**Status: APPROVED**

### CEO Review
- Premises confirmed by user
- Right problem: BALANCE RULE inverts user intent (reduce count vs return 10)
- Dream state: any city/niche search returns 10 results by default
- Scope: 3 small targeted changes, all in blast radius, <1h CC effort

### Eng Review
- Architecture: no new components, all changes in existing pipeline
- Test plan: 3 manual test cases with test-discovery.mjs
- Performance: +5s timing max, stays within 150s budget
- Error paths: all existing error paths unchanged

### Cross-Phase
- No taste decisions
- No user challenges
- All 3 decisions are mechanical (one right answer)
