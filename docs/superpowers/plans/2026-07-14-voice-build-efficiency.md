# Voice-build Efficiency (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make voice-profile building ~2–4× faster and stop discarding 8 video-analyses per build, by transcribing the client's reels through the existing lightweight `/api/get-transcript` (transcript-only, fast ≤15 MB inline path) instead of the full `/api/analyze-single-reel`.

**Architecture:** `transcribeReels` is shared (it warms the corpus/gallery deep cache), so it stays untouched. Voice-build gets its own light path: a `getReelTranscript` client (calls `/api/get-transcript`) + a `transcribeReelsLight` batch orchestrator (cache-first, parallel), and `buildVoiceProfile` is repointed at it.

**Tech Stack:** React 18 + Vite + TS, existing `/api/get-transcript` serverless fn, `p-limit`, vitest.

---

## Spec
`docs/superpowers/specs/2026-07-14-voice-build-efficiency-design.md`. Branch: `feat/voice-build-efficiency`. (#2 model tiering was dropped — the grounded calls are deliberately premium.)

## Key facts (verified from current code)
- `/api/get-transcript` (`api/get-transcript.ts`): `POST { downloadedVideoUrl, shortCode }` (Clerk Bearer) → `200 { shortCode, result: { transcript, segments } }`. Fast base64-inline path ≤15 MB; Files-API fallback >15 MB. Non-ok → error status.
- `transcribeReels` (`src/lib/reelTranscriber.ts`): SHARED — caches full `SingleReelResult` for the corpus/gallery. **Do not modify.** Reuse its `transcribeLimiter = pLimit(3)`, `getCachedSingleReel`, `scrapeReelVideos`, `ReelData`.
- `analyzeReelHookmap` (`src/lib/reelHookmap.ts`) is the per-reel client we mirror (Clerk-token fetch, 401-retry-once, null-on-failure).
- `buildVoiceProfile` calls `transcribeReels(handle, reels, apifyKeys, signal)` once (the @handle path). `ReelData` is from `../store/reelAnalysisStore`.

Test cmd: `bunx vitest run <file>`. Build: `bun run build`. Project has `noUnusedLocals`.

---

## Task 1: Lightweight transcript client (`reelTranscriptClient.ts`)

**Files:**
- Create: `src/lib/reelTranscriptClient.ts`
- Test: `src/lib/reelTranscriptClient.test.ts`

Context: Mirrors `reelHookmap.ts` but hits the transcript-only `/api/get-transcript`. The pure `parseTranscriptResponse` is the unit-tested seam; `getReelTranscript` wraps it with the Clerk-token fetch (best-effort: returns `null` on any failure, never throws).

- [ ] **Step 1: Write the failing test** — create `src/lib/reelTranscriptClient.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseTranscriptResponse } from './reelTranscriptClient'

describe('parseTranscriptResponse', () => {
  it('extracts result.transcript', () => {
    expect(parseTranscriptResponse({ shortCode: 'x', result: { transcript: 'hello world', segments: [] } })).toBe('hello world')
  })
  it('returns null when transcript is missing or not a string', () => {
    expect(parseTranscriptResponse({ shortCode: 'x', result: {} })).toBeNull()
    expect(parseTranscriptResponse({ result: { transcript: 42 } })).toBeNull()
    expect(parseTranscriptResponse({})).toBeNull()
    expect(parseTranscriptResponse(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run src/lib/reelTranscriptClient.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/lib/reelTranscriptClient.ts`:
```ts
/**
 * Transcript-only reel client — posts a reel's video URL to /api/get-transcript (the
 * lightweight, transcript-only endpoint with a fast ≤15 MB inline path) and returns just
 * the spoken transcript. Used by the voice-profile build, which only needs the words — NOT
 * the full /api/analyze-single-reel (video mechanics + markdown), which it would discard.
 *
 * Best-effort, mirroring reelHookmap: a failed/undeployed call returns null (that reel just
 * yields no transcript) and never throws.
 */
import { getClerkSessionToken } from './clerkToken'

/** Pure: pull the transcript string out of the /api/get-transcript response, or null. */
export function parseTranscriptResponse(json: unknown): string | null {
  const t = (json as { result?: { transcript?: unknown } } | null)?.result?.transcript
  return typeof t === 'string' ? t : null
}

/** Fetch ONE reel's transcript via /api/get-transcript. Returns null on any failure. */
export async function getReelTranscript(
  shortCode: string,
  videoUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const body = JSON.stringify({ downloadedVideoUrl: videoUrl, shortCode })
  const post = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = await getClerkSessionToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    return fetch('/api/get-transcript', { method: 'POST', headers, body, signal })
  }
  try {
    let res = await post()
    if (res.status === 401) res = await post() // token refresh, mirrors reelHookmap
    if (!res.ok) return null
    return parseTranscriptResponse(await res.json())
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Verify** — `bunx vitest run src/lib/reelTranscriptClient.test.ts` → PASS. `bunx tsc -b` → clean. `bunx eslint src/lib/reelTranscriptClient.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/reelTranscriptClient.ts src/lib/reelTranscriptClient.test.ts
git commit -m "feat(perf): transcript-only reel client (/api/get-transcript)"
```

---

## Task 2: Light batch transcriber (`transcribeReelsLight`)

**Files:**
- Modify: `src/lib/reelTranscriber.ts` (add `transcribeReelsLight`; leave `transcribeReels` untouched)

Context: Mirrors `transcribeReels`'s structure (cache-first read of the shared deep cache for a free transcript, one batch Apify video-URL resolve, parallel per-reel transcription at the existing `pLimit(3)`), but calls `getReelTranscript` instead of `analyzeReelHookmap`, and does **not** write the deep cache (its result is transcript-only, not a full `SingleReelResult`). Drops the `handle` param — `/api/get-transcript` doesn't take the Apify metadata.

- [ ] **Step 1: Add the function.** In `src/lib/reelTranscriber.ts`, add the import (next to the existing `import { analyzeReelHookmap } from './reelHookmap'`):
```ts
import { getReelTranscript } from './reelTranscriptClient'
```
Then append `transcribeReelsLight` after the existing `transcribeReels` function:
```ts
/**
 * TRANSCRIPT-ONLY sibling of transcribeReels for the voice-profile build. Same cache-first +
 * batched-URL-resolve + parallel(pLimit 3) shape, but hits /api/get-transcript (fast, no video
 * analysis) and does NOT write the deep singleReelCache (its result is transcript-only). Reads
 * the deep cache though — a reel already deep-analyzed yields its transcript for free.
 */
export async function transcribeReelsLight(
  reels: ReelData[],
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const transcripts: Record<string, string> = {}
  if (reels.length === 0) return transcripts

  // Cache-first: a deep-cached reel already carries its transcript — no network.
  const uncached: ReelData[] = []
  for (const reel of reels) {
    const cached = await getCachedSingleReel(reel.shortCode)
    if (cached) transcripts[reel.shortCode] = cached.transcript
    else uncached.push(reel)
  }
  if (signal?.aborted || uncached.length === 0) return transcripts

  // ONE batch Apify run resolves stable video URLs for the UNCACHED reels only.
  const videos = await scrapeReelVideos(uncached.map((r) => r.url), apifyKeys, signal)
  if (signal?.aborted) return transcripts

  await Promise.all(
    uncached.map((reel) =>
      transcribeLimiter(async () => {
        if (signal?.aborted) return
        const videoUrl = videos.get(reel.shortCode)
        if (!videoUrl) return // no downloadable video → skip
        const transcript = await getReelTranscript(reel.shortCode, videoUrl, signal)
        if (transcript != null) transcripts[reel.shortCode] = transcript
      }),
    ),
  )
  return transcripts
}
```
(`ReelData`, `getCachedSingleReel`, `scrapeReelVideos`, `transcribeLimiter` are all already imported/defined in this file. `setCachedSingleReel` is intentionally NOT used here.)

- [ ] **Step 2: Verify** — `bunx tsc -b` → clean (no unused-import errors; `transcribeReelsLight` will be consumed in Task 3, but exports don't trip `noUnusedLocals`). `bunx eslint src/lib/reelTranscriber.ts`. `bun run test` → existing suite green.

- [ ] **Step 3: Commit**
```bash
git add src/lib/reelTranscriber.ts
git commit -m "feat(perf): transcribeReelsLight — transcript-only voice-build path"
```

---

## Task 3: Point buildVoiceProfile at the light path

**Files:**
- Modify: `src/hooks/useRepurposeReel.ts`

Context: The @handle voice-build currently calls the shared `transcribeReels` (full deep analysis, discarded). Swap it to `transcribeReelsLight`. `transcribeReels` is used ONLY here in this file, so the import switches over entirely.

- [ ] **Step 1: Read the file** to confirm the exact import + call. Expect an import `import { transcribeReels } from '../lib/reelTranscriber'` and a single call `const transcriptMap = await transcribeReels(handle, reels, apifyKeys, signal)` in `buildVoiceProfile`'s @handle path.

- [ ] **Step 2: Swap the import.** Change:
```ts
import { transcribeReels } from '../lib/reelTranscriber'
```
to:
```ts
import { transcribeReelsLight } from '../lib/reelTranscriber'
```
(If `transcribeReels` is imported alongside other names from that module, keep the others and just replace `transcribeReels` → `transcribeReelsLight`. If `transcribeReels` is used more than once in this file, STOP and report — the spec assumes a single voice-build call site.)

- [ ] **Step 3: Swap the call.** Change:
```ts
      const transcriptMap = await transcribeReels(handle, reels, apifyKeys, signal)
```
to:
```ts
      const transcriptMap = await transcribeReelsLight(reels, apifyKeys, signal)
```
(Drop `handle` — the light path doesn't need the Apify metadata. `handle` stays in scope; it's used elsewhere in the function for the profile.)

- [ ] **Step 4: Verify** — `bunx tsc -b` → clean (confirms no other `transcribeReels` usage in the file broke). `bunx eslint src/hooks/useRepurposeReel.ts`. `bunx vitest run src/hooks` + `bun run test` → green. `bun run build` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/hooks/useRepurposeReel.ts
git commit -m "feat(perf): voice-build uses the transcript-only path (2-4x faster/reel)"
```

---

## Task 4: Verification

**Files:** none.

- [ ] **Step 1: Full gate** — `bun run test && bun run build` → all pass, build clean. `bunx eslint src/lib/reelTranscriptClient.ts src/lib/reelTranscriber.ts src/hooks/useRepurposeReel.ts` → clean.

- [ ] **Step 2: Confirm the shared path is untouched** — `git diff main...feat/voice-build-efficiency -- src/lib/reelTranscriber.ts` should show ONLY the added `transcribeReelsLight` + its import — the existing `transcribeReels` body is unchanged (the corpus/gallery deep-cache warming still works).

- [ ] **Step 3: Manual parity + speed (Vercel preview — needs serverless + Clerk):** build a voice profile for one real `@handle` twice (clear the corpus profile between): time it before this branch vs on this branch. Confirm (a) the resulting voice profile is equivalent (same `vocabulary`/`hookHabits`/`language` character), and (b) it's measurably faster (fewer/faster Gemini calls — inline transcript path vs Files-API deep analysis). Also confirm a `@handle` with a >15 MB reel still transcribes (Files-API fallback in `/api/get-transcript`).

- [ ] **Step 4: Branch ready** — `git status` clean; `feat/voice-build-efficiency` ready for PR.

---

## Self-review

**Spec coverage:** transcript-only voice-build via `/api/get-transcript` ✅ (T1 client, T2 batch, T3 swap); `transcribeReels` untouched / reel-analysis pipeline unaffected ✅ (T2 adds a sibling, T4 §2 confirms); cache-first free transcript preserved ✅ (T2); best-effort no-throw ✅ (T1 null, T2 skip); reel count 8 unchanged ✅; #2 dropped ✅ (not in plan). Manual parity + >15 MB fallback ✅ (T4).

**Placeholder scan:** none — full code in every step. (T3's "if used more than once, STOP" is a real guard, not a placeholder.)

**Type consistency:** `parseTranscriptResponse`/`getReelTranscript` (T1) consumed by `transcribeReelsLight` (T2), consumed by `buildVoiceProfile` (T3). `transcribeReelsLight(reels, apifyKeys, signal)` signature (T2) matches the T3 call (no `handle`). Return `Record<shortCode, string>` matches what `buildVoiceProfile` expects from the old `transcribeReels`.
