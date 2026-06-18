# Design: Hookmap-strengthened deep analysis + single-reel-by-URL in chat

**Date:** 2026-06-16
**Status:** Approved design — ready for implementation plan
**Source reference:** https://github.com/Adityaraj0421/hookmap

## Goal

Two independent improvements to ContentOS 2.0's reel intelligence:

1. **Strengthen the deep-analysis prompts** by porting the rigor from hookmap's
   synthesis prompt (timestamp citations, anti-fabrication, compound hooks,
   engineered-funnel detection, specificity rules).
2. **Add single-reel analysis to the chat interface** — analyze ONE reel by its
   URL and render a hookmap-style markdown case study that also yields the
   reel's **transcript**.

These ship together but have no dependency on each other.

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Transcript source | **Gemini-native** | Reuses the existing Gemini Files API path; no new `GROQ_API_KEY` / serverless leg. Transcript + light segment timestamps come from the same multimodal call. |
| Single-reel output | **Markdown case study** | Closest to hookmap's value; a rich strategist-voice narrative rendered as a chat bubble. |
| Prompt-strengthening scope | **Deep path only** | The "deep analysis" the request names. Quick caption-only path can't see video, so timestamp/visual rules don't apply. |
| v1 enrichment | **Video + transcript only** | Tightest scope. Top-comments and creator-benchmark sections auto-omit in the prompt; clean follow-ups. |
| Server stages | **Two-stage** (extraction → synthesis) | Synthesis is a cheap text-only call; splitting keeps extraction schema-clean and gives the synthesis prompt its own focused generation. One video upload. |
| Re-run cache | **Include in v1** | Single-reel is the expensive path; users re-paste URLs; `deepReelCache` pattern already exists to copy. |

---

## Part A — Strengthen the deep-path prompts

**Files:**
- `src/ai/prompts/deepReelAnalysis.ts` — `buildDeepReelPrompt`, `buildDeepReportPrompt`
- `api/_lib/deepReelPrompt.ts` — server-side mirror (intentionally duplicated; keep in sync)

**No schema change.** All upgrades are prompt-text only, folded into the existing
structured fields so current rendering and caching keep working.

Port these hookmap instructions into `buildDeepReelPrompt`:

1. **Anti-fabrication.** "Never invent. Mark genuinely-unknown values
   `[unknown — <reason>]` rather than guessing. Never fabricate a timestamp."
2. **Timestamp citations.** Every visual/spoken claim in `visualOpening`,
   `hookBreakdown`, and `pacingEditing` ends with a `[m:ss]` bracket grounded in
   what is actually seen/heard. `[0:03]` for a moment, `[0:03–0:08]` for a range.
3. **"Every claim needs a *because*"** + specificity rule. Ban generic labels
   ("emotional hook"); require the exact emotion AND the identity signal.
4. **Compound hooks.** Explicitly state that most viral hooks are compound and
   naming primary + secondary archetype is more accurate than forcing one.
5. **Engineered-DM-funnel detection.** If the caption baits keyword-comments AND
   comments exceed ~5% of likes, flag it in `psychologyTrigger` as a funnel
   metric, not organic virality (normal ratio 1–5%). Metrics are already present
   in the caption context passed to the prompt.

`buildDeepReportPrompt` (cross-creator synthesis) receives the same
anti-fabrication + "grounded strictly in the data above" tightening.

**Risk:** low — text-only, no schema/data-flow/rendering change.

---

## Part B — Single-reel analysis (new pipeline)

Follows CLAUDE.md's "Adding a new pipeline" conventions.

### Data flow

```
User pastes a reel URL in chat
  → agent routes to tool `analyze_single_reel({ reelUrl })`
  → dispatchTool fires useSingleReelAnalysis(reelUrl)
       1. Cache check (IndexedDB, by shortCode) — render immediately on hit.
       2. Apify: scrape the ONE reel
          (apify~instagram-reel-scraper, direct URL, includeDownloadedVideo)
          → metadata (caption, metrics, duration, musicInfo) + stable
            api.apify.com downloaded-video URL.
       3. POST /api/analyze-single-reel
            { downloadedVideoUrl, shortCode, apify metadata }
          Stage 1 (Gemini Files API): upload video → JSON
            { transcript, segments:[{start,text}],
              videoAnalysis:{ visual_beats[], cuts, framing, t0_frame } }
          Stage 2 (Gemini text-only): hookmap synthesis prompt over
            apify-meta + transcript + segments + videoAnalysis
            → markdown case study
          → { transcript, segments, markdown }
       4. Cache + store result; render inline.
```

Two-stage server-side: one video upload, one extraction call (JSON, schema-
validated), one cheap text-only synthesis call. Gemini file deleted after
stage 1 (best-effort, like the existing path).

### New / changed files

| File | Change |
|---|---|
| `src/tools/agentTools.ts` | New `analyze_single_reel` tool: declaration, zod URL validation (`/reel/<code>/` or `/p/<code>/`), `toAction`. |
| `src/hooks/useAgentConversation.ts` | System-prompt routing line (URL → `analyze_single_reel`; distinct from `@handle` → `analyze_reels`) + `dispatchTool` branch. |
| `src/hooks/useSingleReelAnalysis.ts` | New hook: cache → scrape → POST → store; progress states + AbortSignal (latest-wins). |
| `src/lib/actors.ts` | `buildSingleReelInput(reelUrl)` helper. |
| `src/lib/singleReelClient.ts` | Apify single-reel scrape (direct URL → metadata + video URL). |
| `src/lib/singleReelCache.ts` | IndexedDB cache by shortCode (mirror `deepReelCache.ts`). |
| `src/store/singleReelStore.ts` | New persisted store (`version:1`, identity `migrate`, conversation-tagged like `reelAnalysisStore`). |
| `api/analyze-single-reel.ts` | New serverless fn: `requireClerkUser` gate, SSRF guard (api.apify.com), 2-stage Gemini. |
| `api/_lib/deepReelPrompt.ts` | Add stage-1 extraction schema + the strengthened hookmap synthesis prompt builder. |
| `api/_lib/geminiFiles.ts` | Reuse for stage-1 upload/extraction (parameterized prompt+schema already supported). |
| `src/components/SingleReelResultMessage.tsx` | New: renders markdown case study (`react-markdown` + `remark-gfm`) styled per DESIGN.md + collapsible **Transcript** section (with `[m:ss]`) + copy button + progress steps for the live run. |
| `src/pages/ChatPage.tsx` | Wire the new result component into the inline render block; add a tool chip example. |
| `src/tools/registry.ts` | `PIPELINE_REGISTRY` entry (confirmMessage/options). |
| `src/tools/types.ts` | New result payload type (frozen `kind` discriminant, e.g. `'single-reel'`). |
| `agentLoop.eval.test.ts` | Golden eval: a pasted reel URL routes to `analyze_single_reel`. |
| `package.json` | Add `react-markdown` + `remark-gfm` (no markdown renderer exists today). |

### Transcript delivery

The serverless response returns `transcript` and `segments` **separately** from
the markdown. `SingleReelResultMessage` renders a dedicated, collapsible
**Transcript** section with `[m:ss]` timestamps — independent of the case-study
prose — directly satisfying "should also yield the transcript of the reel."

### Markdown rendering

No markdown renderer exists in the repo. Add `react-markdown` + `remark-gfm`
(GFM tables/blockquotes are used by the case-study template). Styled to
DESIGN.md (Instrument Serif headings, Outfit body, DM Mono for the stats table,
saffron `#E07B3A` accent, chai-dark background, warm neutrals — no slate/indigo/
Inter; AI-generated narrative may use the violet tint `#A78BFA`).

### Synthesis prompt (Part B)

Port hookmap's `process-reel` `SYNTHESIS_SYSTEM_PROMPT` (the newer "senior
strategist" markdown variant), adapted for Gemini-native input:

- Inputs section names Apify data, the Gemini transcript + segments, and the
  Gemini video analysis (instead of Whisper).
- Keep: mandatory `[m:ss]` citations, anti-fabrication, specificity, compound
  hooks, the full markdown structure (Hook / Topic / Keywords / Psychology /
  3 hook ideas / verbatim caption), engineered-funnel rule.
- Drop/auto-omit for v1: the `creator_benchmark` chip block and the
  `top_comments` "What viewers actually said" subsection (prompt already omits
  these cleanly when the data is absent).

### Security & conventions

- `api/analyze-single-reel.ts` uses `requireClerkUser` (fails closed) and the
  same `api.apify.com` SSRF allowlist + 50MB size cap as `analyze-reel-video.ts`.
- Gemini/Apify keys remain server-side (`process.env`); no `VITE_` exposure.
- No new env vars; `/api/config` readiness already covers `geminiReady`.
- Persisted payload `kind` discriminant `'single-reel'` is frozen once shipped.

---

## Scope boundaries (v1)

- **In:** one reel's video + Gemini transcript + markdown case study + re-run cache.
- **Out (clean follow-ups; prompt auto-omits):** top-comments evidence section,
  creator-benchmark chip (each needs an extra Apify scrape).

## Testing

- Unit: `buildSingleReelInput`, URL→shortCode parsing, store migrate/identity,
  prompt builders (snapshot the strengthened deep prompt + the new synthesis
  prompt), serverless pure-core extraction/coercion.
- Eval: agent golden-set case — reel URL routes to `analyze_single_reel`.
- Manual: paste a real reel URL in chat → case study + transcript render;
  re-paste → served from cache.
