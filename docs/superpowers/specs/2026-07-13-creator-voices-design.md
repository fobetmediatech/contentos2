# Creator Voices — pick a top creator, write in their tone

**Date:** 2026-07-13
**Status:** Design approved (pending written-spec review)
**Owner:** Aditya
**Lives in:** Script Studio (a third source mode), alongside [v1](2026-07-13-script-studio-reel-remix-design.md) (PR #76) + [v1.1](2026-07-13-script-studio-v1.1-design.md) (PR #77)

## 1. Summary

Add a **"Choose a creator"** mode to Script Studio: browse a curated, team-shared directory of top creators grouped by category, pick one, type an idea + language, and get an original short-form script written in that creator's tone — as if their team wrote it. No reference reel; the script is generated **voice-first**, grounded on the creator's real reels.

### Locked decisions
| Decision | Choice |
|---|---|
| Creator source | **Curated global directory** (not the corpus) |
| Directory data | **Seeded in code + editable in-app**; persisted **team-shared** (Supabase table + RLS) |
| Who can edit | **Anyone on the team** (any authenticated user); everyone browses + generates |
| Generation | **Voice-first, grounded** — idea + voice profile (built from the creator's real reels, incl. verbatim `exemplars`) → original script (no reference reel) |
| Where it lives | **Inside Script Studio** as a third source mode (no new page/nav) |
| Output | **One** script per generate (hook, beats, caption, CTA, on-screen, 3 alt hooks), read-only + copy |

## 2. Architecture

Two subsystems meeting at "pick creator → generate":

**A. Directory (data + CRUD)** — team-shared, seeded, editable by anyone.
**B. Voice-first generation** — the one genuinely new LLM path; reuses voice profiles + the script schema.

```
Script Studio source modes:
  [ Paste URL ]  [ Choose from library ]  [ Choose a creator ] ← NEW (CreatorMode)
                                                   │
   directory (category-grouped) → pick creator ────┤
                                                   ▼
   idea + language → resolve voice profile (cached? instant : scrape+build ~50s)
                     (profile carries verbatim `exemplars` from real reels)
                                                   ▼
   buildCreatorScriptPrompt → callGeminiWithSchema(REEL_REWRITE_SCHEMA) → parseReelRewrite → render
```

## 3. Directory data (the one migration)

**New Supabase table `creator_directory`:**

| column | type | notes |
|---|---|---|
| `id` | text (PK) | stable `${category}:${handle}` — makes seeding idempotent |
| `category` | text | e.g. "fitness", "finance" |
| `handle` | text | Instagram handle (voice comes from IG reels) |
| `display_name` | text | shown on the card |
| `created_by` | text | Clerk user id (audit) |
| `created_at` | timestamptz | default now() |

**RLS:** any authenticated user can `select` / `insert` / `update` / `delete` (team-shared, anyone edits). Follows the existing corpus-table RLS pattern (Clerk JWT).

**Seed:** a code data file `src/data/creatorDirectorySeed.ts` — ~8–10 categories × ~6 creators (`{ category, handle, displayName }`). On hydrate, if the table is empty, insert the seed with `on conflict (id) do nothing` so concurrent first-loads don't double-seed. **Handles are AI-suggested and MUST be verified** — a wrong handle → the voice scrape returns nothing; the in-app editor is how they're corrected.

**Repo + store:** mirror the corpus pattern — a `CreatorDirectoryRepository` (Supabase-backed) + a `useCreatorDirectoryStore` (Zustand mirror, hydrated on mount) exposing `byCategory` (grouped) + `add` / `update` / `remove`.

## 4. Voice-first generation

**New prompt** `src/ai/prompts/creatorScript.ts`:
```ts
buildCreatorScriptPrompt(idea: string, voice: VoiceProfile, language: TargetLanguage): string
```
- Writes an ORIGINAL short-form script about `idea`, in the creator's voice.
- Anchored on the `VoiceProfile` — which is built from the creator's real reels and carries: vocabulary, tone, `hookHabits`, `structuralPattern`, `sentenceRhythm`, and **verbatim `exemplars`** (2–4 real opener lines). The exemplars are the real-content few-shot anchor that makes it read "like their team wrote it" — and they ride on the cached profile, so grounding needs **no extra fetch** (cached creators stay instant). Full-transcript grounding is a fast-follow (would require persisting per-reel transcripts).
- Same "write for the ear / no AI slop / Latin-script / language directive" rules as `reelRemix.ts`.
- Returns the existing `REEL_REWRITE_SCHEMA` shape → reuse `parseReelRewrite` + rendering. `reelRewrite.ts` stays untouched.
- Unit-tested (idea present, language directive english/hinglish, voice handle present, exemplars anchored).

**Hook** `src/hooks/useCreatorScript.ts`:
```ts
generate(args: { handle: string; idea: string; language: TargetLanguage }, signal?): Promise<ReelRewriteResult>
```
- Reuses `useRepurposeReel().buildVoiceProfile` (cache-or-build; instant if the profile is saved, else scrape 8 reels → transcribe → synthesize). The returned profile already carries `exemplars`, so nothing extra is fetched.
- Calls `callGeminiWithSchema(buildCreatorScriptPrompt(idea, voice, language), REEL_REWRITE_SCHEMA, { model: PREMIUM_MODEL })` → `parseReelRewrite`.

## 5. UI — inside Script Studio

- **`ScriptStudioPage`**: add a third source-mode button **"Choose a creator"**. When `sourceMode === 'creator'`, render `<CreatorMode />` and skip the URL/library → transcript → remix flow entirely. The page stays a thin dispatcher between the three modes.
- **`CreatorMode.tsx`** (self-contained): 
  - Directory: category-grouped grid of **lean creator cards** (display name, @handle, category — no avatar-scraping in v1). An **Edit** affordance opens an inline editor (add/remove/edit creator: name, @handle, category; add/remove category) writing to the shared store — available to anyone.
  - Pick a card → an idea input + English/Hinglish toggle + **Generate** (progress indicator; first pick of an uncached creator is ~50s).
  - Result: one script rendered via **`RemixResultPanel` in read-only single-slot mode** — pass a one-element `slots` array + a new `readOnly?: boolean` prop that hides the ↻ regenerate buttons; the panel also hides its tab row when `slots.length === 1`. This reuses the exact script-field display (hook, beats, caption, CTA, on-screen, alt hooks) + copy buttons with no duplication.

## 6. Edge cases

| Case | Behavior |
|---|---|
| Wrong handle / creator has no scrapeable IG reels | Voice build fails → clear "couldn't build @handle's voice — check the handle". Anyone can fix it in the editor. |
| First pick (uncached) | ~50s scrape+build with a progress indicator; cached (corpus voice profile) after. |
| Empty category / empty directory | Empty states; seed prevents an empty directory on first run. |
| Concurrent first-load seeding | Idempotent seed (`on conflict (id) do nothing`) — no duplicates. |
| Generation error | `friendlyError` (user-safe strings only; never raw API bodies). |

Directory creators are **Instagram handles** (the voice profile is synthesized from IG reels). Non-IG creators are out of scope for v1.

## 7. Testing

- `buildCreatorScriptPrompt` — unit: idea present, language directive (english/hinglish branch), voice handle present, exemplars anchored, empty-exemplars fallback.
- `creatorDirectorySeed` — unit: stable `category:handle` id shape; no duplicate ids.
- Directory store grouping (`byCategory`) — pure grouping helper unit-tested.
- Migration applied against the Supabase project; RLS verified (authenticated CRUD).
- Existing Script Studio (v1 + v1.1) + repurpose suites stay green.

## 8. Reuse vs new

**Reuse:** `buildVoiceProfile` + voice-profile cache, `REEL_REWRITE_SCHEMA` / `parseReelRewrite`, script-field rendering, `friendlyError`, `devLog`, the Supabase repo/RLS pattern, `callGeminiWithSchema` / `PREMIUM_MODEL`.
**New:** `creator_directory` table + migration + seed, its repo + store + grouping helper, `buildCreatorScriptPrompt`, `useCreatorScript`, `CreatorMode.tsx`, the third mode button in `ScriptStudioPage`.
**Untouched:** `reelRewrite.ts`, and the v1/v1.1 URL/library remix flow (the creator mode is a parallel branch).

## 9. Phasing (the plan sequences it this way)

1. **Migration + seed + repo/store** (the higher-risk piece — team-shared table + RLS; hard-floor T1+).
2. **`buildCreatorScriptPrompt`** (+ tests) and **`useCreatorScript`**.
3. **`CreatorMode`** directory browse + pick + generate + result.
4. **Inline editor** (anyone can add/remove/edit).
5. **Wire the third mode** into `ScriptStudioPage`.
6. **Verify** (migration applied, suites green; live E2E on Vercel preview).

## 10. Deliberately NOT in v1 (YAGNI)

- Real avatars / follower metrics on cards (needs a profile scrape just to browse — lean cards for v1).
- 3 variations + per-field regenerate for creator mode (single script; those are the URL/library-remix power features).
- Using a creator's own reel as an explicit structural reference (grounding on real transcripts covers it).
- Admin-gated editing / edit history (anyone edits for v1).
- Non-Instagram creators; per-category avatars; ranking creators within a category by live metrics.
