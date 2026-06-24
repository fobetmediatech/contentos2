# Profile Analyzer → HookMap-Style Per-Reel Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a single-`@handle` profile analysis runs, deep-analyze all ~10 scraped reels with the HookMap analyzer (replacing the quick caption cards), add a context-safe creator-level summary shown inline + on the Report page, and remove the old deep-report path.

**Architecture:** Branch `startAnalysis` on handle count: 1 handle → new HookMap pipeline (`scrapeTopReels` → `scrapeReelVideos` → per-reel `/api/analyze-single-reel`, progressive, cached, capped at 3 concurrent) → `synthesizeCreatorHooks` (digest + token-budgeted map-reduce). 2+ handles → existing quick path, untouched. Deep-report path deleted across its ~18 dependents.

**Tech Stack:** React + TypeScript, Zustand (persisted via `supabaseStorage`), TanStack Query, Vitest + Testing Library, `p-limit`, Vercel serverless (`/api/analyze-single-reel`), Gemini REST via `src/ai/gemini.ts`. Package manager: **bun**.

## Global Constraints

- Package manager is **bun**: run `bun run test`, `bun run build`, `bun run lint` (never npm/yarn).
- Server keys are server-side only (`process.env`, no `VITE_` prefix). No new server function — reuse `/api/analyze-single-reel`.
- Persisted store schema changes: bump `version` + handle old versions in `migrate` (see existing `reelAnalysisStore` / `discoveryStore`).
- Persisted payload `kind` discriminants are **frozen** — `ResultPayload kind: 'reel'` must not change.
- DESIGN.md tokens: bg `#1A1410`/`#2C2218`, accent `#E07B3A`, text `#F5EDD6`/`#C4A882`/`#7A6A54`; AI-generated content uses violet `#A78BFA`; fonts Outfit / Instrument Serif / DM Mono. No Inter/slate/indigo.
- All user-facing error strings are fixed + safe (never raw API bodies) — see `src/lib/errorMessages.ts`.
- **GitNexus discipline:** before editing any shared symbol run `impact({target, direction:'upstream', repo:'contentos2'})` and note risk; before each commit run `detect_changes({scope:'compare', base_ref:'main', repo:'contentos2'})`. Re-run `node .gitnexus/run.cjs analyze --force` after large deletions.
- Branch: `feat/profile-hookmap` (already created, stacked on `feat/galleryv1`).

---

## File Structure

**Phase 1 — pipeline + per-reel UI**
- `src/store/reelAnalysisStore.ts` (modify) — add `caseStudies`, `caseStudyStatus`, `ReelCaseStatus`, `setReelCaseStudy`; persist `version` 2→3 + migrate.
- `src/lib/reelHookmap.ts` (create) — `analyzeReelHookmap(handle, reel, videoUrl, signal)`: one `/api/analyze-single-reel` call returning `SingleReelResult`; reused by the pipeline. (Factor the POST out of `reelTranscriber.ts`.)
- `src/hooks/useReelAnalysis.ts` (modify) — `runCreatorHookmapPipeline`; branch in `startAnalysis` on `handles.length === 1`.
- `src/components/ReelCaseStudyCard.tsx` (create) — per-reel progressive case-study card (reuses `markdown/CaseStudyMarkdown` + a shared transcript/segments view).
- `src/components/ReelTranscriptView.tsx` (create) — segment/transcript view factored out of `SingleReelResultMessage.tsx`.
- `src/components/InlineReelResults.tsx` (modify) — render case-study cards for single-handle runs.

**Phase 2 — summary + Report page**
- `src/lib/reelDigest.ts` (create) — pure `buildReelDigest`, `estimateTokens`, `planDigestChunks`.
- `src/ai/prompts/creatorHookSummary.ts` (create) — prompt builder + `CreatorHookSummary` type + schema.
- `src/lib/reelAnalyzer.ts` (modify) — `synthesizeCreatorHooks` (map-reduce orchestration).
- `src/store/reelAnalysisStore.ts` (modify) — add `hookSummary` + `setHookSummary`.
- `src/components/HookSummaryCard.tsx` (create) — inline summary block.
- `src/pages/ReportPage.tsx` (modify) — render `hookSummary`.

**Phase 3 — remove deep-report path**
- Delete: `src/ai/prompts/deepReelAnalysis.ts`, `src/lib/deepReelCache.ts`, deep tests, `DeepReelCard` (in `InlineReelResults.tsx`), `export.deepReport`.
- Modify (remove deep refs): `src/hooks/useReelAnalysis.ts`, `src/store/reelAnalysisStore.ts`, `src/lib/reelSnapshot.ts`, `src/store/reelPersist.ts`, `src/domain/chat.ts`, `src/pages/ChatPage.tsx`, `src/components/ReelResultMessage.tsx`, `src/shared/utils/export.ts`, agent golden-set.
- Keep: `src/lib/reelVideoClient.ts` (`scrapeReelVideos` reused), `/api/analyze-reel-video.ts` (dead but harmless).

---

# PHASE 1 — Single-handle HookMap pipeline + per-reel UI

### Task 1.1: Store — per-reel case-study state

**Files:**
- Modify: `src/store/reelAnalysisStore.ts`
- Test: `src/store/reelAnalysisStore.test.ts` (create if absent)

**Interfaces:**
- Produces:
  ```ts
  export type ReelCaseStatus = 'pending' | 'analyzing' | 'done' | 'skipped' | 'failed'
  // CreatorAnalysisState additions:
  caseStudies?: Record<string, SingleReelResult>     // keyed by shortCode
  caseStudyStatus?: Record<string, ReelCaseStatus>   // keyed by shortCode
  // store action:
  setReelCaseStudy(handle: string, shortCode: string,
    partial: { status?: ReelCaseStatus; result?: SingleReelResult }): void
  ```
  (`SingleReelResult` imported from `../store/singleReelStore`.)

- [ ] **Step 1: GitNexus impact**

Run: `impact({target:"CreatorAnalysisState", direction:"upstream", repo:"contentos2"})` and `impact({target:"useReelAnalysisStore", direction:"upstream", repo:"contentos2", summaryOnly:true})`. Note MEDIUM risk (13 consumers, additive). Proceed.

- [ ] **Step 2: Write the failing test**

```ts
// src/store/reelAnalysisStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useReelAnalysisStore } from './reelAnalysisStore'

beforeEach(() => useReelAnalysisStore.getState().reset())

describe('setReelCaseStudy', () => {
  it('merges per-reel status and result into a creator without clobbering siblings', () => {
    const s = useReelAnalysisStore.getState()
    s.setCreatorState('alice', { handle: 'alice', status: 'analyzing', reels: [], analyses: {} })
    s.setReelCaseStudy('alice', 'r1', { status: 'analyzing' })
    s.setReelCaseStudy('alice', 'r2', { status: 'pending' })
    s.setReelCaseStudy('alice', 'r1', {
      status: 'done',
      result: { transcript: 't', segments: [], videoAnalysis: {} as never, markdown: '# m' },
    })
    const c = useReelAnalysisStore.getState().creatorStates['alice']
    expect(c.caseStudyStatus).toEqual({ r1: 'done', r2: 'pending' })
    expect(c.caseStudies?.r1?.markdown).toBe('# m')
    expect(c.caseStudies?.r2).toBeUndefined()
  })

  it('does nothing when the creator does not exist (never mints from a case-study update)', () => {
    useReelAnalysisStore.getState().setReelCaseStudy('ghost', 'r1', { status: 'done' })
    expect(useReelAnalysisStore.getState().creatorStates['ghost']).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test -- src/store/reelAnalysisStore.test.ts`
Expected: FAIL — `setReelCaseStudy is not a function`.

- [ ] **Step 4: Implement**

In `src/store/reelAnalysisStore.ts`:
1. Add import: `import type { SingleReelResult } from './singleReelStore'`.
2. Add the type above `CreatorAnalysisState`:
   ```ts
   export type ReelCaseStatus = 'pending' | 'analyzing' | 'done' | 'skipped' | 'failed'
   ```
3. Add to `CreatorAnalysisState` (after `transcripts?`):
   ```ts
   caseStudies?: Record<string, SingleReelResult>     // keyed by shortCode (HookMap full result)
   caseStudyStatus?: Record<string, ReelCaseStatus>   // keyed by shortCode (progressive per reel)
   ```
4. Add to the store interface action list:
   ```ts
   setReelCaseStudy: (
     handle: string,
     shortCode: string,
     partial: { status?: ReelCaseStatus; result?: SingleReelResult },
   ) => void
   ```
5. Implement (mirror `setDeepReel`'s never-mint guard):
   ```ts
   setReelCaseStudy: (handle, shortCode, partial) =>
     set((prev) => {
       const creator = prev.creatorStates[handle]
       if (!creator) return {} // never create a creator from a case-study update — pipeline seeds it
       const caseStudyStatus = { ...creator.caseStudyStatus }
       const caseStudies = { ...creator.caseStudies }
       if (partial.status) caseStudyStatus[shortCode] = partial.status
       if (partial.result) caseStudies[shortCode] = partial.result
       return {
         creatorStates: {
           ...prev.creatorStates,
           [handle]: { ...creator, caseStudyStatus, caseStudies },
         },
       }
     }),
   ```
6. Persist: bump `version: 2` → `version: 3`; update the comment; keep `migrate: (state) => state` (additive). Add `caseStudies`/`caseStudyStatus` are part of `creatorStates` which is already in `partialize`, so no partialize change needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- src/store/reelAnalysisStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `bun run lint && bunx tsc -b`
Then `detect_changes({scope:"compare", base_ref:"main", repo:"contentos2"})`.
```bash
git add src/store/reelAnalysisStore.ts src/store/reelAnalysisStore.test.ts
git commit -m "feat(reels): per-reel case-study state on CreatorAnalysisState"
```

---

### Task 1.2: HookMap per-reel caller (`reelHookmap.ts`)

**Files:**
- Create: `src/lib/reelHookmap.ts`
- Modify: `src/lib/reelTranscriber.ts` (re-use the new caller; keep transcript-only export working)
- Test: `src/lib/reelHookmap.test.ts`

**Interfaces:**
- Consumes: `scrapeReelVideos` (`./reelVideoClient`), `getCachedSingleReel`/`setCachedSingleReel` (`./singleReelCache`), `getClerkSessionToken` (`./clerkToken`), `SingleReelResult` (`../store/singleReelStore`), `ReelData` (`../store/reelAnalysisStore`).
- Produces:
  ```ts
  export async function analyzeReelHookmap(
    handle: string, reel: ReelData, videoUrl: string, signal?: AbortSignal,
  ): Promise<SingleReelResult | null>   // null on any failure (best-effort)
  export { singleReelFnAvailable } from './reelTranscriber' // re-export the deploy probe
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/reelHookmap.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReelData } from '../store/reelAnalysisStore'
import { analyzeReelHookmap } from './reelHookmap'

vi.mock('./clerkToken', () => ({ getClerkSessionToken: async () => 'tok' }))

const reel = (over: Partial<ReelData> = {}): ReelData => ({
  shortCode: 'abc', url: 'https://www.instagram.com/reel/abc/', displayUrl: '',
  videoViewCount: 1, likesCount: 1, commentsCount: 1, videoDuration: 10, caption: 'c', hashtags: [], ...over,
})

afterEach(() => vi.restoreAllMocks())

describe('analyzeReelHookmap', () => {
  it('POSTs the reel to /api/analyze-single-reel and returns result on 200', async () => {
    const result = { transcript: 't', segments: [], videoAnalysis: {}, markdown: '# m' }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ result }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await analyzeReelHookmap('alice', reel(), 'https://video/abc.mp4')
    expect(out).toEqual(result)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/analyze-single-reel')
    expect((opts as RequestInit).method).toBe('POST')
    expect(JSON.parse((opts as RequestInit).body as string).apify.ownerUsername).toBe('alice')
  })

  it('returns null when the server responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await analyzeReelHookmap('alice', reel(), 'https://video/abc.mp4')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/reelHookmap.test.ts`
Expected: FAIL — cannot find module `./reelHookmap`.

- [ ] **Step 3: Implement**

Create `src/lib/reelHookmap.ts` by moving the `analyzeSingleReel` POST helper out of `reelTranscriber.ts` and exporting it as `analyzeReelHookmap` (same body, returns the full `SingleReelResult` — see `reelTranscriber.ts` lines ~90–125 for the exact request shape and the 401-retry). Re-export `singleReelFnAvailable`. Then in `reelTranscriber.ts`, import `analyzeReelHookmap` and use it inside `transcribeReels` (replace the local `analyzeSingleReel`), keeping `transcribeReels`/`singleReelFnAvailable` exports intact.

```ts
// src/lib/reelHookmap.ts
import type { ReelData } from '../store/reelAnalysisStore'
import type { SingleReelResult } from '../store/singleReelStore'
import { getClerkSessionToken } from './clerkToken'

export { singleReelFnAvailable } from './reelTranscriber'

export async function analyzeReelHookmap(
  handle: string, reel: ReelData, videoUrl: string, signal?: AbortSignal,
): Promise<SingleReelResult | null> {
  const body = JSON.stringify({
    downloadedVideoUrl: videoUrl,
    shortCode: reel.shortCode,
    apify: {
      ownerUsername: handle, caption: reel.caption, likesCount: reel.likesCount,
      commentsCount: reel.commentsCount, videoViewCount: reel.videoViewCount,
      videoDuration: reel.videoDuration, hashtags: reel.hashtags, musicInfo: reel.musicInfo,
    },
  })
  const post = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = await getClerkSessionToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    return fetch('/api/analyze-single-reel', { method: 'POST', headers, body, signal })
  }
  try {
    let res = await post()
    if (res.status === 401) res = await post()
    if (!res.ok) return null
    const json = (await res.json()) as { result: SingleReelResult }
    return json.result
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- src/lib/reelHookmap.test.ts src/lib/reelTranscriber.test.ts` (if the latter exists)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run lint && bunx tsc -b
git add src/lib/reelHookmap.ts src/lib/reelHookmap.test.ts src/lib/reelTranscriber.ts
git commit -m "refactor(reels): extract analyzeReelHookmap (full SingleReelResult) for reuse"
```

---

### Task 1.3: Single-handle HookMap pipeline in `useReelAnalysis`

**Files:**
- Modify: `src/hooks/useReelAnalysis.ts`
- Test: `src/hooks/useReelAnalysis.hookmap.test.ts` (create)

**Interfaces:**
- Consumes: `scrapeTopReels`, `scrapeReelVideos`, `getCachedSingleReel`/`setCachedSingleReel`, `analyzeReelHookmap`/`singleReelFnAvailable` (Task 1.2), `setReelCaseStudy` (Task 1.1), `harvestReelContent`/`useCorpusStore`.
- Produces: `startAnalysis` now routes a single handle through `runCreatorHookmapPipeline`. (Public hook surface unchanged.)

- [ ] **Step 1: GitNexus impact**

Run: `impact({target:"startAnalysis", direction:"upstream", repo:"contentos2", summaryOnly:true})` and `context({name:"runCreatorPipeline", repo:"contentos2"})`. Note the branch is additive; the multi-handle path is untouched.

- [ ] **Step 2: Write the failing test**

```ts
// src/hooks/useReelAnalysis.hookmap.test.ts  (@vitest-environment jsdom)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../lib/reelScraper', () => ({
  scrapeTopReels: vi.fn(async () => ([
    { shortCode: 'r1', url: 'u1', displayUrl: '', videoViewCount: 10, likesCount: 1, commentsCount: 1, videoDuration: 9, caption: 'a', hashtags: [] },
  ])),
  NoReelsError: class extends Error {},
}))
vi.mock('../lib/reelVideoClient', () => ({ scrapeReelVideos: vi.fn(async () => new Map([['r1', 'https://v/r1.mp4']])) }))
vi.mock('../lib/singleReelCache', () => ({ getCachedSingleReel: vi.fn(async () => undefined), setCachedSingleReel: vi.fn() }))
vi.mock('../lib/reelHookmap', () => ({
  singleReelFnAvailable: vi.fn(async () => true),
  analyzeReelHookmap: vi.fn(async () => ({ transcript: 't1', segments: [], videoAnalysis: {}, markdown: '# r1' })),
}))
vi.mock('../lib/reelAnalyzer', async (orig) => ({ ...(await orig()), synthesizeCreatorHooks: vi.fn(async () => null) }))

import { useReelAnalysis } from './useReelAnalysis'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'

beforeEach(() => useReelAnalysisStore.getState().reset())

describe('single-handle HookMap pipeline', () => {
  it('analyzes each reel via the HookMap analyzer and stores the case study', async () => {
    const { result } = renderHook(() => useReelAnalysis())
    await act(async () => { await result.current.startAnalysis(['alice']) })
    await waitFor(() => {
      const c = useReelAnalysisStore.getState().creatorStates['alice']
      expect(c?.caseStudyStatus?.r1).toBe('done')
      expect(c?.caseStudies?.r1?.markdown).toBe('# r1')
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test -- src/hooks/useReelAnalysis.hookmap.test.ts`
Expected: FAIL — `caseStudyStatus` undefined (still on the quick path).

- [ ] **Step 4: Implement**

In `src/hooks/useReelAnalysis.ts`:
1. Imports: `import { analyzeReelHookmap, singleReelFnAvailable } from '../lib/reelHookmap'` (drop the `reelTranscriber` import of `singleReelFnAvailable` if now unused) and `import { synthesizeCreatorHooks } from '../lib/reelAnalyzer'` (added in Phase 2; for Phase 1 leave a `// Phase 2` no-op call guarded by `typeof` or omit until 2.3). Pull `setReelCaseStudy` from the store hook destructure.
2. Add a module-scope `hookmapLimiter = pLimit(3)`.
3. Add `runCreatorHookmapPipeline`:
   ```ts
   async function runCreatorHookmapPipeline(
     handle: string, apifyKeys: string[], signal: AbortSignal,
   ) {
     const store = useReelAnalysisStore.getState()
     try {
       const reels = await scrapeTopReels(handle, 10, apifyKeys, signal)
       if (signal.aborted) return
       const seeded: Record<string, ReelCaseStatus> = {}
       for (const r of reels) seeded[r.shortCode] = 'pending'
       store.setCreatorState(handle, { reels, status: 'analyzing', caseStudyStatus: seeded, caseStudies: {} })

       // cache-first; only uncached reels need a video URL + a network analysis
       const uncached: typeof reels = []
       for (const r of reels) {
         const cached = await getCachedSingleReel(r.shortCode)
         if (cached) store.setReelCaseStudy(handle, r.shortCode, { status: 'done', result: cached })
         else uncached.push(r)
       }
       if (signal.aborted) return

       if (uncached.length > 0) {
         const videos = await scrapeReelVideos(uncached.map((r) => r.url), apifyKeys, signal)
         if (signal.aborted) return
         await Promise.all(uncached.map((reel) => hookmapLimiter(async () => {
           if (signal.aborted) return
           const videoUrl = videos.get(reel.shortCode)
           if (!videoUrl) { store.setReelCaseStudy(handle, reel.shortCode, { status: 'skipped' }); return }
           store.setReelCaseStudy(handle, reel.shortCode, { status: 'analyzing' })
           const result = await analyzeReelHookmap(handle, reel, videoUrl, signal)
           if (signal.aborted) return
           if (!result) { store.setReelCaseStudy(handle, reel.shortCode, { status: 'failed' }); return }
           store.setReelCaseStudy(handle, reel.shortCode, { status: 'done', result })
           void setCachedSingleReel(reel.shortCode, result)
         })))
       }
       if (signal.aborted) return
       store.setCreatorState(handle, { status: 'done' })
     } catch (err) {
       if (signal.aborted) return
       if (err instanceof NoReelsError) store.setCreatorState(handle, { status: 'no-reels', error: 'No recent Reels found.' })
       else store.setCreatorState(handle, { status: 'failed', error: 'Analysis failed — the account may be private, or try again.' })
     }
   }
   ```
   (Import `ReelCaseStatus` from the store.)
4. In `startAnalysis`, after `setActiveHandles(handles)` + seeding, branch:
   ```ts
   if (handles.length === 1) {
     if (!(await singleReelFnAvailable(controller.signal))) {
       setSynthesisError('Deep reel analysis isn’t available in this environment.')
       return
     }
     await runCreatorHookmapPipeline(handles[0], apifyKeys, controller.signal)
     if (controller.signal.aborted) return
     // Phase 2.3 wires synthesizeCreatorHooks here.
     // Corpus harvest (transcript+thumbnail) still fires via ChatPage synthesis effect / existing path.
     return
   }
   // ≥2 handles: existing quick pipeline below (unchanged)
   ```
   Keep the existing `Promise.allSettled(handles.map(runCreatorPipeline))` + `synthesizeNiche` for the multi-handle branch. Remove the now-superseded `enrichTranscripts` call from the single-handle path (the HookMap pipeline produces the full result, including the transcript, directly).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- src/hooks/useReelAnalysis.hookmap.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + commit**

Run: `bun run test && bun run lint && bunx tsc -b`, then `detect_changes`.
```bash
git add src/hooks/useReelAnalysis.ts src/hooks/useReelAnalysis.hookmap.test.ts
git commit -m "feat(reels): single-handle profile runs deep-analyze every reel (HookMap)"
```

---

### Task 1.4: Per-reel case-study UI

**Files:**
- Create: `src/components/ReelTranscriptView.tsx` (extracted from `SingleReelResultMessage.tsx`)
- Create: `src/components/ReelCaseStudyCard.tsx`
- Test: `src/components/ReelCaseStudyCard.test.tsx`
- Modify: `src/components/SingleReelResultMessage.tsx` (use the extracted view), `src/components/InlineReelResults.tsx` (render case-study cards for single-handle)

**Interfaces:**
- Consumes: `CaseStudyMarkdown` (`./markdown/CaseStudyMarkdown`), `SingleReelResult`/`ReelCaseStatus`, `ReelData`.
- Produces:
  ```ts
  export function ReelTranscriptView({ result }: { result: SingleReelResult }): JSX.Element
  export function ReelCaseStudyCard({ reel, status, result }:
    { reel: ReelData; status: ReelCaseStatus; result?: SingleReelResult }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ReelCaseStudyCard.test.tsx  (@vitest-environment jsdom)
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ReelCaseStudyCard } from './ReelCaseStudyCard'

const reel = { shortCode: 'r1', url: 'https://www.instagram.com/reel/r1/', displayUrl: '', videoViewCount: 1000, likesCount: 10, commentsCount: 1, videoDuration: 9, caption: 'c', hashtags: [] }
afterEach(cleanup)

describe('ReelCaseStudyCard', () => {
  it('shows a pending/analyzing state while in progress', () => {
    render(<ReelCaseStudyCard reel={reel} status="analyzing" />)
    expect(screen.getByText(/analy/i)).toBeTruthy()
  })
  it('renders the case-study markdown when done and reveals the transcript on toggle', () => {
    render(<ReelCaseStudyCard reel={reel} status="done"
      result={{ transcript: 'hello there', segments: [{ start: 0, text: 'hello there' }], videoAnalysis: {} as never, markdown: '## Why it worked' }} />)
    expect(screen.getByText('Why it worked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /transcript/i }))
    expect(screen.getByText(/hello there/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/components/ReelCaseStudyCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

1. Create `ReelTranscriptView.tsx` by lifting the segment/transcript block (the `fmtTime` helper + the `[m:ss] text` rendering with raw-transcript fallback) out of `SingleReelResultMessage.tsx`; export `ReelTranscriptView({ result })`. Update `SingleReelResultMessage.tsx` to import + use it (no behavior change).
2. Create `ReelCaseStudyCard.tsx`:
   - `status` `pending`/`analyzing` → a pulsing saffron dot + label (mirror `SingleReelResultMessage` running row) with the reel's view count.
   - `failed`/`skipped` → a muted one-liner (`Couldn’t analyze this reel.` / `No video to analyze.`).
   - `done` + `result` → `<CaseStudyMarkdown>` of `result.markdown`, a metrics line (DM Mono), and a collapsible `ReelTranscriptView` behind a "Transcript" toggle (`useState`). Use DESIGN.md tokens; violet `#A78BFA` only on the AI header.
3. The component is self-contained (no store reads) so it's trivially testable.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/components/ReelCaseStudyCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into InlineReelResults (single-handle only)**

In `InlineReelResults.tsx`: when `handles.length === 1`, for the creator render its reels as `ReelCaseStudyCard` (status from `creatorStates[handle].caseStudyStatus?.[shortCode] ?? 'pending'`, result from `caseStudies?.[shortCode]`) instead of the quick hook cards. Leave the `handles.length > 1` branch (existing quick cards) unchanged. Update `InlineReelResults.test.tsx` accordingly (a single-handle render shows a case-study card; a two-handle render still shows quick cards).

- [ ] **Step 6: Full suite + commit**

Run: `bun run test && bun run lint && bunx tsc -b`, then `detect_changes`.
```bash
git add src/components/ReelTranscriptView.tsx src/components/ReelCaseStudyCard.tsx src/components/ReelCaseStudyCard.test.tsx src/components/SingleReelResultMessage.tsx src/components/InlineReelResults.tsx src/components/InlineReelResults.test.tsx
git commit -m "feat(reels): per-reel HookMap case-study cards for single-handle runs"
```

**Phase 1 gate:** `bun run test && bun run build && bun run lint` all green; manually (user) a single-`@handle` run streams case studies. Multi-handle unchanged.

---

# PHASE 2 — Creator summary (context-safe) + Report page

### Task 2.1: Pure digest + chunk planner (`reelDigest.ts`)

**Files:**
- Create: `src/lib/reelDigest.ts`
- Test: `src/lib/reelDigest.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReelDigest { shortCode: string; views: number; likes: number; comments: number; hookOpening: string; videoSignals: string }
  export function buildReelDigest(result: SingleReelResult, reel: ReelData): ReelDigest
  export function estimateTokens(text: string): number          // ceil(len/4)
  export function digestText(d: ReelDigest): string             // stable serialization used for sizing + prompt
  export function planDigestChunks(digests: ReelDigest[], budget: number): ReelDigest[][]
  export const SUMMARY_INPUT_TOKEN_BUDGET = 100_000
  export const TRANSCRIPT_PREFIX_CHARS = 600
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/reelDigest.test.ts
import { describe, it, expect } from 'vitest'
import { buildReelDigest, estimateTokens, digestText, planDigestChunks } from './reelDigest'

const result = (over = {}) => ({
  transcript: 'x'.repeat(5000), segments: [{ start: 0, text: 'first line here' }],
  videoAnalysis: { dominant_framing: 'talking head', cuts_count: 8, trending_audio_hint: 'none' } as never,
  markdown: '#'.repeat(9000), ...over,
})
const reel = (over = {}) => ({ shortCode: 'r1', url: 'u', displayUrl: '', videoViewCount: 1000, likesCount: 100, commentsCount: 10, videoDuration: 9, caption: 'c', hashtags: [], ...over })

describe('buildReelDigest', () => {
  it('drops the full markdown, bounds the transcript, and keeps hook + metrics', () => {
    const d = buildReelDigest(result() as never, reel() as never)
    expect(d.shortCode).toBe('r1'); expect(d.views).toBe(1000)
    expect(d.hookOpening).toContain('first line here')
    expect(d.hookOpening.length).toBeLessThanOrEqual(600 + 1)
    expect(digestText(d)).not.toContain('#'.repeat(9000)) // markdown excluded
  })
})

describe('planDigestChunks', () => {
  it('returns a single chunk when everything fits the budget', () => {
    const ds = [1,2,3].map((i) => buildReelDigest(result() as never, reel({ shortCode: 'r'+i }) as never))
    expect(planDigestChunks(ds, 1_000_000)).toHaveLength(1)
  })
  it('splits into multiple chunks when over budget, each under budget, preserving all reels', () => {
    const ds = Array.from({ length: 6 }, (_, i) => buildReelDigest(result() as never, reel({ shortCode: 'r'+i }) as never))
    const chunks = planDigestChunks(ds, estimateTokens(digestText(ds[0])) * 2 + 1) // ~2 per chunk
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat().map((d) => d.shortCode).sort()).toEqual(ds.map((d) => d.shortCode).sort())
    for (const c of chunks) expect(estimateTokens(c.map(digestText).join('\n'))).toBeLessThanOrEqual(estimateTokens(digestText(ds[0])) * 2 + 1)
  })
})
```

- [ ] **Step 2: Run test → fails** (`bun run test -- src/lib/reelDigest.test.ts`) — module missing.

- [ ] **Step 3: Implement** `src/lib/reelDigest.ts`:
```ts
import type { ReelData } from '../store/reelAnalysisStore'
import type { SingleReelResult } from '../store/singleReelStore'

export const SUMMARY_INPUT_TOKEN_BUDGET = 100_000
export const TRANSCRIPT_PREFIX_CHARS = 600

export interface ReelDigest { shortCode: string; views: number; likes: number; comments: number; hookOpening: string; videoSignals: string }

export function estimateTokens(text: string): number { return Math.ceil(text.length / 4) }

export function buildReelDigest(result: SingleReelResult, reel: ReelData): ReelDigest {
  const opening = (result.segments?.[0]?.text || result.transcript || '').slice(0, TRANSCRIPT_PREFIX_CHARS)
  const va = result.videoAnalysis ?? ({} as SingleReelResult['videoAnalysis'])
  const videoSignals = [va.dominant_framing, va.trending_audio_hint, va.cuts_count != null ? `${va.cuts_count} cuts` : '']
    .filter(Boolean).join(' · ')
  return { shortCode: reel.shortCode, views: reel.videoViewCount, likes: reel.likesCount, comments: reel.commentsCount, hookOpening: opening, videoSignals }
}

export function digestText(d: ReelDigest): string {
  return `Reel ${d.shortCode} — ${d.views} views, ${d.likes} likes, ${d.comments} comments\nHook: ${d.hookOpening}\nVideo: ${d.videoSignals}`
}

export function planDigestChunks(digests: ReelDigest[], budget: number): ReelDigest[][] {
  const chunks: ReelDigest[][] = []
  let cur: ReelDigest[] = []
  let curTokens = 0
  for (const d of digests) {
    const t = estimateTokens(digestText(d))
    if (cur.length > 0 && curTokens + t > budget) { chunks.push(cur); cur = []; curTokens = 0 }
    cur.push(d); curTokens += t
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks
}
```

- [ ] **Step 4: Run test → passes.** **Step 5: Commit**
```bash
bun run lint && bunx tsc -b
git add src/lib/reelDigest.ts src/lib/reelDigest.test.ts
git commit -m "feat(reels): pure reel digest + token-budgeted chunk planner"
```

---

### Task 2.2: `synthesizeCreatorHooks` (prompt + map-reduce)

**Files:**
- Create: `src/ai/prompts/creatorHookSummary.ts`
- Modify: `src/lib/reelAnalyzer.ts`
- Test: `src/lib/reelAnalyzer.creatorHooks.test.ts`

**Interfaces:**
- Consumes: `buildReelDigest`/`planDigestChunks`/`digestText`/`SUMMARY_INPUT_TOKEN_BUDGET` (2.1); the existing Gemini caller used elsewhere in `reelAnalyzer.ts` (follow `synthesizeNiche`'s call + parse pattern).
- Produces:
  ```ts
  export interface CreatorHookSummary {
    handle: string; reelCount: number
    dominantHooks: Array<{ pattern: string; count: number; example: string }>
    recurringOpenings: string[]; whatConsistentlyWorks: string[]; replicableTemplates: string[]
    narrative: string
    benchmarks: { medianViews: number; medianLikes: number; commentsLikesRatio: number }
  }
  export async function synthesizeCreatorHooks(
    handle: string, caseStudies: Record<string, SingleReelResult>, reels: ReelData[],
    geminiKeys: string[], signal?: AbortSignal,
  ): Promise<CreatorHookSummary | null>
  ```

- [ ] **Step 1: Write the failing test** — mock the Gemini layer (same module `synthesizeNiche` calls); assert (a) a small set makes ONE Gemini call and returns a parsed summary; (b) when digests exceed a tiny injected budget, it makes multiple map calls + one reduce; (c) code-computed `benchmarks.medianViews` is correct; (d) a thrown map chunk is skipped, not fatal. (Inject the budget via an optional last arg or a module constant the test overrides.)

```ts
// src/lib/reelAnalyzer.creatorHooks.test.ts  (sketch — fill concrete mocks per reelAnalyzer.test.ts patterns)
import { describe, it, expect, vi } from 'vitest'
// vi.mock the gemini caller used by reelAnalyzer; return a valid CreatorHookSummary JSON.
// assert call counts for single vs map-reduce by toggling the budget.
```

- [ ] **Step 2: Run test → fails.**

- [ ] **Step 3: Implement**
  - `creatorHookSummary.ts`: `CreatorHookSummary` type; `buildMapPrompt(handle, digestTexts)` and `buildReducePrompt(handle, partials)` returning the prompt + JSON schema (follow `prompts/` conventions and `synthesizeNiche`'s schema style); a `parseCreatorHookSummary(raw, handle, reelCount)` guard.
  - `reelAnalyzer.ts` `synthesizeCreatorHooks`:
    1. `const digests = reels.filter(r => caseStudies[r.shortCode]).map(r => buildReelDigest(caseStudies[r.shortCode], r))`.
    2. `benchmarks` computed in code (median of views/likes; commentsLikesRatio) — reuse/mirror `computeBenchmarks`.
    3. `const chunks = planDigestChunks(digests, SUMMARY_INPUT_TOKEN_BUDGET)`.
    4. If `chunks.length === 1` → one Gemini call with `buildMapPrompt` → parse → attach `benchmarks` + `reelCount`.
    5. Else map each chunk (best-effort: wrap each in try/catch, `devWarn` + skip on failure) → collect partial summaries → `buildReducePrompt` → reduce. If the joined partials still exceed budget, recurse the reduce over budgeted batches until one remains. If every chunk failed → return `null`.
    6. Thread `signal`; return `null` on abort.

- [ ] **Step 4: Run test → passes.** **Step 5: Commit**
```bash
bun run lint && bunx tsc -b
git add src/ai/prompts/creatorHookSummary.ts src/lib/reelAnalyzer.ts src/lib/reelAnalyzer.creatorHooks.test.ts
git commit -m "feat(reels): context-safe creator-hook synthesis (digest + map-reduce)"
```

---

### Task 2.3: Wire summary into the pipeline + store

**Files:**
- Modify: `src/store/reelAnalysisStore.ts` (add `hookSummary` + `setHookSummary`), `src/hooks/useReelAnalysis.ts`
- Test: extend `useReelAnalysis.hookmap.test.ts`

**Interfaces:**
- Produces: `CreatorAnalysisState.hookSummary?: CreatorHookSummary`; `setHookSummary(handle, summary)`.

- [ ] **Step 1:** Extend the Task 1.3 test to assert that after the run, `creatorStates['alice'].hookSummary` is set (update the `synthesizeCreatorHooks` mock to return a summary object). Run → fails.
- [ ] **Step 2:** Add `hookSummary?: CreatorHookSummary` to `CreatorAnalysisState` (import the type), add `setHookSummary` (merge via `setCreatorState`), and in `runCreatorHookmapPipeline`/`startAnalysis` single-handle branch after reels finish: `const summary = await synthesizeCreatorHooks(handle, caseStudies, reels, geminiKeys, signal); if (summary) store.setHookSummary(handle, summary)`. Read `caseStudies`/`reels` fresh from the store.
- [ ] **Step 3:** Run → passes. Full suite. Commit `feat(reels): creator hook summary wired into single-handle pipeline`.

---

### Task 2.4: `HookSummaryCard` inline

**Files:** Create `src/components/HookSummaryCard.tsx` + test; Modify `InlineReelResults.tsx` to render it above the case-study cards for single-handle runs.

- [ ] TDD: card renders `dominantHooks`, `whatConsistentlyWorks`, `replicableTemplates`, `narrative`, and benchmarks with DESIGN tokens (violet AI header). Wire into `InlineReelResults` single-handle branch (above the reel list). Commit `feat(reels): inline creator hook summary card`.

---

### Task 2.5: Repurpose Report page

**Files:** Modify `src/pages/ReportPage.tsx` + `src/pages/ReportPage.test.tsx`.

- [ ] **Step 1: GitNexus impact** on `ReportPage` + `context({name:"DeepReportCard"})` to see what's being replaced.
- [ ] **Step 2:** Update the test: with a `hookSummary` present in the store (first single-handle creator), `ReportPage` renders the summary (e.g. the narrative + a dominant hook); empty state otherwise. Run → fails.
- [ ] **Step 3:** Replace `deepReport`/`DeepReportCard` usage with `useReelAnalysisStore((s) => firstHookSummary(s.creatorStates))` and render via `HookSummaryCard` (full-page variant). Add a small `firstHookSummary` selector helper. Keep the empty-state.
- [ ] **Step 4:** Run → passes. Commit `feat(report): Report page renders the HookMap creator summary`.

**Phase 2 gate:** full suite + build + lint green; summary appears inline and on `/report` for a single-handle run.

---

# PHASE 3 — Remove the deep-report path

> Do this last. `startDeepReport` has **0 upstream callers** (GitNexus: LOW), so removal is mechanical — let `tsc` + tests find every dangling reference. Run `impact` on each symbol before deleting and `detect_changes` before each commit.

### Task 3.1: Remove the in-chat deep-report trigger + card

**Files:** `src/components/InlineReelResults.tsx` (remove the `onDeepReport` prop, the "✦ Generate deep report" button, `DeepReelCard`, and the `deepReport`/`deepReportStatus` props + rendering), `src/pages/ChatPage.tsx` (remove `onDeepReport={...}` wiring + `startDeepReport` usage), `src/components/ReelResultMessage.tsx` (remove its deep-report CTA/props). Update affected tests.

- [ ] impact on `DeepReelCard`, `onDeepReport`; remove; update `InlineReelResults.test.tsx`; `bun run test && bun run lint && bunx tsc -b`; commit `refactor(reels): remove in-chat deep-report trigger + card`.

### Task 3.2: Remove the deep pipeline from the hook

**Files:** `src/hooks/useReelAnalysis.ts` — delete `startDeepReport`, `runCreatorDeepPipeline`, the deep `deepFnAvailable`, `deepLimiter`, the deep imports (`getCachedDeep`/`setCachedDeep`, deep analyzer fns), and the `startDeepReport`/`deepReport*` returns. Keep `scrapeReelVideos` import (used by the HookMap pipeline). Delete `src/hooks/useReelAnalysis.deep.test.ts`.

- [ ] impact on `startDeepReport`/`runCreatorDeepPipeline` (expect LOW); remove; `bun run test && bun run lint && bunx tsc -b`; commit `refactor(reels): remove deep-report pipeline from useReelAnalysis`.

### Task 3.3: Remove deep state, snapshot, persist, domain, export, prompts, cache

**Files:**
- `src/store/reelAnalysisStore.ts` — remove `deepReport`, `deepReportStatus`, `setDeepReport`, `setDeepReportStatus`, `setDeepReel`, `deepStatus`/`deepAnalyses`, `StoredDeepReelAnalysis` import; bump `version` 3→4 + `migrate` strips the removed keys; update `merge`/`isCleanReelRun` references.
- `src/lib/reelSnapshot.ts` + `.test.ts` — drop `deepReport`/deep maps from `buildReelResultPayload`; persist `caseStudies`/`caseStudyStatus`/`hookSummary` instead (bounded text). Update `ReelResultPayload` in `src/domain/chat.ts`.
- `src/store/reelPersist.ts` + `.test.ts` — drop `deepReportStatus` from `isCleanReelRun`.
- `src/shared/utils/export.ts` + `export.deepReport.test.ts` — delete deep-report export; delete that test (or repoint to `CreatorHookSummary` if an export is still wanted — YAGNI: delete).
- Delete `src/ai/prompts/deepReelAnalysis.ts` (+ any `DeepReelAnalysis`/`DeepNicheReport` consumers — `reelAnalyzer.ts` deep fns: `analyzeReelDeep`, `buildDeepPlaybook`, `buildDeepReportTable`, `synthesizeDeepReport`) and `src/lib/deepReelCache.ts` (+ test).
- Update the agent golden-set (`agentLoop.eval.test.ts`) if it references deep-report.

- [ ] For each symbol: `impact(...)`, delete/adjust, lean on `tsc` to surface refs. After the deletions: `node .gitnexus/run.cjs analyze --force`. `bun run test && bun run build && bun run lint` green. `detect_changes`. Commit `refactor(reels): remove deep-report state/snapshot/export/prompts/cache`.

### Task 3.4: Final verification

- [ ] `grep -rn "deepReport\|DeepReelAnalysis\|DeepNicheReport\|startDeepReport\|deepReelCache" src` returns nothing (except intentionally-kept `/api/analyze-reel-video.ts`).
- [ ] `bun run test` (full), `bun run build`, `bun run lint` all green.
- [ ] `detect_changes({scope:"compare", base_ref:"main", repo:"contentos2"})` shows only expected symbols.
- [ ] Commit `chore(reels): finalize deep-report removal`.

---

## Self-Review

- **Spec coverage:** ✓ single-handle pipeline (1.3), per-reel HookMap + cache (1.2/1.3), replace quick cards (1.4), creator summary with chunking (2.1/2.2), inline + Report page (2.4/2.5), deep-report removal (3.x), multi-handle unchanged (1.3 branch), GitNexus discipline (each task). Frozen `kind:'reel'` preserved (3.3 keeps the discriminant; only inner shape changes via migrate).
- **Placeholders:** Task 2.2's test is a sketch (mock shape depends on `reelAnalyzer.test.ts`'s existing Gemini mock) — the implementer mirrors that file's established mock; all other steps carry concrete code.
- **Type consistency:** `ReelCaseStatus`, `CreatorHookSummary`, `ReelDigest`, `setReelCaseStudy`, `setHookSummary`, `analyzeReelHookmap`, `synthesizeCreatorHooks`, `buildReelDigest`/`planDigestChunks`/`digestText` used consistently across tasks.
