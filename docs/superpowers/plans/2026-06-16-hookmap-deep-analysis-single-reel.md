# Hookmap-strengthened deep analysis + single-reel-by-URL chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port hookmap's analytical rigor into ContentOS's deep-reel prompts, and add a chat-triggered "analyze ONE reel by URL" pipeline that returns a hookmap-style markdown case study plus the reel's transcript.

**Architecture:** Two independent workstreams. **Part A** is prompt-text only — strengthen `buildDeepReelPrompt` / `buildDeepReportPrompt` (client copy + server mirror) with anti-fabrication, `[m:ss]` citations, "because"-grounding, compound hooks, and a qualitative DM-funnel flag. No schema/data-flow change. **Part B** is a new pipeline following CLAUDE.md's "Adding a new pipeline" conventions: a `analyze_single_reel` agent tool → Apify single-reel scrape → a new serverless function that runs two Gemini calls (Files-API extraction of transcript+segments+video-mechanics, then a text-only markdown synthesis) → an IndexedDB-cached store → an inline `SingleReelResultMessage` rendering the case study + a collapsible transcript.

**Tech Stack:** React + TypeScript, Zustand (persist), TanStack Query, Vercel serverless (`@vercel/node`, ESM), Gemini REST (Files API + generateContent), Apify (proxied via `/api/apify`), `idb` (IndexedDB), `react-markdown` + `remark-gfm`, vitest. Package manager: **bun**.

**Conventions to respect:**
- Server functions (`api/`) are ESM and self-contained — NO imports from `../src` (won't resolve at runtime). `.js` extensions required on relative imports.
- Keys live server-side (`process.env`); never `VITE_`-prefix Gemini/Apify keys. Client passes `apifyKeys` to Apify helpers for signature compat only — the `/api/apify` proxy picks the real key.
- Every persisted Zustand store has `version` + `migrate`.
- Persisted payload `kind` discriminants are frozen once shipped.
- DESIGN.md governs all visuals: Instrument Serif (display), Outfit (body), DM Mono (metrics); bg `#1A1410`; accent `#E07B3A`; warm neutrals (no slate/indigo/Inter); AI-generated narrative may use violet `#A78BFA`.

**Verify after each task:** `bun run test` (relevant file), and for `api/` changes also `bun run typecheck:api`. Final task runs the full `bun run build`.

---

## File Map

**Part A (modify):**
- `src/ai/prompts/deepReelAnalysis.ts` — strengthen `buildDeepReelPrompt`, `buildDeepReportPrompt`; bump `DEEP_REEL_PROMPT_VERSION`.
- `api/_lib/deepReelPrompt.ts` — mirror the strengthened `buildDeepReelPrompt` (keep in sync).
- `src/ai/prompts/__tests__/deepReelAnalysis.test.ts` — new/append prompt-content assertions.

**Part B (create):**
- `src/lib/reelUrl.ts` — parse an Instagram reel URL → shortCode.
- `src/lib/actors.ts` — add `buildSingleReelInput(reelUrl)` (modify).
- `src/lib/singleReelClient.ts` — Apify single-reel scrape → metadata + downloaded-video URL.
- `api/_lib/singleReelPrompt.ts` — extraction schema + prompt, synthesis prompt builder, coercion.
- `api/_lib/geminiText.ts` — server-side text-only Gemini generate (returns markdown string).
- `api/analyze-single-reel.ts` — serverless fn (Clerk gate, SSRF guard, 2-stage Gemini).
- `src/lib/singleReelCache.ts` — IndexedDB cache by shortCode.
- `src/store/singleReelStore.ts` — persisted store (version 1, conversation-tagged).
- `src/hooks/useSingleReelAnalysis.ts` — orchestration hook.
- `src/components/SingleReelResultMessage.tsx` — render markdown case study + transcript.
- `src/components/markdown/CaseStudyMarkdown.tsx` — themed `react-markdown` wrapper.

**Part B (modify):**
- `src/tools/agentTools.ts` — add `analyze_single_reel` tool + routing line.
- `src/tools/types.ts` — add result `kind: 'single-reel'` (if a payload union lives here).
- `src/hooks/useAgentConversation.ts` — dispatch branch.
- `src/pages/ChatPage.tsx` — render the new result + a tool chip.
- `src/tools/registry.ts` — `PIPELINE_REGISTRY` entry.
- `src/store/conversationsStore.ts` — extend `ChatMessage.type` union with `'single-reel'`.
- `package.json` — add `react-markdown`, `remark-gfm`.
- `agentLoop.eval.test.ts` (existing path under `src/`) — golden routing case.

---

# PART A — Strengthen the deep-path prompts

## Task A1: Strengthen `buildDeepReelPrompt` (client copy)

**Files:**
- Modify: `src/ai/prompts/deepReelAnalysis.ts:19` (`DEEP_REEL_PROMPT_VERSION`) and `:171-198` (`buildDeepReelPrompt`)
- Test: `src/ai/prompts/__tests__/deepReelAnalysis.test.ts`

- [ ] **Step 1: Write the failing test**

Create or append to `src/ai/prompts/__tests__/deepReelAnalysis.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildDeepReelPrompt, buildDeepReportPrompt, DEEP_REEL_PROMPT_VERSION } from '../deepReelAnalysis'

describe('buildDeepReelPrompt (strengthened)', () => {
  const p = buildDeepReelPrompt('comment GUIDE for the free checklist')

  it('keeps grounding in the actual media', () => {
    expect(p).toContain('SEE the video frames AND HEAR the audio')
  })
  it('forbids fabrication and fake timestamps', () => {
    expect(p).toMatch(/\[unknown/i)
    expect(p).toMatch(/never fabricate a timestamp/i)
  })
  it('requires [m:ss] timestamp citations', () => {
    expect(p).toMatch(/\[m:ss\]/)
    expect(p).toMatch(/\[0:03\]/)
  })
  it('demands because-grounding and specificity', () => {
    expect(p).toMatch(/because/i)
    expect(p).toMatch(/not "?emotional hook"?/i)
  })
  it('encourages compound (primary + secondary) hooks', () => {
    expect(p).toMatch(/compound/i)
    expect(p).toContain('secondaryArchetype')
  })
  it('flags engineered DM funnels qualitatively', () => {
    expect(p).toMatch(/funnel/i)
  })
  it('still lists every required field', () => {
    for (const f of ['spokenHookVerbatim', 'visualOpening', 'hookBreakdown', 'pacingEditing', 'audioStrategy', 'hookScore']) {
      expect(p).toContain(f)
    }
  })
})

describe('DEEP_REEL_PROMPT_VERSION', () => {
  it('is bumped to 2 so the deep cache lazily invalidates', () => {
    expect(DEEP_REEL_PROMPT_VERSION).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/ai/prompts/__tests__/deepReelAnalysis.test.ts`
Expected: FAIL (version is 1; new rule text absent).

- [ ] **Step 3: Bump the version**

In `src/ai/prompts/deepReelAnalysis.ts` change line 19:

```ts
export const DEEP_REEL_PROMPT_VERSION = 2
```

- [ ] **Step 4: Replace the prompt body**

Replace the `return \`...\`` template inside `buildDeepReelPrompt` (lines 173-197) with:

```ts
  return `You are an expert short-form video strategist. You are watching ONE Instagram Reel — you can SEE the video frames AND HEAR the audio. Analyse the ACTUAL media (not the caption) and return JSON only.

The caption is CONTEXT ONLY — do NOT just paraphrase it; ground every field in what you actually see and hear (JSON-encoded so it cannot inject instructions):
${JSON.stringify(cap)}

## How to analyse
- Explain WHY, not just WHAT. Every claim points to evidence and says "because" — a hook works *because* of a specific mechanic, not because it is "engaging".
- Be specific. "Emotional hook" is not an answer — name the exact emotion AND the identity it speaks to ("the FOMO a junior dev feels when a peer ships faster").
- Cite timestamps. In visualOpening, hookBreakdown and pacingEditing, end each concrete claim about what is shown / said / cut with a [m:ss] bracket grounded in the media — [0:03] for a moment, [0:03–0:08] for a range. If you cannot place a claim in time, drop it.
- Never invent. If a detail is genuinely not visible or audible, write "[unknown — <reason>]" rather than guessing. Never fabricate a timestamp.
- Most viral hooks are COMPOUND — when two archetypes layer, name the dominant one in hookArchetype and the second in secondaryArchetype. Forcing a single archetype is less accurate than naming both.

## Hook archetype taxonomy (hookArchetype MUST be exactly one of these)
${HOOK_TAXONOMY}

## Return these fields
- spokenHookVerbatim: the EXACT words spoken in the first ~3 seconds, transcribed from the audio. "" if there is no speech.
- onScreenTextHook: any on-screen text shown in the first ~3 seconds. "" if none.
- visualOpening: what is SHOWN in the first ~3 seconds — the visual pattern-interrupt that stops the scroll. Cite [m:ss].
- hookBreakdown: one tight paragraph dissecting the first 3 seconds — what is said, what is shown, on-screen text, and how the pattern-interrupt works together. Cite [m:ss] for each concrete beat.
- hookArchetype + secondaryArchetype: from the taxonomy above (secondary optional, but name it when the hook is compound).
- pacingEditing: cut rhythm, speed, b-roll usage, format. Cite [m:ss] for notable cuts.
- audioStrategy: voiceover vs trending sound vs music, and the role audio plays.
- retentionMechanism: why a viewer keeps watching past the first 3 seconds.
- psychologyTrigger: the core psychological driver (FOMO, curiosity, identity, social proof, etc.) — named precisely. If the caption baits keyword-comments (e.g. "comment 'X' for the link"), note here that the engagement may be an ENGINEERED DM FUNNEL — a funnel metric, not organic virality.
- ctaType + ctaPlacement: the call-to-action and where/when it appears. Use "none" if absent.
- replicationTemplate: a reusable fill-in-the-blank template a creator could adapt for THIS hook.
- whatToReplicate: the single most repeatable winning element.
- whatToAvoid: the element a creator should NOT blindly copy.
- hookScore: integer 1-10 — how strong the hook is at stopping the scroll.

Return only valid JSON matching the schema. No commentary outside the JSON.`
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- src/ai/prompts/__tests__/deepReelAnalysis.test.ts`
Expected: PASS (the `buildDeepReelPrompt` describe block + version).

- [ ] **Step 6: Commit**

```bash
git add src/ai/prompts/deepReelAnalysis.ts src/ai/prompts/__tests__/deepReelAnalysis.test.ts
git commit -m "feat(prompts): strengthen deep-reel prompt with citations, anti-fabrication, compound hooks"
```

---

## Task A2: Strengthen `buildDeepReportPrompt`

**Files:**
- Modify: `src/ai/prompts/deepReelAnalysis.ts:237-250` (synthesis prompt text)
- Test: same test file (append)

- [ ] **Step 1: Write the failing test**

Append to `src/ai/prompts/__tests__/deepReelAnalysis.test.ts`:

```ts
describe('buildDeepReportPrompt (strengthened)', () => {
  const p = buildDeepReportPrompt([
    {
      handle: 'a', reelCount: 3,
      archetypeDistribution: [{ archetype: 'Demo-first', count: 2 }],
      dominantArchetype: 'Demo-first', avgHookScore: 7, medianViews: 1000,
      consistencyScore: 0.66, signatureTemplate: 'X in Y seconds',
      topExemplar: null,
    },
  ])
  it('demands evidence-grounded, no-fabrication synthesis', () => {
    expect(p).toMatch(/grounded/i)
    expect(p).toMatch(/do not invent|never invent|\[unknown/i)
  })
  it('still returns the six report fields', () => {
    for (const f of ['whoIsWinning', 'nicheFormula', 'gaps', 'replicate', 'avoid', 'test']) {
      expect(p).toContain(f)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/ai/prompts/__tests__/deepReelAnalysis.test.ts`
Expected: FAIL on the no-fabrication assertion.

- [ ] **Step 3: Tighten the prompt**

In `buildDeepReportPrompt`, replace the final instruction line `Be specific and grounded in the data above. Return only valid JSON matching the schema.` with:

```ts
Be specific and grounded strictly in the data above — every claim cites a creator's hook mix, scores or views. Do not invent creators, numbers, or trends not present in the playbooks; if the data is too thin for a field, say so plainly rather than fabricating. Return only valid JSON matching the schema.`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/ai/prompts/__tests__/deepReelAnalysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompts/deepReelAnalysis.ts src/ai/prompts/__tests__/deepReelAnalysis.test.ts
git commit -m "feat(prompts): ground deep-report synthesis in data, forbid fabrication"
```

---

## Task A3: Mirror the strengthened prompt into the server copy

**Files:**
- Modify: `api/_lib/deepReelPrompt.ts:81-108` (`buildDeepReelPrompt`)
- Test: `api/_lib/__tests__/deepReelPrompt.test.ts` (create)

The server file is a deliberate duplicate (client/server boundary). It must stay byte-aligned with A1's prompt body.

- [ ] **Step 1: Write the failing test**

Create `api/_lib/__tests__/deepReelPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildDeepReelPrompt } from '../deepReelPrompt'

describe('server buildDeepReelPrompt mirrors the client', () => {
  const p = buildDeepReelPrompt('comment GUIDE for the checklist')
  it('has the strengthened rules', () => {
    expect(p).toMatch(/\[m:ss\]/)
    expect(p).toMatch(/never fabricate a timestamp/i)
    expect(p).toMatch(/compound/i)
    expect(p).toMatch(/funnel/i)
    expect(p).toMatch(/because/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- api/_lib/__tests__/deepReelPrompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Mirror the prompt body**

In `api/_lib/deepReelPrompt.ts`, replace the `return \`...\`` body of `buildDeepReelPrompt` (lines 83-107) with the EXACT same template string written in Task A1 Step 4.

- [ ] **Step 4: Run test + api typecheck**

Run: `bun run test -- api/_lib/__tests__/deepReelPrompt.test.ts && bun run typecheck:api`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/deepReelPrompt.ts api/_lib/__tests__/deepReelPrompt.test.ts
git commit -m "feat(prompts): mirror strengthened deep-reel prompt into server copy"
```

---

# PART B — Single-reel analysis in chat

## Task B1: Reel-URL → shortCode parser

**Files:**
- Create: `src/lib/reelUrl.ts`
- Test: `src/lib/__tests__/reelUrl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/reelUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseReelUrl, isReelUrl } from '../reelUrl'

describe('parseReelUrl', () => {
  it('extracts the shortCode from a /reel/ URL', () => {
    expect(parseReelUrl('https://www.instagram.com/reel/CxYz123_-A/')).toEqual({
      shortCode: 'CxYz123_-A',
      canonicalUrl: 'https://www.instagram.com/reel/CxYz123_-A/',
    })
  })
  it('handles /reels/ and /p/ and query strings and no trailing slash', () => {
    expect(parseReelUrl('https://instagram.com/reels/ABC123?igsh=x')?.shortCode).toBe('ABC123')
    expect(parseReelUrl('http://www.instagram.com/p/ZZ_z9')?.shortCode).toBe('ZZ_z9')
  })
  it('returns null for non-reel URLs', () => {
    expect(parseReelUrl('https://instagram.com/garyvee')).toBeNull()
    expect(parseReelUrl('not a url')).toBeNull()
  })
  it('isReelUrl is a boolean convenience', () => {
    expect(isReelUrl('https://www.instagram.com/reel/abc/')).toBe(true)
    expect(isReelUrl('hello')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/__tests__/reelUrl.test.ts`
Expected: FAIL ("Cannot find module '../reelUrl'").

- [ ] **Step 3: Implement**

Create `src/lib/reelUrl.ts`:

```ts
/**
 * Parse an Instagram reel/post permalink into its shortCode + a canonical /reel/ URL.
 *
 * Accepts /reel/, /reels/, and /p/ paths (Instagram serves the same content under all
 * three). Tolerates missing scheme-host case, query strings, and a missing trailing
 * slash. Returns null when the input is not a recognisable IG post permalink.
 */
export interface ParsedReel {
  shortCode: string
  canonicalUrl: string
}

const PATH_RE = /\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/

export function parseReelUrl(input: string): ParsedReel | null {
  if (typeof input !== 'string') return null
  let host = ''
  let pathname = input
  try {
    const u = new URL(input)
    host = u.host
    pathname = u.pathname
  } catch {
    // Not a full URL — fall through and regex the raw string.
  }
  if (host && !/(^|\.)instagram\.com$/i.test(host)) return null
  const m = PATH_RE.exec(pathname)
  if (!m) return null
  const shortCode = m[1]
  return { shortCode, canonicalUrl: `https://www.instagram.com/reel/${shortCode}/` }
}

export function isReelUrl(input: string): boolean {
  return parseReelUrl(input) !== null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/lib/__tests__/reelUrl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reelUrl.ts src/lib/__tests__/reelUrl.test.ts
git commit -m "feat(reel): add Instagram reel-URL → shortCode parser"
```

---

## Task B2: `buildSingleReelInput` Apify actor input

**Files:**
- Modify: `src/lib/actors.ts` (append after `buildReelVideoScraperInput`)
- Test: `src/lib/__tests__/actors.singleReel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/actors.singleReel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSingleReelInput } from '../actors'

describe('buildSingleReelInput', () => {
  it('passes the direct reel URL and requests the downloaded video', () => {
    const input = buildSingleReelInput('https://www.instagram.com/reel/ABC/')
    expect(input).toEqual({
      username: ['https://www.instagram.com/reel/ABC/'],
      includeDownloadedVideo: true,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/__tests__/actors.singleReel.test.ts`
Expected: FAIL ("buildSingleReelInput is not a function").

- [ ] **Step 3: Implement**

Append to `src/lib/actors.ts`:

```ts
/**
 * Build the input for analyzing ONE reel by direct URL (apify~instagram-reel-scraper).
 *
 * Same actor as buildReelVideoScraperInput but for a single permalink — returns the
 * reel's metadata AND a stable api.apify.com downloaded-video URL (includeDownloadedVideo).
 */
export function buildSingleReelInput(reelUrl: string): Record<string, unknown> {
  return {
    username: [reelUrl],
    includeDownloadedVideo: true,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/lib/__tests__/actors.singleReel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actors.ts src/lib/__tests__/actors.singleReel.test.ts
git commit -m "feat(reel): add single-reel Apify actor input builder"
```

---

## Task B3: `singleReelClient` — scrape one reel

**Files:**
- Create: `src/lib/singleReelClient.ts`
- Test: `src/lib/__tests__/singleReelClient.test.ts`

The pure mapper `extractSingleReel` is the unit under test; `scrapeSingleReel` wires it to `apifyCore` (integration-tested manually).

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/singleReelClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractSingleReel } from '../singleReelClient'

describe('extractSingleReel', () => {
  it('maps a raw reel-scraper item to ScrapedReel', () => {
    const raw = [{
      shortCode: 'ABC', url: 'https://www.instagram.com/reel/ABC/',
      downloadedVideo: 'https://api.apify.com/v2/key-value-stores/x/records/ABC.mp4',
      caption: 'hi', likesCount: 100, commentsCount: 6, videoViewCount: 5000,
      videoDuration: 22, hashtags: ['a'], ownerUsername: 'garyvee', displayUrl: 'https://x/t.jpg',
      timestamp: '2026-06-01T00:00:00.000Z', musicInfo: { artist_name: 'x' },
    }]
    expect(extractSingleReel(raw)).toEqual({
      shortCode: 'ABC',
      url: 'https://www.instagram.com/reel/ABC/',
      downloadedVideoUrl: 'https://api.apify.com/v2/key-value-stores/x/records/ABC.mp4',
      ownerUsername: 'garyvee',
      caption: 'hi', likesCount: 100, commentsCount: 6, videoViewCount: 5000,
      videoDuration: 22, hashtags: ['a'], displayUrl: 'https://x/t.jpg',
      timestamp: '2026-06-01T00:00:00.000Z', musicInfo: { artist_name: 'x' },
    })
  })
  it('returns null when the item has no downloadable video', () => {
    expect(extractSingleReel([{ shortCode: 'ABC', error: 'blocked' }])).toBeNull()
    expect(extractSingleReel([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/__tests__/singleReelClient.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/lib/singleReelClient.ts`:

```ts
/**
 * Single-reel scraper — given ONE direct reel URL, returns its metadata plus a stable
 * api.apify.com downloaded-video URL (apify~instagram-reel-scraper + includeDownloadedVideo).
 *
 * Mirrors reelVideoClient/reelScraper: routes through apifyCore (/api/apify proxy picks the
 * key), serialized on the shared apifyRunLimiter. Throws ApifyError on a fully-blocked run.
 */

import { startRun, pollRun, fetchDataset, ApifyError, apifyRunLimiter, withKeyFailover } from './apifyCore'
import { ACTORS, buildSingleReelInput } from './actors'

const SINGLE_REEL_POLL_MS = 180_000

interface RawSingleReel {
  shortCode?: string
  url?: string
  downloadedVideo?: string
  ownerUsername?: string
  caption?: string | null
  likesCount?: number
  commentsCount?: number
  videoViewCount?: number
  videoDuration?: number
  hashtags?: string[]
  displayUrl?: string
  timestamp?: string
  musicInfo?: unknown
  error?: string
  requestErrorMessages?: unknown
}

export interface ScrapedReel {
  shortCode: string
  url: string
  downloadedVideoUrl: string
  ownerUsername: string
  caption: string
  likesCount: number
  commentsCount: number
  videoViewCount: number
  videoDuration: number
  hashtags: string[]
  displayUrl: string
  timestamp: string
  musicInfo?: unknown
}

/** Pure: map raw reel-scraper items → the first usable ScrapedReel, or null. Exported for tests. */
export function extractSingleReel(rawItems: unknown[]): ScrapedReel | null {
  const items = rawItems as RawSingleReel[]
  const it = items.find(
    (x) => x && !x.error && !x.requestErrorMessages && typeof x.downloadedVideo === 'string' && x.downloadedVideo.length > 0,
  )
  if (!it || !it.shortCode || !it.downloadedVideo) return null
  return {
    shortCode: it.shortCode,
    url: it.url ?? `https://www.instagram.com/reel/${it.shortCode}/`,
    downloadedVideoUrl: it.downloadedVideo,
    ownerUsername: it.ownerUsername ?? '',
    caption: it.caption ?? '',
    likesCount: it.likesCount ?? 0,
    commentsCount: it.commentsCount ?? 0,
    videoViewCount: it.videoViewCount ?? 0,
    videoDuration: it.videoDuration ?? 0,
    hashtags: it.hashtags ?? [],
    displayUrl: it.displayUrl ?? '',
    timestamp: it.timestamp ?? '',
    musicInfo: it.musicInfo,
  }
}

/** Scrape one reel by direct URL. Throws ApifyError if no video could be downloaded. */
export async function scrapeSingleReel(
  reelUrl: string,
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<ScrapedReel> {
  return apifyRunLimiter(async () => {
    const input = buildSingleReelInput(reelUrl)
    const rawItems = await withKeyFailover(apifyKeys, async (apiKey) => {
      const { runId, datasetId, keyIndex } = await startRun(ACTORS.REEL_VIDEO_SCRAPER, input, apiKey, signal)
      await pollRun(runId, apiKey, signal, SINGLE_REEL_POLL_MS, keyIndex)
      return fetchDataset<RawSingleReel>(datasetId, apiKey, signal, keyIndex)
    })
    const reel = extractSingleReel(rawItems)
    if (!reel) throw new ApifyError('No downloadable video for that reel (private, deleted, or blocked)')
    return reel
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/lib/__tests__/singleReelClient.test.ts`
Expected: PASS.

> Note: verify `ApifyError`'s constructor signature in `src/lib/apifyCore.ts`. If it requires a code argument (e.g. `new ApifyError('RATE_LIMITED', msg)`), match that signature here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/singleReelClient.ts src/lib/__tests__/singleReelClient.test.ts
git commit -m "feat(reel): add single-reel Apify scrape client"
```

---

## Task B4: Server-side single-reel prompts + schema + coercion

**Files:**
- Create: `api/_lib/singleReelPrompt.ts`
- Test: `api/_lib/__tests__/singleReelPrompt.test.ts`

Stage-1 extraction produces structured JSON (transcript + segments + video mechanics). Stage-2 synthesis is the hookmap markdown prompt (v1: no comments/benchmark sections).

- [ ] **Step 1: Write the failing test**

Create `api/_lib/__tests__/singleReelPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  SINGLE_REEL_EXTRACTION_SCHEMA,
  buildExtractionPrompt,
  buildSynthesisPrompt,
  coerceExtraction,
} from '../singleReelPrompt'

describe('extraction prompt + schema', () => {
  it('asks for a verbatim transcript with timestamped segments', () => {
    const p = buildExtractionPrompt()
    expect(p).toMatch(/transcribe/i)
    expect(p).toMatch(/segments/)
    expect(p).toMatch(/visual_beats/)
    expect(p).toMatch(/never invent/i)
  })
  it('schema requires transcript, segments, videoAnalysis', () => {
    expect(SINGLE_REEL_EXTRACTION_SCHEMA.required).toEqual(
      expect.arrayContaining(['transcript', 'segments', 'videoAnalysis']),
    )
  })
})

describe('coerceExtraction', () => {
  it('fills defaults and coerces segment shapes', () => {
    const out = coerceExtraction({
      transcript: 'hello world',
      segments: [{ start: 0.4, text: 'hello' }, { start: 'bad', text: 'world' }],
      videoAnalysis: { cuts_count: 3, t0_frame: 'a face' },
    })
    expect(out.transcript).toBe('hello world')
    expect(out.segments[0]).toEqual({ start: 0.4, text: 'hello' })
    expect(out.segments[1].start).toBe(0) // non-finite → 0
  })
  it('survives a totally malformed payload', () => {
    const out = coerceExtraction(null)
    expect(out.transcript).toBe('')
    expect(out.segments).toEqual([])
    expect(out.videoAnalysis).toBeTypeOf('object')
  })
})

describe('synthesis prompt', () => {
  it('mandates [m:ss] citations, anti-fabrication, and the markdown sections', () => {
    const p = buildSynthesisPrompt()
    expect(p).toMatch(/\[m:ss\]/)
    expect(p).toMatch(/never fabricate a timestamp/i)
    expect(p).toMatch(/## Hook/)
    expect(p).toMatch(/## Psychology/)
    expect(p).toMatch(/## Topic/)
    expect(p).toMatch(/Pure markdown/i)
  })
  it('does NOT request comments or creator-benchmark sections in v1', () => {
    const p = buildSynthesisPrompt()
    expect(p).not.toMatch(/creator_benchmark/)
    expect(p).not.toMatch(/What viewers actually said/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- api/_lib/__tests__/singleReelPrompt.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `api/_lib/singleReelPrompt.ts`:

```ts
/**
 * Single-reel deep analysis prompts (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Two stages, both Gemini:
 *   1) Extraction (Files API, multimodal): transcript + timestamped segments + video mechanics.
 *   2) Synthesis (text-only): a hookmap-style markdown case study grounded in stage 1 + Apify.
 *
 * Ported/adapted from github.com/Adityaraj0421/hookmap (process-reel synthesis + video-analysis
 * prompts), with Whisper replaced by Gemini-native transcription. v1 omits the comments &
 * creator-benchmark sections (the prompt is written so they simply do not appear).
 */

/** Bump when extraction/synthesis prompts change so singleReelCache lazily invalidates. */
export const SINGLE_REEL_PROMPT_VERSION = 1

// ----- Stage 1: extraction -----

export interface ReelSegment {
  start: number // seconds
  text: string
}

export interface ReelVideoAnalysis {
  duration_s: number | null
  aspect_ratio: string
  dominant_framing: string
  cuts_count: number | null
  text_overlay_density: string
  captions_present: boolean | null
  trending_audio_hint: string
  t0_frame: string
  visual_beats: Array<{ t_start: number | null; t_end: number | null; on_screen: string; function: string }>
  notable_moments: string[]
}

export interface ReelExtraction {
  transcript: string
  segments: ReelSegment[]
  videoAnalysis: ReelVideoAnalysis
}

export const SINGLE_REEL_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    transcript: { type: 'string' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { start: { type: 'number' }, text: { type: 'string' } },
        required: ['start', 'text'],
      },
    },
    videoAnalysis: {
      type: 'object',
      properties: {
        duration_s: { type: 'number' },
        aspect_ratio: { type: 'string' },
        dominant_framing: { type: 'string' },
        cuts_count: { type: 'integer' },
        text_overlay_density: { type: 'string' },
        captions_present: { type: 'boolean' },
        trending_audio_hint: { type: 'string' },
        t0_frame: { type: 'string' },
        visual_beats: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              t_start: { type: 'number' },
              t_end: { type: 'number' },
              on_screen: { type: 'string' },
              function: { type: 'string' },
            },
            required: ['on_screen', 'function'],
          },
        },
        notable_moments: { type: 'array', items: { type: 'string' } },
      },
      required: ['t0_frame', 'visual_beats'],
    },
  },
  required: ['transcript', 'segments', 'videoAnalysis'],
} as const

export function buildExtractionPrompt(): string {
  return `You are a viral-reel forensics extractor. You can SEE the video frames AND HEAR the audio of ONE Instagram reel. Return ONLY JSON matching the schema — no prose, no code fences.

Extract three things:

1. transcript — the FULL spoken audio, transcribed VERBATIM. "" if there is no speech.
2. segments — the transcript split into short timestamped chunks: [{ "start": <seconds, number>, "text": "<words in that chunk>" }]. Keep chunks to roughly one sentence. start is the second the chunk begins. [] if there is no speech.
3. videoAnalysis — the MECHANICS (not a content summary):
   - duration_s, aspect_ratio ("9:16"/"1:1"/"4:5"/"other"), dominant_framing ("selfie"/"talking-head"/"locked-off-wide"/"pov"/"screen-capture"/"split-screen"/"other")
   - cuts_count, text_overlay_density ("none"/"low"/"medium"/"high"), captions_present (boolean), trending_audio_hint ("likely"/"unlikely"/"unknown")
   - t0_frame — one sentence on exactly what is on screen at t=0
   - visual_beats — narrative units: [{ "t_start": <s>, "t_end": <s>, "on_screen": "subject + motion + text overlay", "function": "short label e.g. 'state stakes'" }]. A beat may span multiple cuts.
   - notable_moments — any jump cut / punchline / visual shock, each with its timestamp.

Never invent values. Use null where a number is genuinely unknown. Transcribe only what is actually said — do not paraphrase or summarise the audio.`
}

// ----- Stage 2: synthesis (markdown) -----

const HOOK_ARCHETYPES_TEXT = `- **Curiosity gap** — Names a surprising outcome without revealing the cause. Example: "This $5 tool replaced my $2,000 one"
- **Contrarian claim** — States a belief that contradicts audience consensus. Example: "Stop using X. Here's why."
- **Sunk-cost / identity threat** — Attacks something the viewer has already invested in. Example: "3 years of React. All replaced by this."
- **Visual shock** — Opens on an image the viewer must resolve. Example: Dropping an expensive item
- **Direct callout** — Names the target viewer in frame-one. Example: "If you're a 20-something engineer, watch this"
- **Demo-first** — Shows the end result before explaining. Example: "This is what X looks like now"
- **Story cold-open** — Drops into mid-scene of a narrative. Example: "So I just got fired and..."
- **Question bait** — Asks a question the viewer can't not answer internally. Example: "Why do {thing} always {annoyance}?"
- **Authority / bandwagon FOMO** — Positions the subject as widely validated. Example: "This is the #1 app worldwide right now"`

export function buildSynthesisPrompt(): string {
  return `You are a senior Instagram strategist. You are reading ONE reel and explaining to another working creator why it worked — in the voice a strategist uses over coffee, not a forensics analyst writing a lab report. Every claim points to evidence: a transcript line, a visual beat, or an engagement signal. No jargon theatre. No filler.

## Inputs (user message JSON)
1. Apify data — engagement metrics, caption, hashtags, creator, music info.
2. Gemini transcript + timestamped segments.
3. Gemini video analysis — beats, cuts, framing, on-screen text.

## Rules
- Be specific. "Emotional hook" is not an answer. Name the exact emotion, the exact identity, the exact action.
- Quote when you cite. If you reference a hook line, quote it verbatim.
- Cite with timestamps — MANDATORY. Every claim about what's on screen, a cut, motion, framing change, text overlay, OR a specific quoted line MUST end with a [m:ss] bracket.
  - Visual claims cite from video_analysis.visual_beats[] or t0_frame.
  - Spoken-line claims cite the matching transcript segment start (seconds → m:ss). Example: "My heart is out of control" [0:02].
  - Use [0:03] for a moment, [0:03–0:08] for a range. Round to the nearest second. No citation = drop the claim.
- No invented details. If video_analysis has no beat for a claim, drop it or mark "[unknown]". Never fabricate a timestamp.
- If the caption asks viewers to comment a keyword AND comments are > 5% of likes, flag it in Psychology as an engineered DM funnel (normal organic ratio is 1–5%).

## Hook archetypes (for reference, not required to cite)
${HOOK_ARCHETYPES_TEXT}

## Output
Pure markdown. No preamble, no code-fence around the whole thing. Follow this structure EXACTLY. Sections separated by horizontal rules (---). Each bold-label line stays on its own line.

# @{handle}

> **{5–7 word one-line takeaway for this reel}**

| Posted | Duration | Views | Likes | Comments |
|---|---|---|---|---|
| {YYYY-MM-DD} | {duration}s | {views} | {likes} | {comments}{append " ⚠" only if engineered DM funnel detected} |

[{reel_url}]({reel_url})

---

## Hook

> "{exact first sentence of the transcript}"

**Power words**
- **"{phrase 1}"** — one clause on why this phrase stops the scroll for this audience
- **"{phrase 2}"** — one clause

(List 1–3 phrases. Don't pad.)

**Why it works** — 2–3 sentences naming the specific mechanic. The second sentence MUST describe what's on screen in the first beat and cite a timestamp, e.g. "At [0:00], confetti fills the frame, pre-loading the 'big news' valence before the audio lands." If no usable visual_beat exists, omit that sentence rather than fake it.

---

## Topic

**Surface** — the literal subject.

**Real** — what it's actually about beyond the literal.

**Who leans in** — the identity this reel speaks TO. Concrete, not "creators".

**Timing** — why it resonates right now. 1–2 sentences.

---

## Keywords

**Caption positioning** — 2–3 sentences on what the word choice signals about positioning and audience.

| Hashtag type | Tags |
|---|---|
| Reach (broad, high-volume) | {list or "none used"} |
| Intent (niche-specific) | {list or "none used"} |
| Branded / creator | {list or "none used"} |

**Search play** — what phrase is this creator trying to rank for in Instagram search? If none visible, say so in one sentence.

---

## Psychology

**Emotion** — name it precisely.

**Identity** — "This is for people who ___." One sentence.

**Primary action** — save / share / comment / DM funnel / follow. Pick one and explain the specific mechanic.

**Secondary action** — only if clearly present. Otherwise omit this line.

{Only if comments > 5% of likes AND the caption has a keyword CTA, append this blockquote; otherwise omit entirely:}

> ⚠ **Engineered DM funnel** — the comment count is a funnel metric, not organic virality. {One sentence on the mechanism.}

---

## 3 hook ideas for your niche

1. **"{hook line 1}"**
   *Mechanic:* {archetype reused from this reel}

2. **"{hook line 2}"**
   *Mechanic:* {archetype}

3. **"{hook line 3}"**
   *Mechanic:* {archetype}

---

*Caption (verbatim):*

> {caption}`
}

// ----- Coercion (guard the extraction output) -----

export function coerceExtraction(raw: unknown): ReelExtraction {
  const o = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const numOrNull = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null)
  const str = (v: unknown, f = ''): string => (typeof v === 'string' ? v : f)

  const rawSegs = Array.isArray(o.segments) ? (o.segments as unknown[]) : []
  const segments: ReelSegment[] = rawSegs.map((s) => {
    const seg = (s ?? {}) as Record<string, unknown>
    return { start: num(seg.start), text: str(seg.text) }
  })

  const va = (o.videoAnalysis ?? {}) as Record<string, unknown>
  const rawBeats = Array.isArray(va.visual_beats) ? (va.visual_beats as unknown[]) : []
  const videoAnalysis: ReelVideoAnalysis = {
    duration_s: numOrNull(va.duration_s),
    aspect_ratio: str(va.aspect_ratio, 'other'),
    dominant_framing: str(va.dominant_framing, 'other'),
    cuts_count: numOrNull(va.cuts_count),
    text_overlay_density: str(va.text_overlay_density, 'none'),
    captions_present: typeof va.captions_present === 'boolean' ? va.captions_present : null,
    trending_audio_hint: str(va.trending_audio_hint, 'unknown'),
    t0_frame: str(va.t0_frame),
    visual_beats: rawBeats.map((b) => {
      const beat = (b ?? {}) as Record<string, unknown>
      return {
        t_start: numOrNull(beat.t_start),
        t_end: numOrNull(beat.t_end),
        on_screen: str(beat.on_screen),
        function: str(beat.function),
      }
    }),
    notable_moments: Array.isArray(va.notable_moments) ? (va.notable_moments as unknown[]).map((x) => str(x)) : [],
  }

  return { transcript: str(o.transcript), segments, videoAnalysis }
}
```

- [ ] **Step 4: Run test + api typecheck**

Run: `bun run test -- api/_lib/__tests__/singleReelPrompt.test.ts && bun run typecheck:api`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/singleReelPrompt.ts api/_lib/__tests__/singleReelPrompt.test.ts
git commit -m "feat(reel): add single-reel extraction + markdown synthesis prompts (ported from hookmap)"
```

---

## Task B5: Server-side text-only Gemini generate

**Files:**
- Create: `api/_lib/geminiText.ts`
- Test: `api/_lib/__tests__/geminiText.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/_lib/__tests__/geminiText.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { geminiGenerateMarkdown, GeminiTextError } from '../geminiText'

afterEach(() => vi.restoreAllMocks())

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, status, text: async () => JSON.stringify(body),
  } as Response)
}

describe('geminiGenerateMarkdown', () => {
  it('returns the model text', async () => {
    mockFetchOnce({ candidates: [{ content: { parts: [{ text: '# Hello' }] } }] })
    const md = await geminiGenerateMarkdown({ systemPrompt: 'sys', userPayload: '{}', apiKey: 'k' })
    expect(md).toBe('# Hello')
  })
  it('throws GeminiTextError on a non-ok response', async () => {
    mockFetchOnce({}, false, 503)
    await expect(geminiGenerateMarkdown({ systemPrompt: 's', userPayload: '{}', apiKey: 'k' }))
      .rejects.toBeInstanceOf(GeminiTextError)
  })
  it('throws when the model returns empty content', async () => {
    mockFetchOnce({ candidates: [{ content: { parts: [{ text: '' }] } }] })
    await expect(geminiGenerateMarkdown({ systemPrompt: 's', userPayload: '{}', apiKey: 'k' }))
      .rejects.toBeInstanceOf(GeminiTextError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- api/_lib/__tests__/geminiText.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `api/_lib/geminiText.ts`:

```ts
/**
 * Server-side text-only Gemini generateContent (SERVER-SIDE, ESM, self-contained).
 *
 * Used by the single-reel synthesis stage: no video, just a systemInstruction + a JSON
 * user payload → a markdown case study string. Distinct from geminiFiles.ts (multimodal,
 * responseSchema/JSON). Never leaks the API key in error messages.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const DEFAULT_MODEL = 'gemini-2.5-flash'

export class GeminiTextError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GeminiTextError'
    this.status = status
  }
}

export interface GenerateMarkdownArgs {
  systemPrompt: string
  userPayload: string
  apiKey: string
  model?: string
  temperature?: number
}

export async function geminiGenerateMarkdown(args: GenerateMarkdownArgs): Promise<string> {
  const { systemPrompt, userPayload, apiKey } = args
  const model = args.model ?? DEFAULT_MODEL
  const temperature = args.temperature ?? 0.4

  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPayload }] }],
      generationConfig: { temperature },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new GeminiTextError(`generateContent failed (${res.status})`, res.status)

  const parsed = JSON.parse(text) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const out = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!out.trim()) throw new GeminiTextError('generateContent returned empty markdown', 502)
  return out
}
```

- [ ] **Step 4: Run test + api typecheck**

Run: `bun run test -- api/_lib/__tests__/geminiText.test.ts && bun run typecheck:api`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/geminiText.ts api/_lib/__tests__/geminiText.test.ts
git commit -m "feat(reel): add server-side text-only Gemini markdown generate"
```

---

## Task B6: `api/analyze-single-reel.ts` serverless function

**Files:**
- Create: `api/analyze-single-reel.ts`
- Test: `api/__tests__/analyze-single-reel.test.ts`

Mirrors `api/analyze-reel-video.ts`: pure core (`analyzeSingleReel`) + thin handler. Core does Stage 1 (Files API extraction) → Stage 2 (text synthesis) and returns `{ transcript, segments, videoAnalysis, markdown }`.

- [ ] **Step 1: Write the failing test**

Create `api/__tests__/analyze-single-reel.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { analyzeSingleReel, HandlerError } from '../analyze-single-reel'
import * as files from '../_lib/geminiFiles'
import * as text from '../_lib/geminiText'

afterEach(() => vi.restoreAllMocks())

const VIDEO_URL = 'https://api.apify.com/v2/key-value-stores/x/records/ABC.mp4'

function mockVideoFetch() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': 'video/mp4' }),
    arrayBuffer: async () => new ArrayBuffer(1024),
  } as unknown as Response)
}

describe('analyzeSingleReel', () => {
  it('rejects a non-allowlisted host', async () => {
    await expect(
      analyzeSingleReel({ downloadedVideoUrl: 'https://evil.com/a.mp4', shortCode: 'ABC', apify: {} }, 'k'),
    ).rejects.toBeInstanceOf(HandlerError)
  })

  it('runs extraction → synthesis and returns the combined result', async () => {
    mockVideoFetch()
    vi.spyOn(files, 'analyzeVideoWithGemini').mockResolvedValue({
      data: {
        transcript: 'hello world', segments: [{ start: 0, text: 'hello world' }],
        videoAnalysis: { t0_frame: 'a face', visual_beats: [] },
      },
      usage: null,
    })
    vi.spyOn(text, 'geminiGenerateMarkdown').mockResolvedValue('# @garyvee\n\ngreat reel')

    const out = await analyzeSingleReel(
      { downloadedVideoUrl: VIDEO_URL, shortCode: 'ABC', apify: { ownerUsername: 'garyvee', caption: 'hi', likesCount: 100, commentsCount: 2 } },
      'k',
    )
    expect(out.transcript).toBe('hello world')
    expect(out.segments).toEqual([{ start: 0, text: 'hello world' }])
    expect(out.markdown).toContain('@garyvee')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- api/__tests__/analyze-single-reel.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `api/analyze-single-reel.ts`:

```ts
/**
 * POST /api/analyze-single-reel — Vercel serverless (Node / Fluid Compute).
 *
 * Deep case-study analysis of ONE reel. The client scrapes the reel (Apify, client-side)
 * and posts the stable api.apify.com video URL + the reel's Apify metadata. This function:
 *   gate(Clerk JWT) → SSRF-allowlist the video host → fetch bytes →
 *   Stage 1 (Gemini Files API): transcript + timestamped segments + video mechanics →
 *   Stage 2 (Gemini text-only): a hookmap-style markdown case study →
 *   { transcript, segments, videoAnalysis, markdown }.
 *
 * Self-contained ESM (no ../src imports). Gate FAILS CLOSED. Same SSRF allowlist + size
 * cap as analyze-reel-video.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { analyzeVideoWithGemini, GeminiFilesError } from './_lib/geminiFiles.js'
import { geminiGenerateMarkdown, GeminiTextError } from './_lib/geminiText.js'
import {
  SINGLE_REEL_EXTRACTION_SCHEMA,
  buildExtractionPrompt,
  buildSynthesisPrompt,
  coerceExtraction,
  type ReelExtraction,
} from './_lib/singleReelPrompt.js'
import { requireClerkUser } from './_lib/auth.js'

export const config = { maxDuration: 180 }

const ALLOWED_HOSTS = new Set(['api.apify.com'])
const MAX_VIDEO_BYTES = 50 * 1024 * 1024

/** ONE Gemini key from the pool (see analyze-reel-video.ts:pickGeminiKey). */
export function pickGeminiKey(): string {
  const keys = [
    ...String(process.env.GEMINI_API_KEY ?? '').split(','),
    ...String(process.env.GEMINI_KEYS ?? '').split(','),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
  return keys[Math.floor(Math.random() * keys.length)] ?? ''
}

export interface SingleReelApifyMeta {
  ownerUsername?: string
  caption?: string
  likesCount?: number
  commentsCount?: number
  videoViewCount?: number
  videoDuration?: number
  hashtags?: string[]
  timestamp?: string
  musicInfo?: unknown
}

export interface AnalyzeSingleReelInput {
  downloadedVideoUrl: string
  shortCode: string
  apify: SingleReelApifyMeta
}

export interface SingleReelResult extends ReelExtraction {
  markdown: string
}

export class HandlerError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function analyzeSingleReel(input: AnalyzeSingleReelInput, geminiApiKey: string): Promise<SingleReelResult> {
  const { downloadedVideoUrl, apify } = input

  let host: string
  try {
    host = new URL(downloadedVideoUrl).host
  } catch {
    throw new HandlerError('Invalid downloadedVideoUrl', 400)
  }
  if (!ALLOWED_HOSTS.has(host)) throw new HandlerError(`Host not allowed: ${host}`, 400)

  const res = await fetch(downloadedVideoUrl, { redirect: 'manual' })
  if (!res.ok) throw new HandlerError(`Video fetch failed (${res.status})`, 502)
  const contentType = (res.headers.get('content-type') || '').split(';')[0] || 'video/mp4'
  if (!/^(video\/|application\/octet-stream)/i.test(contentType)) {
    throw new HandlerError(`Unexpected content-type: ${contentType}`, 422)
  }
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) throw new HandlerError('Empty video body', 502)
  if (buf.byteLength > MAX_VIDEO_BYTES) throw new HandlerError('Video too large', 413)

  // Stage 1: extraction (multimodal).
  const { data } = await analyzeVideoWithGemini({
    bytes: buf,
    mimeType: contentType.startsWith('video/') ? contentType : 'video/mp4',
    apiKey: geminiApiKey,
    prompt: buildExtractionPrompt(),
    schema: SINGLE_REEL_EXTRACTION_SCHEMA,
  })
  const extraction = coerceExtraction(data)

  // Stage 2: synthesis (text-only markdown).
  const userPayload = JSON.stringify(
    {
      reel_url: `https://www.instagram.com/reel/${input.shortCode}/`,
      handle: apify.ownerUsername ?? '',
      apify: {
        caption: apify.caption ?? '',
        likesCount: apify.likesCount ?? 0,
        commentsCount: apify.commentsCount ?? 0,
        videoViewCount: apify.videoViewCount ?? 0,
        videoDuration: apify.videoDuration ?? 0,
        hashtags: apify.hashtags ?? [],
        timestamp: apify.timestamp ?? '',
        musicInfo: apify.musicInfo ?? null,
      },
      transcript: extraction.transcript,
      transcript_segments: extraction.segments,
      video_analysis: extraction.videoAnalysis,
    },
    null,
    2,
  )
  const markdown = await geminiGenerateMarkdown({
    systemPrompt: buildSynthesisPrompt(),
    userPayload,
    apiKey: geminiApiKey,
  })

  return { ...extraction, markdown }
}

function parseBody(raw: unknown): Partial<AnalyzeSingleReelInput> {
  if (raw && typeof raw === 'object') return raw as Partial<AnalyzeSingleReelInput>
  if (typeof raw === 'string' && raw.length > 0) return JSON.parse(raw) as Partial<AnalyzeSingleReelInput>
  return {}
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const user = await requireClerkUser(req, res)
  if (!user) return

  const geminiApiKey = pickGeminiKey()
  if (!geminiApiKey) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  let input: AnalyzeSingleReelInput
  try {
    const body = parseBody(req.body)
    if (!body.downloadedVideoUrl || !body.shortCode) {
      res.status(400).json({ error: 'downloadedVideoUrl and shortCode are required' })
      return
    }
    input = { downloadedVideoUrl: body.downloadedVideoUrl, shortCode: body.shortCode, apify: body.apify ?? {} }
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  try {
    const result = await analyzeSingleReel(input, geminiApiKey)
    res.status(200).json({ shortCode: input.shortCode, result })
  } catch (err) {
    const known = err instanceof HandlerError || err instanceof GeminiFilesError || err instanceof GeminiTextError
    res.status(known ? (err as { status: number }).status : 500).json({
      error: known ? (err as Error).message : 'Analysis failed',
    })
  }
}
```

- [ ] **Step 4: Run test + api typecheck**

Run: `bun run test -- api/__tests__/analyze-single-reel.test.ts && bun run typecheck:api`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add api/analyze-single-reel.ts api/__tests__/analyze-single-reel.test.ts
git commit -m "feat(reel): add analyze-single-reel serverless function (2-stage Gemini)"
```

---

## Task B7: Single-reel store

**Files:**
- Create: `src/store/singleReelStore.ts`
- Test: `src/store/__tests__/singleReelStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/singleReelStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useSingleReelStore } from '../singleReelStore'

describe('singleReelStore', () => {
  beforeEach(() => useSingleReelStore.getState().reset())

  it('tracks a run lifecycle', () => {
    const s = useSingleReelStore.getState()
    s.startRun('ABC', 'https://www.instagram.com/reel/ABC/', 'conv-1')
    expect(useSingleReelStore.getState().status).toBe('running')
    expect(useSingleReelStore.getState().shortCode).toBe('ABC')
    expect(useSingleReelStore.getState().conversationId).toBe('conv-1')

    s.setResult({ transcript: 't', segments: [], videoAnalysis: {} as never, markdown: '# hi' })
    expect(useSingleReelStore.getState().status).toBe('done')
    expect(useSingleReelStore.getState().result?.markdown).toBe('# hi')
  })

  it('records errors', () => {
    useSingleReelStore.getState().setError('nope')
    expect(useSingleReelStore.getState().status).toBe('failed')
    expect(useSingleReelStore.getState().error).toBe('nope')
  })

  it('reset clears everything', () => {
    useSingleReelStore.getState().setError('x')
    useSingleReelStore.getState().reset()
    expect(useSingleReelStore.getState().status).toBe('idle')
    expect(useSingleReelStore.getState().result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/store/__tests__/singleReelStore.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/store/singleReelStore.ts`:

```ts
/**
 * Single-reel analysis store — one reel at a time, tagged to the conversation that
 * triggered it (so its result renders in the right chat). Persisted so a finished case
 * study survives reload; an interrupted mid-run is dropped on restore.
 *
 * Mirrors reelAnalysisStore's persist conventions (version + migrate + supabaseStorage).
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabaseStorage } from './supabaseStorage'
import type { ReelExtraction } from '../../api/_lib/singleReelPrompt'

export type SingleReelStatus = 'idle' | 'running' | 'done' | 'failed'

/** The serverless result: extraction (transcript/segments/videoAnalysis) + markdown case study. */
export interface SingleReelResult extends ReelExtraction {
  markdown: string
}

interface SingleReelState {
  status: SingleReelStatus
  shortCode: string | null
  reelUrl: string | null
  conversationId: string | null
  progress: string // human-readable step label for the live block
  result: SingleReelResult | null
  error: string | null
  startRun: (shortCode: string, reelUrl: string, conversationId: string | null) => void
  setProgress: (label: string) => void
  setResult: (result: SingleReelResult) => void
  setError: (msg: string) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as SingleReelStatus,
  shortCode: null as string | null,
  reelUrl: null as string | null,
  conversationId: null as string | null,
  progress: '',
  result: null as SingleReelResult | null,
  error: null as string | null,
}

export const useSingleReelStore = create<SingleReelState>()(
  persist(
    (set) => ({
      ...initialState,
      startRun: (shortCode, reelUrl, conversationId) =>
        set({ status: 'running', shortCode, reelUrl, conversationId, progress: 'Scraping reel…', result: null, error: null }),
      setProgress: (label) => set({ progress: label }),
      setResult: (result) => set({ status: 'done', progress: '', result, error: null }),
      setError: (msg) => set({ status: 'failed', progress: '', error: msg }),
      reset: () => set(initialState),
    }),
    {
      name: 'contentos-single-reel',
      storage: supabaseStorage,
      skipHydration: true,
      partialize: (s) => ({
        status: s.status,
        shortCode: s.shortCode,
        reelUrl: s.reelUrl,
        conversationId: s.conversationId,
        result: s.result,
      }),
      version: 1,
      migrate: (state) => state,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SingleReelState>
        // Drop an interrupted mid-run: only restore a terminal 'done' state.
        if (p.status !== 'done' || !p.result) return current
        return { ...current, ...p, status: 'done' as SingleReelStatus, progress: '', error: null }
      },
    },
  ),
)
```

> Note: importing the `ReelExtraction` *type* from `../../api/_lib/singleReelPrompt` is type-only (erased at build). If the app's `tsconfig` `rootDir`/`include` excludes `api/`, instead copy the `ReelExtraction`/`ReelSegment`/`ReelVideoAnalysis` interfaces into this file under a `// keep in sync with api/_lib/singleReelPrompt.ts` comment. Decide based on whether `bun run build` (Step 4) resolves the import.

- [ ] **Step 4: Run test + build typecheck**

Run: `bun run test -- src/store/__tests__/singleReelStore.test.ts`
Expected: PASS. (Type-import resolution is validated by `bun run build` in Task B12.)

- [ ] **Step 5: Commit**

```bash
git add src/store/singleReelStore.ts src/store/__tests__/singleReelStore.test.ts
git commit -m "feat(reel): add persisted single-reel store"
```

---

## Task B8: Single-reel IndexedDB cache

**Files:**
- Create: `src/lib/singleReelCache.ts`
- Test: `src/lib/__tests__/singleReelCache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/singleReelCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getCachedSingleReel, setCachedSingleReel } from '../singleReelCache'
import type { SingleReelResult } from '../../store/singleReelStore'

const sample: SingleReelResult = { transcript: 't', segments: [], videoAnalysis: {} as never, markdown: '# hi' }

describe('singleReelCache', () => {
  it('degrades to a no-op (undefined) when IndexedDB is absent (Node)', async () => {
    // jsdom/node test env has no indexedDB → getCachedSingleReel returns undefined and set no-ops.
    await setCachedSingleReel('ABC', sample)
    expect(await getCachedSingleReel('ABC')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/__tests__/singleReelCache.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/lib/singleReelCache.ts` (mirrors `deepReelCache.ts`):

```ts
/**
 * Single-reel case-study cache (IndexedDB via idb).
 *
 * A reel's analysis is immutable (the video doesn't change), so we cache the full
 * SingleReelResult forever, keyed by shortCode + prompt version. Re-pasting a URL is
 * then free (skips the Apify scrape + both Gemini calls). No-ops when IndexedDB is
 * unavailable (Node tests / SSR) — callers always fall back to a live run.
 */

import { openDB, type IDBPDatabase } from 'idb'
import { SINGLE_REEL_PROMPT_VERSION } from '../../api/_lib/singleReelPrompt'
import type { SingleReelResult } from '../store/singleReelStore'

const DB_NAME = 'reel-intel'
const STORE = 'single-reel'
const VERSION = 2 // bump from deepReelCache's DB version 1: adds the 'single-reel' object store

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === 'undefined') return null
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('deep-analyses')) db.createObjectStore('deep-analyses')
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      },
    })
  }
  return dbPromise
}

function cacheKey(shortCode: string): string {
  return `${shortCode}@v${SINGLE_REEL_PROMPT_VERSION}`
}

export async function getCachedSingleReel(shortCode: string): Promise<SingleReelResult | undefined> {
  const p = getDb()
  if (!p) return undefined
  try {
    return (await (await p).get(STORE, cacheKey(shortCode))) as SingleReelResult | undefined
  } catch {
    return undefined
  }
}

export async function setCachedSingleReel(shortCode: string, result: SingleReelResult): Promise<void> {
  const p = getDb()
  if (!p) return
  try {
    await (await p).put(STORE, result, cacheKey(shortCode))
  } catch {
    /* best-effort */
  }
}
```

> IMPORTANT: This shares the `reel-intel` IndexedDB database with `deepReelCache.ts`, so the DB `VERSION` is bumped to 2 and the `upgrade` callback recreates BOTH object stores (idb runs `upgrade` only on version change; it must re-declare existing stores). Confirm `deepReelCache.ts` still opens cleanly (its `upgrade` guards with `contains`, so a higher version is safe). If preferred, use a separate DB name (`'reel-intel-single'`) to avoid coupling — acceptable alternative.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/lib/__tests__/singleReelCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/singleReelCache.ts src/lib/__tests__/singleReelCache.test.ts
git commit -m "feat(reel): add single-reel IndexedDB cache"
```

---

## Task B9: `analyze_single_reel` agent tool + routing

**Files:**
- Modify: `src/tools/agentTools.ts` (type unions, registry entry, dispatch action, system prompt)
- Test: `src/tools/__tests__/agentTools.singleReel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tools/__tests__/agentTools.singleReel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateToolCall, decideAction, AGENT_TOOLS, AGENT_SYSTEM_PROMPT } from '../agentTools'

describe('analyze_single_reel tool', () => {
  it('is registered and declared', () => {
    expect(AGENT_TOOLS.some((t) => t.name === 'analyze_single_reel')).toBe(true)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/analyze_single_reel/)
  })
  it('validates a reel URL and normalizes to a canonical URL + shortCode', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrl: 'https://instagram.com/reel/ABC123?x=1' })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.args.reelUrl).toBe('https://www.instagram.com/reel/ABC123/')
      expect(v.args.shortCode).toBe('ABC123')
    }
  })
  it('rejects a non-reel URL', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrl: 'https://instagram.com/garyvee' })
    expect(v.ok).toBe(false)
  })
  it('decideAction dispatches it', () => {
    const v = validateToolCall('analyze_single_reel', { reelUrl: 'https://www.instagram.com/reel/ABC/' })
    if (!v.ok) throw new Error('expected ok')
    const action = decideAction({ kind: 'functionCall', name: 'analyze_single_reel', args: v.args } as never)
    expect(action).toMatchObject({ type: 'dispatch', name: 'analyze_single_reel' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/tools/__tests__/agentTools.singleReel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

In `src/tools/agentTools.ts`:

(a) Add the import at the top (after the `z` import):

```ts
import { parseReelUrl } from '../lib/reelUrl'
```

(b) Add `'analyze_single_reel'` to `AgentToolName` (line ~23):

```ts
export type AgentToolName =
  | 'ask_clarification'
  | 'discover_competitors'
  | 'discover_by_location'
  | 'analyze_reels'
  | 'analyze_single_reel'
  | 'answer_content'
```

(c) Extend the dispatch action union (line ~39):

```ts
  | { type: 'dispatch'; name: 'discover_competitors' | 'discover_by_location' | 'analyze_reels' | 'analyze_single_reel'; args: Record<string, unknown> }
```

(d) Add the registry entry inside `TOOL_REGISTRY`, after `analyze_reels`:

```ts
  analyze_single_reel: {
    description:
      'Deep case-study analysis of ONE specific Instagram reel, given its URL (a /reel/, /reels/ or /p/ link). Returns the transcript plus a full hook/psychology breakdown. Use when the user pastes or names a single reel URL — NOT for analyzing a creator by @handle (use analyze_reels for that).',
    parameters: {
      type: 'object',
      properties: { reelUrl: { type: 'string', description: 'The full Instagram reel URL to analyze.' } },
      required: ['reelUrl'],
    },
    schema: z
      .object({ reelUrl: z.string().min(1) })
      .transform((d) => {
        const parsed = parseReelUrl(d.reelUrl)
        return parsed ? { reelUrl: parsed.canonicalUrl, shortCode: parsed.shortCode } : { reelUrl: '', shortCode: '' }
      })
      .refine((d) => d.shortCode.length > 0, { message: 'a valid Instagram reel URL is required', path: ['reelUrl'] }),
    toAction: (args) => ({ type: 'dispatch', name: 'analyze_single_reel', args }),
  },
```

(e) Add a routing line to `AGENT_SYSTEM_PROMPT` (after the `analyze_reels` line):

```ts
- analyze_single_reel: deep-analyze ONE specific reel when the user gives a reel URL (a link containing /reel/, /reels/ or /p/). Returns its transcript + a hook/psychology case study. Use this (not analyze_reels) whenever a single reel link is present.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/tools/__tests__/agentTools.singleReel.test.ts`
Expected: PASS.

> If `decideAction`'s `GeminiToolResult` discriminant differs (e.g. `kind: 'tool'` not `'functionCall'`), match the existing shape used by the other tools' tests in `src/tools/__tests__/`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/agentTools.ts src/tools/__tests__/agentTools.singleReel.test.ts
git commit -m "feat(agent): add analyze_single_reel tool + URL routing"
```

---

## Task B10: Orchestration hook `useSingleReelAnalysis`

**Files:**
- Create: `src/hooks/useSingleReelAnalysis.ts`

This hook has no direct unit test (it's thin glue over tested units: `scrapeSingleReel`, the cache, the store, and `fetch`). It is exercised by manual verification in Task B12 and the build typecheck.

- [ ] **Step 1: Implement**

Create `src/hooks/useSingleReelAnalysis.ts`:

```ts
/**
 * Single-reel analysis orchestration — the chat-triggered "analyze ONE reel by URL" path.
 *
 *   cache hit → render instantly
 *   miss → scrapeSingleReel (Apify) → POST /api/analyze-single-reel → store + cache.
 *
 * Mirrors useReelAnalysis: keys from useKeysStore (the /api/apify + serverless proxies hold
 * the real keys), AbortSignal for latest-wins, user-safe error strings only.
 */

import { useCallback } from 'react'
import { useKeysStore } from '../store/keysStore'
import { useSingleReelStore, type SingleReelResult } from '../store/singleReelStore'
import { scrapeSingleReel } from '../lib/singleReelClient'
import { getCachedSingleReel, setCachedSingleReel } from '../lib/singleReelCache'
import { parseReelUrl } from '../lib/reelUrl'
import { getClerkToken } from '../lib/clerkToken'
import { ERROR_MESSAGES } from '../lib/errorMessages'

export function useSingleReelAnalysis() {
  const { apifyKeys } = useKeysStore()

  const startSingleReel = useCallback(
    async (reelUrl: string, signal?: AbortSignal) => {
      const parsed = parseReelUrl(reelUrl)
      const store = useSingleReelStore.getState()
      if (!parsed) {
        store.setError("That doesn't look like an Instagram reel link.")
        return
      }
      const { shortCode } = parsed

      // Cache hit → instant.
      const cached = await getCachedSingleReel(shortCode)
      if (cached) {
        store.setResult(cached)
        return
      }
      if (signal?.aborted) return

      try {
        // 1) Scrape the single reel (metadata + downloaded video URL).
        store.setProgress('Scraping reel…')
        const reel = await scrapeSingleReel(parsed.canonicalUrl, apifyKeys, signal)
        if (signal?.aborted) return

        // 2) Server: transcript + analysis + markdown.
        store.setProgress('Transcribing & analysing…')
        const token = await getClerkToken()
        const res = await fetch('/api/analyze-single-reel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            downloadedVideoUrl: reel.downloadedVideoUrl,
            shortCode: reel.shortCode,
            apify: {
              ownerUsername: reel.ownerUsername,
              caption: reel.caption,
              likesCount: reel.likesCount,
              commentsCount: reel.commentsCount,
              videoViewCount: reel.videoViewCount,
              videoDuration: reel.videoDuration,
              hashtags: reel.hashtags,
              timestamp: reel.timestamp,
              musicInfo: reel.musicInfo,
            },
          }),
          signal,
        })
        if (signal?.aborted) return
        if (!res.ok) {
          useSingleReelStore.getState().setError(ERROR_MESSAGES.REEL_ANALYSIS_FAILED ?? 'Could not analyse that reel.')
          return
        }
        const json = (await res.json()) as { result: SingleReelResult }
        useSingleReelStore.getState().setResult(json.result)
        void setCachedSingleReel(shortCode, json.result)
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === 'AbortError') return
        useSingleReelStore.getState().setError(ERROR_MESSAGES.REEL_ANALYSIS_FAILED ?? 'Could not analyse that reel.')
      }
    },
    [apifyKeys],
  )

  return { startSingleReel }
}
```

> Verify against the codebase: (1) `getClerkToken` export name in `src/lib/clerkToken.ts` (the existing reel path uses it — match its exact name/signature; it may be `getClerkToken()` or similar). (2) `ERROR_MESSAGES` keys in `src/lib/errorMessages.ts` — use an existing reel/analysis key or add `REEL_ANALYSIS_FAILED`. (3) `useKeysStore` returns `{ apifyKeys, geminiKeys }` (confirmed in useReelAnalysis.ts:96).

- [ ] **Step 2: Typecheck**

Run: `bun run build` (or `bunx tsc --noEmit -p tsconfig.json` if faster) to confirm the imports resolve.
Expected: no type errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSingleReelAnalysis.ts
git commit -m "feat(reel): add useSingleReelAnalysis orchestration hook"
```

---

## Task B11: Dispatch wiring + render component + ChatPage

**Files:**
- Modify: `src/hooks/useAgentConversation.ts` (import hook, dispatch branch)
- Modify: `src/store/conversationsStore.ts` (`ChatMessage.type` union → add `'single-reel'`)
- Create: `src/components/markdown/CaseStudyMarkdown.tsx`
- Create: `src/components/SingleReelResultMessage.tsx`
- Modify: `src/pages/ChatPage.tsx` (render the new message type + tool chip)
- Modify: `package.json` (deps)

- [ ] **Step 1: Add markdown deps**

Run:

```bash
bun add react-markdown remark-gfm
```

Expected: both appear under `dependencies` in `package.json`; `bun.lock` updated.

- [ ] **Step 2: Themed markdown wrapper**

Create `src/components/markdown/CaseStudyMarkdown.tsx`:

```tsx
/**
 * Themed react-markdown wrapper for the single-reel case study. GFM enabled (tables,
 * blockquotes). Styled to DESIGN.md: Instrument Serif headings, Outfit body, DM Mono in
 * the stats table, saffron accents on links, warm neutrals. No raw HTML is allowed
 * (react-markdown does not render HTML by default — safe for model output).
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function CaseStudyMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="case-study-md text-[15px] leading-relaxed text-stone-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 font-['Instrument_Serif'] text-2xl italic text-stone-50">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-5 font-['Instrument_Serif'] text-xl italic text-[#E07B3A]">{children}</h2>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-[#E07B3A] underline">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-[#E07B3A]/60 pl-3 text-stone-300 italic">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse font-['DM_Mono'] text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-stone-700 px-2 py-1 text-left text-stone-400">{children}</th>,
          td: ({ children }) => <td className="border-b border-stone-800 px-2 py-1">{children}</td>,
          hr: () => <hr className="my-4 border-stone-800" />,
          li: ({ children }) => <li className="ml-4 list-disc">{children}</li>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
```

> Match the project's actual styling system: the repo uses Tailwind utility classes (confirm in an existing component like `ReelResultMessage.tsx`). If font families are exposed as Tailwind theme tokens (e.g. `font-serif`/`font-mono` mapped in `tailwind.config`), use those tokens instead of the arbitrary `font-['...']` values. Keep colors to the DESIGN.md palette.

- [ ] **Step 3: Result message component**

Create `src/components/SingleReelResultMessage.tsx`:

```tsx
/**
 * Inline single-reel case-study result. Reads useSingleReelStore (one reel at a time).
 * Renders: live progress while running → the markdown case study + a collapsible
 * Transcript (with [m:ss] timestamps) when done → a user-safe error otherwise.
 */
import { useState } from 'react'
import { useSingleReelStore } from '../store/singleReelStore'
import { CaseStudyMarkdown } from './markdown/CaseStudyMarkdown'

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function SingleReelResultMessage() {
  const { status, progress, result, error } = useSingleReelStore()
  const [showTranscript, setShowTranscript] = useState(false)

  if (status === 'running') {
    return (
      <div className="rounded-lg border border-stone-800 bg-stone-900/40 px-4 py-3 text-sm text-stone-300">
        <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#E07B3A]" />
        {progress || 'Analysing reel…'}
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
        {error ?? 'Could not analyse that reel.'}
      </div>
    )
  }
  if (status !== 'done' || !result) return null

  const hasTranscript = result.transcript.trim().length > 0
  const copy = () => navigator.clipboard?.writeText(result.markdown).catch(() => {})

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/40 px-4 py-4">
      <div className="mb-2 flex justify-end">
        <button onClick={copy} className="text-xs text-stone-400 hover:text-[#E07B3A]">
          Copy case study
        </button>
      </div>

      <CaseStudyMarkdown markdown={result.markdown} />

      {hasTranscript && (
        <div className="mt-4 border-t border-stone-800 pt-3">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="text-sm font-medium text-[#E07B3A] hover:underline"
          >
            {showTranscript ? '▾ Hide transcript' : '▸ Show transcript'}
          </button>
          {showTranscript && (
            <div className="mt-2 space-y-1 font-['DM_Mono'] text-[13px] text-stone-300">
              {result.segments.length > 0 ? (
                result.segments.map((seg, i) => (
                  <p key={i}>
                    <span className="mr-2 text-stone-500">[{fmtTime(seg.start)}]</span>
                    {seg.text}
                  </p>
                ))
              ) : (
                <p className="whitespace-pre-wrap">{result.transcript}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Extend the chat message type**

In `src/store/conversationsStore.ts`, find the `ChatMessage` `type` union (it currently includes `'text' | 'options' | 'reel' | 'result' | 'error'` etc.) and add `'single-reel'`. Example edit (match the actual union):

```ts
  type?: 'text' | 'options' | 'reel' | 'single-reel' | 'result' | 'error'
```

- [ ] **Step 5: Dispatch branch**

In `src/hooks/useAgentConversation.ts`:

(a) Add the hook import + usage near the existing `useReelAnalysis` usage (line ~25/46):

```ts
import { useSingleReelAnalysis } from './useSingleReelAnalysis'
```
```ts
  const { startSingleReel } = useSingleReelAnalysis()
```

(b) In `dispatchTool`, add this branch right after the `analyze_reels` branch (after line ~257):

```ts
    if (name === 'analyze_single_reel') {
      const reelUrl = String(args.reelUrl ?? '')
      const shortCode = String(args.shortCode ?? '')
      const convId = useConversationsStore.getState().activeId
      useSingleReelStore.getState().startRun(shortCode, reelUrl, convId)
      addMessage({ role: 'assistant', type: 'single-reel', content: `Analyzing this reel: ${reelUrl}` })
      startSingleReel(reelUrl, signal)
      return
    }
```

(c) Add the store import at the top:

```ts
import { useSingleReelStore } from '../store/singleReelStore'
```

- [ ] **Step 6: Render in ChatPage**

In `src/pages/ChatPage.tsx`:

(a) Import the component (near line 27):

```ts
import { SingleReelResultMessage } from '../components/SingleReelResultMessage'
```

(b) In the message render switch (the chain around line 485-540), add a branch for the new type. After the `message.type === 'reel'` branch, add:

```tsx
                ) : message.type === 'single-reel' ? (
                  <div key={message.id} className="my-2">
                    <SingleReelResultMessage />
                  </div>
```

> The component reads the store directly (one active single-reel run), so it does not need props. Match the exact JSX ternary structure already in ChatPage — wrap consistently with the surrounding branches (key, container classes).

(c) Add a tool chip to `TOOL_CHIPS` (line ~36):

```ts
  { tool: 'Analyze one reel', example: 'https://www.instagram.com/reel/...', hint: 'Paste a reel link for a full breakdown + transcript' },
```

- [ ] **Step 7: Build + typecheck + tests**

Run: `bun run build && bun run test`
Expected: build succeeds; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useAgentConversation.ts src/store/conversationsStore.ts src/components/markdown/CaseStudyMarkdown.tsx src/components/SingleReelResultMessage.tsx src/pages/ChatPage.tsx package.json bun.lock
git commit -m "feat(reel): render single-reel case study + transcript inline in chat"
```

---

## Task B12: PIPELINE_REGISTRY + types + agent eval

**Files:**
- Modify: `src/tools/registry.ts` (PIPELINE_REGISTRY entry)
- Modify: `src/tools/types.ts` (result `kind` if a payload union lives here)
- Modify: `agentLoop.eval.test.ts` (golden routing case — locate via `git ls-files | grep agentLoop.eval`)

- [ ] **Step 1: Inspect the registry + eval shapes**

Run:

```bash
sed -n '1,80p' src/tools/registry.ts
git ls-files | grep -i 'agentLoop.eval'
```

Read both so the new entries match the existing structure exactly.

- [ ] **Step 2: Add the PIPELINE_REGISTRY entry**

In `src/tools/registry.ts`, add an entry following the existing shape (confirm field names — likely `confirmMessage` + `confirmOptions` per CLAUDE.md). Example:

```ts
  analyze_single_reel: {
    confirmMessage: (args: { reelUrl?: string }) => `Analyze this reel: ${args.reelUrl ?? ''}?`,
    confirmOptions: ['Analyze reel'],
  },
```

> Match the real `PIPELINE_REGISTRY` value type. If entries are keyed by pipeline name with different fields, mirror those exactly.

- [ ] **Step 3: Add the golden eval case**

In the agent golden-set (`agentLoop.eval.test.ts`), add a case asserting a pasted reel URL routes to `analyze_single_reel`. Match the file's existing case structure; conceptually:

```ts
{
  name: 'single reel URL → analyze_single_reel',
  input: 'break down this reel https://www.instagram.com/reel/CxYz123/',
  expectTool: 'analyze_single_reel',
},
```

> Use the exact case object shape the other entries use (field names, how the expected tool is asserted). If the eval calls a live model and is gated behind an env flag, place the case alongside the others so it runs under the same conditions.

- [ ] **Step 4: Run tests**

Run: `bun run test -- src/tools` and the eval file (e.g. `bun run test -- agentLoop.eval`).
Expected: PASS (or eval skips cleanly if it requires real keys, matching the other cases).

- [ ] **Step 5: Commit**

```bash
git add src/tools/registry.ts src/tools/types.ts agentLoop.eval.test.ts
git commit -m "feat(reel): register single-reel pipeline + agent eval case"
```

---

## Task B13: Full verification

- [ ] **Step 1: Full build + typecheck + tests + lint**

Run:

```bash
bun run build && bun run typecheck:api && bun run test && bun run lint
```

Expected: all green. (`bun run build` already runs app + api typecheck per CLAUDE.md.)

- [ ] **Step 2: Manual smoke (requires real keys / deployed function)**

In a dev/preview environment with `GEMINI_API_KEY` + Apify keys configured:
1. Open Chat, paste a public Instagram reel URL, send.
2. Confirm the agent routes to single-reel (live progress → case study).
3. Confirm the markdown renders (headings, stats table, sections) per DESIGN.md.
4. Click "Show transcript" → timestamped segments appear.
5. Re-paste the same URL → result returns instantly (cache hit).
6. Paste a non-reel URL / @handle → routes to `analyze_reels` or a clarification, NOT single-reel.

> `analyze-single-reel` is only exercised under `vercel dev` / a deployment (serverless function). Plain `vite dev` will 404 the endpoint — the hook surfaces a user-safe error, which is expected locally.

- [ ] **Step 3: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(reel): verification fixes for single-reel pipeline"
```

---

## Self-Review Notes (spec coverage)

- **Part A — strengthen deep prompts:** Tasks A1–A3 (client + server mirror + report). ✔
- **Gemini-native transcript:** extraction prompt/schema (B4) returns transcript + segments; surfaced in the UI (B11). ✔
- **Markdown case study output:** synthesis prompt (B4) + render (B11). ✔
- **Single reel by URL in chat:** tool (B9) + dispatch (B11) + hook (B10) + scrape (B2/B3) + serverless (B5/B6). ✔
- **Two-stage server split:** B6 core runs extraction then synthesis. ✔
- **Re-run cache:** B8 + wired in B10. ✔
- **v1 scope (no comments/benchmark):** B4 synthesis prompt omits them; test asserts their absence. ✔
- **Conventions:** new persisted store has version+migrate (B7); serverless self-contained ESM + Clerk gate + SSRF allowlist (B6); frozen `single-reel` discriminant (B11/B12); DESIGN.md styling (B11). ✔

**Known verification points flagged inline (resolve against the live codebase during execution):** `ApifyError` constructor arity (B3); `GeminiToolResult` discriminant in `decideAction` tests (B9); `getClerkToken` export name + `ERROR_MESSAGES` keys + `useKeysStore` shape (B10); `ChatMessage.type` union members + ChatPage ternary structure + `PIPELINE_REGISTRY` value type + eval case shape (B11/B12); type-only import of `ReelExtraction` across the `api/` boundary, else inline the types (B7); shared IndexedDB `reel-intel` DB version bump vs a separate DB (B8); Tailwind font tokens vs arbitrary values (B11).
