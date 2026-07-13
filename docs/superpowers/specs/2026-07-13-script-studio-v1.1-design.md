# Script Studio v1.1 — library reference, saved voices, variations, per-field regenerate

**Date:** 2026-07-13
**Status:** Design approved (pending written-spec review)
**Owner:** Aditya
**Builds on:** [Script Studio v1](2026-07-13-script-studio-reel-remix-design.md) (PR #76)

## 1. Summary

Four Tier-1 enhancements to Script Studio, shipped together as "v1.1". The theme: **do more with data and structure that already exist** — the corpus already holds reel transcripts and saved voice profiles, and the generated script is already a structured schema, so most of this is wiring, not new AI.

| # | Feature | Core idea |
|---|---|---|
| 1 | **Library reference** (both entry points) | Pick a reel from the corpus instead of pasting a URL — transcript comes from the corpus (free, no scrape); beats opportunistically from cache. In-Studio picker **and** a "Remix this" button on Gallery cards. |
| 2 | **Saved-voice dropdown** | Choose a saved client voice from a dropdown (instant, cached) instead of typing an `@handle`; keep the type/paste fallback. |
| 3 | **3 variations in tabs** | Every Generate produces 3 distinct scripts (different hook angles), rendered as tabs. Run **sequentially** — stream each in as it finishes. |
| 4 | **Regenerate any field** | A ↻ button on every single-string field (hook, each beat's script + overlay, caption, cta, each overlay line) regenerates just that field, coherent with the rest. |

### Locked decisions
- Library entry: **both** (in-Studio picker + Gallery button).
- Variations: **3, sequential**, tabs populate incrementally as each completes.
- Regenerate: **any single-string field** (incl. per-beat script + overlay).
- **Split the page into components** (`RemixLibraryPicker`, `RemixVoicePicker`, `RemixResultPanel`).

## 2. Data facts (verified)

- `corpus.listAllContent({ limit })` → `ContentRecord[]`; each has `id` (= shortCode), `transcript` (full spoken text), `caption`, `thumbnailUrl`, metrics, `hookArchetype`, `openingLine`. **Transcript is present without any network call.**
- **Beats** (`videoAnalysis.visual_beats`) are NOT in `ContentRecord` — they live only in the `SingleReelResult` IndexedDB cache (`getCachedSingleReel(shortCode)` in `src/lib/singleReelCache.ts`). On cache-miss we simply omit beats; `buildReelRemixPrompt` already infers structure from the transcript.
- `corpusStore.voiceProfiles` is a `Record<handle, VoiceProfile>`, hydrated on mount; enumerate with `Object.values(...)`. Script Studio's `buildVoiceProfile` already returns a cached profile instantly when the handle exists.

## 3. Hook API (`src/hooks/useReelRemix.ts`)

Three additions; one change to the existing `generate`.

```ts
// NEW: seed a reference from a corpus reel — no network. Beats from cache if present.
fromLibrary(reel: { shortCode: string; transcript: string }): Promise<TranscribeResult>

// CHANGED: accept an already-resolved voice + a variation angle, so variations don't
// rebuild the voice profile 3×. If `voice` is passed, skip buildVoiceProfile.
generate(args: GenerateArgs, signal?): Promise<ReelRewriteResult>
//   GenerateArgs gains: voice?: VoiceProfile; variationAngle?: string

// NEW: resolve voice ONCE, then run `count` angle-generations SEQUENTIALLY.
// onEach fires after each so the UI streams tabs in. Returns all results + the voice
// (kept for regenerate). A single failed variation does not abort the rest.
generateVariations(
  args: GenerateArgs,
  opts?: { count?: number; onEach?: (r: ReelRewriteResult, i: number) => void },
  signal?,
): Promise<{ variations: ReelRewriteResult[]; voice?: VoiceProfile }>

// NEW: regenerate ONE field, coherent with the current script + reference.
regenerateField(
  args: { current: ReelRewriteResult; source: RemixSource; fieldLabel: string;
          newTopic: string; language: TargetLanguage; voice?: VoiceProfile },
  signal?,
): Promise<string>
```

`fromLibrary` body: `const cached = await getCachedSingleReel(reel.shortCode)` → `{ platform: 'instagram', source: { transcript: reel.transcript, beats: cached?.videoAnalysis?.visual_beats }, transcript: reel.transcript }`. (Corpus reels are Instagram; label accordingly.)

`generateVariations` body (sequential):
```
const voice = args.voice ?? (handle||scripts present ? await buildVoiceProfile(...) : undefined)
const variations = []
for (let i = 0; i < count; i++) {
  if (signal?.aborted) break
  try {
    const r = await generate({ ...args, voice, variationAngle: VARIATION_ANGLES[i] }, signal)
    variations.push(r); onEach?.(r, variations.length - 1)
  } catch (err) { if (signal?.aborted) break; /* record a per-variation failure, continue */ }
}
return { variations, voice }
```

## 4. Prompt additions (`src/ai/prompts/reelRemix.ts`)

- `VARIATION_ANGLES: string[]` — 3 fixed angles, e.g. `['open with a curiosity/question hook', 'open with a bold, contrarian claim', 'open with a personal-story hook']`.
- `buildReelRemixPrompt(source, newTopic, language, voice?, variationAngle?)` — when `variationAngle` is set, append one line to the hook instruction: *"For THIS version, {variationAngle}."* Everything else identical, so variations share structure and diverge on approach. (Reuses `REEL_REWRITE_SCHEMA`/`parseReelRewrite`. `reelRewrite.ts` still untouched.)
- `buildFieldRegenPrompt(current: ReelRewriteResult, source: RemixSource, fieldLabel: string, newTopic: string, language: TargetLanguage, voice?: VoiceProfile): string` + `FIELD_REGEN_SCHEMA = { type:'object', properties:{ value:{type:'string'} }, required:['value'] }`. The prompt shows the full current script (for coherence), the reference transcript/beats, the new topic, the language directive, the optional voice, and asks for a fresh value for `fieldLabel` only (e.g. `"the spoken hook"`, `"beat 2's spoken line"`, `"the caption"`), returning `{ value }`.

## 5. Components (new, under `src/components/`)

- **`RemixLibraryPicker.tsx`** — props `{ onPick: (reel: { shortCode: string; transcript: string }) => void }`. On mount loads `corpus.listAllContent({ limit: 200 })`, filters to reels with a non-empty `transcript`, renders a searchable list (thumbnail + caption snippet + `@handle` + metrics), search filters by caption/handle. Selecting a row calls `onPick({ shortCode: record.id, transcript: record.transcript })`.
- **`RemixVoicePicker.tsx`** — props `{ onChange: (v: { clientHandle?: string; pastedScripts?: string }) => void }`. A dropdown seeded from `Object.values(voiceProfiles)` (label = `displayName || '@'+handle`), plus "None" and "New voice…". "New voice…" reveals the existing `@handle` input + paste-scripts textarea. Reports the chosen `{ clientHandle }` (saved or typed) or `{ pastedScripts }` up.
- **`RemixResultPanel.tsx`** — props `{ variations: ReelRewriteResult[]; activeIndex: number; onSelect: (i:number)=>void; regeneratingKey: string | null; onRegenerate: (field: FieldRef) => void }`. Renders `Variation 1/2/3` tabs (a tab shows a spinner until its result streams in), the active variation's fields with copy + ↻ buttons, and disables the ↻ whose `fieldKey(field)` equals `regeneratingKey`. Presentational — it triggers callbacks; the page owns state. Uses the `--color-ai-tint` / `--ai-rgb` theme tokens (no hardcoded hex).

`FieldRef` identifies a single-string slot: `{ kind: 'hook' } | { kind: 'caption' } | { kind: 'cta' } | { kind: 'beatScript'; i: number } | { kind: 'beatOverlay'; i: number } | { kind: 'onScreen'; j: number }`. A pure `fieldKey(FieldRef): string` (e.g. `"hook"`, `"beatScript:2"`) gives each field a stable id used for `regeneratingKey`. The page maps a `FieldRef` → a human `fieldLabel` for the prompt and → the immutable state update for the result.

## 6. Page + Gallery changes

- **`ScriptStudioPage.tsx`** — orchestrator. New state: `sourceMode: 'url' | 'library'`, `variations: ReelRewriteResult[]`, `activeIndex`, `voice?: VoiceProfile`, `regeneratingField`. A "Paste URL ⇄ Choose from library" toggle swaps the URL input for `RemixLibraryPicker`. On mount, read `useLocation().state`; if `{ shortCode, transcript }` present, call `fromLibrary` to seed the reference and jump to the review step, then clear the router state (`navigate(pathname, { replace: true, state: null })`) so a refresh doesn't re-trigger. Generate calls `generateVariations` with `onEach` pushing into `variations` (tabs stream in). Regenerate: `onRegenerate(fieldRef)` → `regenerateField` → immutably update `variations[activeIndex]` and clear `regeneratingField`.
- **`GalleryPage.tsx`** — add a "Remix this" button to each reel card → `navigate('/script-studio', { state: { shortCode: reel.id, transcript: reel.transcript } })`. Disabled when the reel has no transcript.

## 7. Edge cases

| Case | Behavior |
|---|---|
| Library reel with empty transcript | Excluded from the picker; Gallery "Remix this" disabled. |
| Beats not cached | Transcript-only remix (free). No silent `/api/analyze-single-reel` call. |
| 1–2 of the 3 variations fail | Show the successes; the failed tab shows a "retry" that re-runs just that angle. Never fail the whole run. |
| All 3 variations fail | Surface `friendlyError` and return to the review step. |
| Regenerate a field fails | Keep the old value; toast the error (via `friendlyError`). |
| New `@handle` voice + 3 variations | Voice built **once** (in `generateVariations`), reused across all 3 + regenerate — not 3×. |
| Router-state remix consumed | Clear state after seeding so refresh/back doesn't re-seed. |

Error strings stay user-safe (`errorMessages.ts`); research-target data never logs in prod (`devLog.ts`).

## 8. Testing

- `fromLibrary` — beats-from-cache (mock `getCachedSingleReel`) vs transcript-only on cache-miss.
- `buildReelRemixPrompt` — the `variationAngle` branch appends the angle line; absent-angle output unchanged.
- `buildFieldRegenPrompt` — includes the field label + current script + language directive; `FIELD_REGEN_SCHEMA` shape.
- `RemixLibraryPicker` filtering — search matches caption/handle; empty-transcript reels excluded (pure filter helper, unit-tested).
- Existing suite (Script Studio v1 + repurpose) stays green.

## 9. Deliberately NOT in v1.1 (YAGNI)

- Deep-analyzing a library reel on cache-miss (transcript-only is enough).
- Regenerating a beat's *structure/label* (only field *values*).
- A variation-count picker (fixed 3).
- Free-text inline editing of result fields (copy + regenerate covers it).
- `altHooks` per-item regenerate (they're already alternatives; regenerate the main hook instead).
- Persisting variations across reload (page-local state).
