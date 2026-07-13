# Script Studio — reference-reel → new-topic script remix

**Date:** 2026-07-13
**Status:** Design approved (pending written-spec review)
**Owner:** Aditya

## 1. Summary

Add a **Script Studio** feature to Content OS 2.0 that replicates the core loop of
Zerovi.ai: paste a short-form video URL (Instagram Reel **or** YouTube Short) + a new
video idea, and get back a ready-to-shoot script that keeps the reference video's
*structural blueprint* (hook → setup → body → CTA + pacing) while writing about the new
topic. Optionally, the script is rendered in a specific client's voice.

This is **not** a new product — ~85% of the pipeline already exists. The existing
**Repurpose Reel** pipeline is the mirror image of this feature (it keeps the source
*topic* and swaps the *voice*); Script Studio keeps the source *structure* and swaps the
*topic*. The new work is: one YouTube ingest adapter, one prompt mode, one dedicated
page, and the wiring to hang them together.

### Locked decisions

| Decision | Choice |
|---|---|
| Voice target | **Optional** — client voice if provided, else mimic the reference transcript's own register |
| Interaction model | **Dedicated form/page** (not chat), two explicit steps with an editable transcript in between |
| Source platforms (v1) | **Instagram Reels + YouTube Shorts** |
| Output languages | **English · Hinglish** (Hinglish = romanized / Latin script, per existing enforcement) |
| Nav section name | **Script Studio** |

## 2. Architecture: transcript-first, unified

The central design principle: **normalize every source to a transcript first.** The
reference video's *script blueprint* is the universal currency for remixing; platform
specifics never leak past the ingest boundary.

```
                 ┌─────────────────────────────────────────────┐
   Source URL ──►│  ingest adapter (platform-detected)          │──► transcript (+ optional
                 │   IG  → scrapeReelVideos → /api/analyze-      │      segments / mechanics)
                 │         single-reel (Gemini transcribes)     │
                 │   YT  → Apify Transcript Ninja via /api/apify │
                 └─────────────────────────────────────────────┘
                                     │
                        (user may EDIT the transcript)
                                     │
                 ┌─────────────────────────────────────────────┐
   newTopic  ──► │  reelRewrite prompt (newTopic mode)          │──► ReelRewriteResult
   language  ──► │   preserve beat structure EXACTLY,           │      (hook, beats, caption,
   voice?    ──► │   write about newTopic,                      │      cta, onScreenText, altHooks)
                 │   voice = client profile OR source register  │
                 └─────────────────────────────────────────────┘
```

### Why transcript-first (and not video-first)

Neither available YouTube Apify actor returns a downloadable `.mp4`, so YouTube **cannot**
flow through the IG-style Gemini-Files video path. Rather than fight that, we lean into it:
the rewrite prompt already reconstructs beat structure from a transcript, so **no video is
needed for structure analysis on either platform**. IG's richer video mechanics (cuts,
overlay density, visual beats) remain available as *optional* enhancement context, not a
dependency.

**Alternative considered & rejected for v1:** also pull YouTube's AI time-segmented
video-description (via `streamers/youtube-scraper`, `aiVideoDescription`) for visual-mechanics
parity with IG. Adds per-run cost + a second output shape for marginal gain on a *script*
feature. → fast-follow, not v1.

### Ingest adapters

| Platform | Path | Notes |
|---|---|---|
| Instagram Reel | `scrapeReelVideos([url])` (existing, `src/lib/reelVideoClient.ts`) → `POST /api/analyze-single-reel` (existing) | Returns `{ transcript, segments, videoAnalysis, markdown }`. Reuse verbatim. |
| YouTube Short | Apify **Transcript Ninja** (`topaz_sharingan~Youtube-Transcript-Scraper-1`) via existing `/api/apify` proxy (`apifyCore` start/poll/fetch) | Returns caption transcript. No new serverless function. |

Both adapters resolve to a common shape:

```ts
interface SourceTranscript {
  platform: 'instagram' | 'youtube'
  transcript: string            // verbatim spoken text
  segments?: { start: number; text: string }[]  // IG only (bonus)
  videoAnalysis?: ReelVideoAnalysis              // IG only (bonus)
}
```

## 3. UX — the dedicated page

New nav section **Script Studio**, added via one entry in `NAV_SECTIONS`
(`src/components/AppLayout.tsx`) + one route in `src/App.tsx` (per the "Adding a new nav
section" guide in CLAUDE.md). Nav, active states, and routing derive automatically.

Single page (`src/pages/ScriptStudioPage.tsx`), two explicit steps:

**Step 1 — Fetch & Transcribe**
- Input: *Source URL* (one field; IG-vs-YT auto-detected + validated).
- Action button: **Fetch & Transcribe** → runs the ingest adapter → renders the transcript
  in an **editable textarea** (user can fix mis-transcribed words before generating).
- While running: reuse `ProgressSteps` for inline status; on provider outage reuse the
  existing `PROVIDER_BLOCKED_MESSAGE` fast-fail copy.

**Step 2 — Generate**
- Inputs: *New idea / topic* (required, free text); *Language* toggle (English · Hinglish);
  optional *Client voice* (either an `@handle` **or** pasted scripts — same two paths the
  voice-profile system already supports).
- Action button: **Generate script** → runs the rewrite → renders the result panel.

**Result panel** — reuses the existing `ReelRewriteResult` shape and the
`RepurposeResultMessage` sub-components (or extracted shared parts): **spoken hook**, **3
alt hooks**, **beat-by-beat script**, **clean voiceover script**, **caption**, **CTA**,
**on-screen text** — each with a copy button.

**Design system:** the page follows `DESIGN.md` (chai-dark `#1A1410` background, saffron
`#E07B3A` accent, Instrument Serif / Outfit / DM Mono, warm neutrals). The generated
script is AI-produced content, so it uses the **violet tint `#A78BFA`** treatment
consistent with other AI output in the app.

## 4. Prompt delta — the actual work

`src/ai/prompts/reelRewrite.ts` today = *keep source topic, swap voice*. Add an optional
`newTopic` parameter that flips the instruction:

- **When `newTopic` is set:** preserve the source reel's beat structure, hook pattern, and
  pacing **EXACTLY**, but write about `newTopic`. Do not carry over the source's subject
  matter, examples, or specifics.
- **Voice:** if a client voice profile is provided, render in that voice; otherwise mimic
  the *source transcript's own* register/energy (no client profile required).
- **Language:** honor the explicit English/Hinglish toggle (independent of the source
  transcript's language — Gemini rewrites/translates). Hinglish stays romanized.
- **Output schema unchanged** (`REEL_REWRITE_SCHEMA`) → rendering, copy buttons, and alt-hook
  generation come for free.

The existing "write for the ear / no AI tells / preserve beat count & CTA placement" rules
carry over unchanged.

## 5. Files

**New**
- `src/pages/ScriptStudioPage.tsx` — the two-step form + result panel.
- `src/hooks/useReelRemix.ts` — orchestrates the two steps (fetch→transcribe, then
  generate); reuses `buildVoiceProfile`, the ingest adapters, and the rewrite call.
- `src/lib/sourceUrl.ts` — pure IG-vs-YouTube detection + URL validation (unit-tested).
- `src/lib/youtubeTranscript.ts` — YouTube ingest adapter over `apifyCore`
  (start/poll/fetch) + transcript normalization.
- `src/store/remixStore.ts` — persisted Zustand store, `version: 1` + identity `migrate`
  (per the persisted-store convention), tags runs so a page reload restores in-progress
  state safely.
- `RemixResult` rendering — extract shared pieces from `RepurposeResultMessage.tsx` or
  render inline; do not duplicate the copy-button logic.

**Changed**
- `src/components/AppLayout.tsx` — one `NAV_SECTIONS` entry.
- `src/App.tsx` — one route under the `AppLayout` block.
- `api/apify.ts` — add the YouTube actor ID to `ALLOWED_ACTORS` (the allowlist **fails
  closed**; without this every YT call returns `400 Actor not allowed`). Update the
  line-13 comment ("only the 4 Instagram actors").
- `src/lib/actors.ts` — add `YOUTUBE_TRANSCRIPT: 'topaz_sharingan~Youtube-Transcript-Scraper-1'`
  + a `buildYoutubeTranscriptInput(url)` builder. (Apify actor IDs use `~`, not `/`.)
- `src/ai/prompts/reelRewrite.ts` — add the optional `newTopic` mode.

**Untouched (no regression risk to shipped code)**
- The chat `repurpose_reel` tool, `useRepurposeReel.ts`, and its dispatch branch stay
  exactly as they are.

Before editing `reelRewrite.ts`, `api/apify.ts`, and `NAV_SECTIONS`, run GitNexus
`impact({ target, direction: 'upstream' })` and report blast radius (per CLAUDE.md).

## 6. Error handling & edge cases

| Case | Behavior |
|---|---|
| Source has no speech (music-only reel) | Empty transcript → clear error, block Generate. Don't rewrite silence. |
| YouTube Short with no captions & no auto-captions | Transcript actor returns empty → clear "couldn't get a transcript for this Short" error. (Fast-follow: fall back to `streamers/youtube-scraper` with `preferAutoGeneratedSubtitles`.) |
| Invalid / non-Reel-non-Short URL | Reject at Step 1 with a specific message (validated in `sourceUrl.ts`). |
| Apify / IG upstream outage | Reuse existing `PROVIDER_BLOCKED_MESSAGE` + `friendlyError` fast-fail (per the outage playbook). |
| `newTopic` empty at Generate | Disable the Generate button; require non-empty topic. |
| User edits transcript to empty | Block Generate (nothing to remix). |

Error strings stay user-safe and code-keyed via `src/lib/errorMessages.ts` — never surface
raw API bodies (C3). Research-target data must not log in prod (`devLog.ts`).

## 7. Ops / security notes

- **Actor allowlist is the security boundary.** Adding exactly one YouTube actor ID keeps
  the surface minimal. No new server env vars — Apify + Gemini keys are already server-side.
- **Pay-per-event cost.** Transcript Ninja bills ~$0.01/run to whichever pooled Apify
  account's key starts it. The pool is N separate free accounts; confirm they can run
  pay-per-event rentals within free credit (trivial cost, but verify during the spike).
- **No new Clerk gates needed** — `/api/apify` and `/api/analyze-single-reel` already
  require a Clerk JWT.

## 8. Testing

- `sourceUrl.ts` — unit tests: IG reel URL, IG post URL, YT Shorts URL, YT watch URL,
  YT `youtu.be` short link, garbage input.
- `youtubeTranscript.ts` — unit test transcript normalization from a fixture dataset row.
- `reelRewrite.ts` — unit test the `newTopic` branch builds the expected prompt (topic-swap
  instruction present; voice-optional path).
- The agent golden-set eval requirement in CLAUDE.md is **specific to chat agent tools** —
  Script Studio is a page, not a `PIPELINE_REGISTRY` tool — so that requirement does not
  apply here.

## 9. Implementation risk — one spike first

The single unproven piece is **YouTube Shorts transcript ingest** (does Transcript Ninja
return usable text for a Shorts URL, and what is its exact `startUrls` input shape —
`["url"]` vs `[{ url }]`?). Mirror the team's prior "R1 reel-video spike": before building
the page, run a one-off spike that calls the actor with a real Shorts URL through
`/api/apify` and confirms a non-empty transcript + input shape. Everything else reuses
proven, shipped paths.

## 10. Deliberately NOT in v1 (YAGNI)

- Chat-based entry (form was chosen).
- YouTube visual-mechanics parity.
- Saving remixes to the shared corpus.
- Batch / multi-URL input.
- TikTok or other platforms.
- "Match source language" output option (English/Hinglish only).
