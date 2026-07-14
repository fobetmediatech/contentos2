# Voice-build efficiency (Phase 1) — transcript-only builds + safe model downgrades

**Date:** 2026-07-14
**Status:** Design approved (pending written-spec review)
**Owner:** Aditya
**Context:** Phase 1 of a 3-part perf effort. Phase 2 (a server-cron voice-profile **warmer**) is a separate spec and benefits from this landing first (cheaper builds to warm). This spec is the low-risk efficiency ship: **#3 kill redundant scrapes/analysis** + **#2 model tiering**.

## 1. Summary

Two independent, low-risk changes that make voice-profile building faster/cheaper without touching output quality:

| # | Change | Impact |
|---|---|---|
| 3 | Voice-build transcribes via the existing lightweight `/api/get-transcript` instead of the full `/api/analyze-single-reel` | ~2–4× faster per reel; stops computing+discarding video analysis on 8 reels/build |
| 2 | Downgrade the 2 grounded-search calls (`knowledgeSeed`, `webFallback`) from `PREMIUM_MODEL` to the default flash | Cost/latency on those calls (conditional — see caveat) |

### Locked decisions
- **Reel count stays 8** (protects voice quality) but the `PROFILE_REEL_COUNT` constant stays trivially tunable for later A/B.
- **Only** the 2 grounded calls are downgraded. The 9 creative/quality-critical premium calls (rewrite, remix, creator-script, voice-synthesis, competitor-ranking) are **left untouched** to protect precision.
- The **warmer (#1) is out of scope** — separate Phase 2 spec.

## 2. #3 — Transcript-only voice-build

### Current (wasteful)
`buildVoiceProfile` (@handle path, `src/hooks/useRepurposeReel.ts:135–177`) → `scrapeTopReels(handle, 8)` → `transcribeReels(...)` → per reel `analyzeReelHookmap` → **`/api/analyze-single-reel`**, which returns `{ transcript, segments, videoAnalysis, markdown }`. Voice synthesis (`buildVoiceProfilePrompt`) consumes **only** `transcripts` + `captions` — `videoAnalysis`, `segments`, and `markdown` are computed and thrown away, 8× per build.

### Change
Voice-build gets a **transcript-only** path backed by the existing **`/api/get-transcript`** endpoint (`api/get-transcript.ts`), which returns `{ transcript, segments }` and has a **fast inline path for videos ≤ 15 MB** (base64, no Files-API upload + ACTIVE polling) — the source of the 2–4× speedup for typical reels. Videos > 15 MB fall back to the Files API automatically (still transcript-only, still no video-analysis waste).

### The one nuance (resolved in planning)
`transcribeReels` / `analyzeReelHookmap` may be **shared** with the reel-hook-analysis pipeline (which genuinely needs the hook-map). The plan will check:
- **If shared:** add a new lightweight `transcribeReelsLight(handle, reels, …)` in `src/lib/reelTranscriber.ts` (or a sibling) that calls `/api/get-transcript` per reel (parallel, respecting the existing `pLimit(3)`), and point **only** `buildVoiceProfile` at it. The reel-analysis path is untouched.
- **If voice-build-only:** swap the endpoint in place.

Concurrency + batching stay as-is (batch Apify video-URL resolve → parallel transcription at `pLimit(3)`). Missing/failed transcripts are dropped per-reel exactly as today (voice synthesis tolerates gaps).

## 3. #2 — Downgrade the 2 grounded-search calls

`callGeminiGroundedJson` defaults its model to `PREMIUM_MODEL`. Its only two callers are mechanical grounded-search ranking: `src/lib/knowledgeSeed.ts` and `src/lib/webFallback.ts`. Grounding (Google Search) carries the quality there, so premium is wasted.

**Change:** pass an explicit fast model (the default `MODEL` / `gemini-2.5-flash`) at those two call sites (do NOT change `callGeminiGroundedJson`'s default, in case a future grounded caller wants premium). Everything else stays on its current tier.

`★ Caveat (verify, doesn't block):` The default model is already `gemini-2.5-flash`, and `PREMIUM_MODEL` is env-gated by `VITE_GEMINI_PREMIUM_MODEL`. **If that Vercel env var is unset, premium already == flash and this saves nothing** (the code change is still correct hygiene). If it's set to a pro model, the downgrade saves real cost/latency. Worth checking the prod env; not a blocker.

## 4. Reel count

`PROFILE_REEL_COUNT = 8` (`src/hooks/useRepurposeReel.ts:38`) is arbitrary ("more samples"), reducible to 5–6 without breaking synthesis. **v1 keeps 8** to protect voice quality (the "precise" goal); the constant stays a single tunable value so a future A/B (6 vs 8) is a one-line change. No code change here beyond leaving it tunable.

## 5. Edge cases / risk

| Case | Behavior |
|---|---|
| Reel > 15 MB | `/api/get-transcript` Files-API fallback (transcript-only, no waste) |
| A reel's transcript fails | Dropped for that reel, same as today; synthesis proceeds on the rest |
| `/api/get-transcript` unavailable | Surfaces the same user-safe error path (`friendlyError`); voice-build fails cleanly as today |
| Grounded downgrade | Grounded search works on flash; if quality dips on niche-seed/fallback (unlikely), revert the one-line model arg |

No new dependency, no new endpoint, no schema change. Voice-profile output is unchanged (same transcripts → same synthesis). Blast radius: `buildVoiceProfile` + (maybe) a new transcript helper + 2 grounded call-site model args.

## 6. Testing

- **New `transcribeReelsLight` (if added):** unit-test the pure request/response mapping against a `/api/get-transcript` fixture (`{ transcript, segments }` → transcript strings).
- **Model downgrade:** assert the 2 grounded call sites pass the fast model (a cheap assertion or a focused test).
- **Parity check (manual/verify):** build a voice profile for one real handle before/after; confirm the profile is equivalent and the build is measurably faster (time both).
- Full existing suite (repurpose / Script Studio / creator-voices) stays green; `bun run build` + lint clean.

## 7. Files

**Likely new:** `src/lib/reelTranscriber.ts` gains `transcribeReelsLight` (or a new small file) + its test — *only if* `transcribeReels` is shared.
**Modified:** `src/hooks/useRepurposeReel.ts` (`buildVoiceProfile` → transcript-only path); `src/lib/knowledgeSeed.ts` + `src/lib/webFallback.ts` (fast model on the grounded calls). Exact set confirmed in planning after reading the current code.
**Untouched:** the reel-hook-analysis pipeline, `/api/analyze-single-reel`, all 9 creative premium calls, `PROFILE_REEL_COUNT` value.

## 8. Out of scope (deliberate)

- **The warmer (#1)** — separate Phase 2 spec (server-cron Supabase Edge Function + GitHub Action).
- **Reducing reel count** (8→6) — left tunable, not changed now.
- **Downgrading any creative/quality-critical premium call** — protects precision.
- **Server-side model tiering** in `api/*` (already all flash).
- **Whisper/Deepgram** — the transcript-only swap uses the existing Gemini `/api/get-transcript`; a dedicated ASR is a separate future call once we measure whether transcription is still the bottleneck.
