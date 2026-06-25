# Repurpose Reel — Design Spec

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan
**Feature:** Repurpose any viral reel into a client's tone.

## 1. Goal

Operator gives (1) a viral source reel URL and (2) a client identity. The app returns
the viral reel's content rewritten in that client's voice, preserving the source reel's
structure beat-for-beat — a full, shoot-ready package plus alternate hooks.

This is a fourth conversational pipeline alongside Competitor Analysis, Location
Discovery, and Reel Hook Analysis. It follows the documented "Adding a new pipeline"
extension conventions exactly.

## 2. User-facing behavior

**Trigger (chat):** *"Repurpose https://instagram.com/reel/XXXX for @client"*

- Source = a reel URL (required).
- Client identity = an IG `@handle` (primary) **or** 2-3 pasted scripts/captions (fallback).
- If neither identity is supplied, the agent asks a clarification (existing repair flow) —
  it must NOT hallucinate a handle.

**Output (inline result card):** a full reel package mapped to the source reel's structure:

- Rewritten **spoken hook** (the verbatim opening line, in the client's voice)
- **Beat-by-beat script** (same beat count + functions as the source; only the words/energy change)
- **Caption**
- **CTA**
- **On-screen text** suggestions
- **3 alternate hook variants** for A/B testing

Per-section copy buttons; a collapsed voice-profile mini-card with an "Edit on Memory" link.

**Voice profiles** are saved to the shared team corpus and managed on a new **Voices** tab
in the Memory page (browse, select, full inline edit, rebuild, rename).

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Tone source (primary) | Client `@handle` → scrape + transcribe their reels → synthesized voice profile |
| Tone source (fallback) | Paste 2-3 of the client's scripts/captions |
| Output | Full package (hook, beat script, caption, CTA, on-screen text) **+ 3 hook variants** |
| Profile reuse | Saved to shared corpus; browsable/editable on Memory |
| Memory edit depth | **Full inline field editing** + rebuild + rename |
| Edit rights (RLS) | **Any authenticated teammate** can edit/rebuild; everyone can read all |
| Reels analyzed per profile | **8** (cached after first build → repeat clients free) |
| Source reel structure | Single endpoint — reuse `/api/analyze-single-reel` `SingleReelResult` |
| Result persistence | Conversation snapshot only (no corpus harvest of packages) |
| No public reels (NoReelsError) | Fall back to pasted scripts; else user-safe error |

## 4. Architecture & components

**Zero new server code.** One existing video endpoint serves both reel paths; the rewrite
is pure text through the existing `/api/gemini` proxy.

- **Agent layer** (`src/tools/agentTools.ts`): add `repurpose_reel` to `AgentToolName`,
  the `AgentAction` dispatch union, `TOOL_REGISTRY` (declaration + zod + `toAction`), and one
  `AGENT_SYSTEM_PROMPT` routing line.
- **Dispatch** (`src/hooks/useAgentConversation.ts`): one `if (name === 'repurpose_reel')`
  branch in `dispatchTool()` that tags the run to the active conversation, adds a progress
  marker message, and calls `startRepurpose(args, signal)`.
- **State** (`src/store/repurposeStore.ts`): transient run state (version:1, supabaseStorage,
  identity migrate, merge-drop guard for interrupted runs). `corpusStore` extended with a
  `voiceProfiles` map.
- **Corpus** (`corpus_voice_profiles` table + `CorpusRepository` methods, implemented in
  `supabaseCorpus.ts`).
- **AI** (`src/ai/prompts/voiceProfile.ts`, `src/ai/prompts/reelRewrite.ts`): pure
  prompt + schema + coercion-guard modules.
- **Pipeline hook** (`src/hooks/useRepurposeReel.ts`): orchestrates the 3 stages.
- **Result render** (`src/components/RepurposeResultMessage.tsx`): inline, snapshotted via
  `addMessageTo`.
- **Memory** (`src/pages/MemoryPage.tsx` Voices tab + `src/components/VoiceProfileCard.tsx`).

## 5. Data flow

1. **Chat → tool.** `runAgentTurn` → Gemini → `repurpose_reel`. The zod schema canonicalizes
   the URL via `parseReelUrl()` (refine: valid shortCode) and normalizes the handle via
   `normalizeHandles()` (refine: handle OR scripts present).
2. **Dispatch.** Tag `repurposeStore` to `useConversationsStore.getState().activeId`, add a
   `type:'repurpose'` marker message, call `startRepurpose(args, signal)`.
3. **Stage 1 — Voice profile.** `corpus.getVoiceProfile(handle)`:
   - HIT → reuse, skip build.
   - MISS → `scrapeTopReels(handle, 8, apifyKeys, signal)` → `transcribeReels(handle, reels,
     apifyKeys, signal)` (cache-first; returns `Record<shortCode, transcript>`; shared cache
     with single-reel/reel-hook features). Captions collected from the in-memory `ReelData[]`.
     → `callGeminiWithSchema<VoiceProfile>(geminiKeys, buildVoiceProfilePrompt(...),
     VOICE_PROFILE_SCHEMA, { temperature: 0.2, thinkingBudget: 2000, signal })`.
     → `corpus.upsertVoiceProfile(handle, profile)` + mirror into `corpusStore`.
   - NoReelsError → pasted-scripts path if provided, else user-safe error.
4. **Stage 2 — Source structure.** Mirror `useSingleReelAnalysis`: `getCachedSingleReel(shortCode)`
   hit, else `scrapeSingleReel` → POST `/api/analyze-single-reel` (Clerk Bearer, 401-retry-once)
   → `SingleReelResult` → `setCachedSingleReel`.
5. **Stage 3 — Rewrite.** `callGeminiWithSchema<ReelRewriteResult>(geminiKeys,
   buildReelRewritePrompt(sourceResult, profile), REEL_REWRITE_SCHEMA,
   { temperature: 0.7, thinkingBudget: 3000, signal })`.
6. **Snapshot.** A ChatPage `useEffect` watching terminal status (mirrors the reel snapshot
   ~`ChatPage.tsx:373`) calls `addMessageTo(repurposeConversationId, { type:'result', result:{
   kind:'repurpose', sourceReelUrl, clientHandle, voiceProfile, rewrite } })`, then
   `repurposeStore.reset()`.
7. **Render.** ChatPage: `message.result?.kind === 'repurpose'` → `<RepurposeResultMessage>`.
   Persisted → survives reload, immune to store reset.

`AbortSignal` is checked after every async hop (latest-wins steering, matching existing hooks).

## 6. Voice profile

**Fields** (`VoiceProfile`, stored as `voice_data` jsonb):

- `handle` (code-attached) / `displayName` (user-editable)
- `vocabulary` — signature words/phrases, formality, slang/jargon markers
- `sentenceRhythm` — pacing: short-punchy vs long-discursive; typical words-per-beat
- `audienceAddress` — direct "you" vs "we" vs third-person; intimacy level
- `toneDescriptors` — 3-6 adjectives
- `hookHabits` — 3-5 recurring opening patterns (templated)
- `emotionalRegister` — primary emotions + arc (e.g. humor → urgency → validation)
- `structuralPattern` — hook → body → CTA template shape
- `personaConsistencyScore` — 1-10, how consistent the voice is across the corpus
- `reelCount` (code-attached), `builtAt` (epoch ms, code-attached)

**Build (from @handle):** `scrapeTopReels(handle, 8)` → `transcribeReels()` → captions → one
Gemini synthesis call. Repeat clients hit the shared transcript cache → zero Apify cost.

**Build (from pasted scripts, fallback):** skip scrape/transcribe; split scripts on a
delimiter; **sanitize + cap at 4000 chars** before prompt injection. If a handle is also
given, key by handle; otherwise require a `displayName` and key by a synthetic
`__scripts__<slug>` with a "From scripts" badge on the Memory card.

**Caching / staleness:** cache-first by PK lookup; no TTL. `builtAt` + `reelCount` surface
staleness on the card. Explicit **Rebuild** is the only invalidation.

## 7. Corpus + Memory model

**New table `corpus_voice_profiles`** (migration `20260625000000_voice_profiles.sql`):

- `handle text PRIMARY KEY`
- `owner_user_id text NOT NULL` (Clerk `sub` — records who first built it)
- `display_name text`
- `voice_data jsonb NOT NULL` (the full `VoiceProfile`)
- `reel_count int`
- `created_at`, `updated_at timestamptz`
- index on `owner_user_id`
- **RLS:** SELECT for all authenticated (team-wide reuse); INSERT/UPDATE for all authenticated
  (any teammate can edit/rebuild — per locked decision). `owner_user_id` is retained as
  provenance, not an edit gate.

> Rejecting `corpus_content` reuse is deliberate: `corpus_content.kind` is the frozen `'reel'`
> discriminant with a non-null `creator_username` FK. A voice profile is a client-identity
> asset, not creator-analyzed content; reuse would force nullable FKs, kind-filtering across
> `listAllContent` callers, and leak profiles into the reel gallery.

**Repository** (`CorpusRepository` in `corpus.ts`, implemented in `supabaseCorpus.ts` following
the `setFeedback()` pattern): `upsertVoiceProfile(handle, profile)`, `getVoiceProfile(handle)`,
`listVoiceProfiles()`. `getClerkUserId()` null → throw "Sign in to save voice profiles" before
any insert (prevents NOT NULL violation); best-effort failures `devWarn`.

**Store** (`corpusStore`): add `voiceProfiles: Record<string, VoiceProfile>`, hydrate via
`repo.listVoiceProfiles()` inside the existing `hydrate()` `Promise.all` (no 200-cap; profiles
are few), and a `setVoiceProfile()` write-through.

**Memory UI** (`MemoryPage.tsx`): one `useState<'creators'|'voices'>` tab (Creators unchanged).
Voices tab renders a grid of `VoiceProfileCard`. **Full inline per-field editing** reuses the
`PaymentClientsManager` local-form-state + `.inputCls` pattern (bg `#3D3025`, saffron focus).
Save + Rebuild available to any authenticated user.

## 8. Rewrite prompt strategy

`buildReelRewritePrompt(source: SingleReelResult, voice: VoiceProfile)`:

- **SOURCE block** from `source.videoAnalysis.visual_beats[]` (t_start/t_end/on_screen/function
  — the beat skeleton), `source.segments[]` (verbatim spoken hook = first segment),
  `source.transcript`, and `source.markdown` (hook mechanic + pacing + CTA analysis).
- **VOICE block** — every `VoiceProfile` field as a named section.
- **Instruction:** "Preserve the source's beat structure exactly (same beat count, same beat
  functions, same CTA placement). Replace ONLY words and energy to match this voice — never
  copy the source's wording. Every line must pass: could @handle have said this?"
- **Output** `REEL_REWRITE_SCHEMA` → `ReelRewriteResult { spokenHook, beatScript:
  {beatLabel, script, onScreenText}[], caption, cta, onScreenText: string[],
  altHooks: [string, string, string] }`.

Text-in/text-out via `callGeminiWithSchema` and the existing `/api/gemini` proxy. No video
bytes, no new server code.

## 9. Agent / chat wiring

- **Tool zod:** `{ sourceReelUrl, clientHandle?, pastedScripts? }`; `.transform` runs
  `parseReelUrl`; `.refine` requires a valid shortCode; `.refine` requires handle OR scripts.
- **`toAction`:** `(args) => ({ type:'dispatch', name:'repurpose_reel', args })`.
- **Result:** SNAPSHOT pattern (terminal-status `useEffect` → `addMessageTo` → reset), like
  reel/competitor/discovery. The dispatch-time marker drives only the in-flight progress block.
- **`PIPELINE_REGISTRY`** (`registry.ts`): add a `'repurpose'` entry with step labels
  (e.g. "Building voice profile" → "Analyzing source reel" → "Rewriting in client's voice").
- **New `ResultPayload` kind** `'repurpose'` (frozen once shipped) in `src/domain/chat.ts`.

## 10. New files

| Path | Purpose |
|---|---|
| `supabase/migrations/20260625000000_voice_profiles.sql` | `corpus_voice_profiles` table + index + RLS |
| `src/ai/prompts/voiceProfile.ts` | `VoiceProfile` type, `VOICE_PROFILE_SCHEMA`, `buildVoiceProfilePrompt`, `parseVoiceProfile` guard |
| `src/ai/prompts/reelRewrite.ts` | `ReelRewriteResult` type, `REEL_REWRITE_SCHEMA`, `buildReelRewritePrompt`, `parseReelRewrite` guard |
| `src/store/repurposeStore.ts` | Transient run store (version:1, supabaseStorage, merge-drop guard). Fields: `sourceReelUrl`, `clientHandle`, overall `status: 'idle'\|'building-profile'\|'analyzing-source'\|'rewriting'\|'done'\|'error'`, `voiceProfile`, `rewrite`, `conversationId`, `error` + setters + `reset` |
| `src/hooks/useRepurposeReel.ts` | 3-stage pipeline orchestrator |
| `src/components/RepurposeResultMessage.tsx` | Inline result renderer for `kind:'repurpose'` |
| `src/components/VoiceProfileCard.tsx` | Memory Voices card with inline edit + rebuild |

## 11. Reused infra (no changes beyond noted edits)

- `parseReelUrl()` — `src/lib/reelUrl.ts`
- `normalizeHandles()` — `src/tools/agentTools.ts`
- `scrapeTopReels()` — `src/lib/reelScraper.ts`
- `transcribeReels()` — `src/lib/reelTranscriber.ts` (client path; shared cache)
- `useSingleReelAnalysis` body + `scrapeSingleReel` — source path → `/api/analyze-single-reel`
- `getCachedSingleReel` / `setCachedSingleReel` — `src/lib/singleReelCache.ts`
- `callGeminiWithSchema()` — `src/ai/gemini.ts` (synthesis @0.2/2000, rewrite @0.7/3000)
- `getClerkSessionToken()` / `getClerkUserId()` — `src/lib/clerkToken.ts`
- `supabase` client — `src/lib/supabaseClient.ts`
- `CorpusRepository` + `createSupabaseCorpus` — `src/lib/corpus.ts` / `src/lib/supabaseCorpus.ts`
- `makeCorpusStore` / `useCorpusStore` — `src/store/corpusStore.ts`
- `addMessageTo` + ChatPage snapshot `useEffect` — `src/store/conversationsStore.ts` / `ChatPage.tsx`
- `supabaseStorage` — `src/store/supabaseStorage.ts`
- `reelPersist` `isCleanReelRun` pattern — `src/store/reelPersist.ts` (mirrored merge guard)
- `PaymentClientsManager` inline-edit pattern + `.inputCls` — Memory edit form
- `PIPELINE_REGISTRY` — `src/tools/registry.ts`

## 12. Error handling

- NoReelsError → scripts fallback, else user-safe message ("This account has no public reels —
  paste 2-3 of their scripts instead").
- `/api/analyze-single-reel` 401 → retry once with fresh token (existing pattern); non-ok →
  `devWarn` + generic user error (never raw API bodies — `errorMessages.ts`).
- `AbortSignal` checked after every async hop.
- `getClerkUserId()` null → throw user-facing error before any insert.
- Pasted scripts sanitized + length-capped (4000 chars) before prompt injection.
- `repurposeStore` merge guard drops any restored run where `status !== 'done' || !rewrite`.

## 13. Testing / eval

- **`agentLoop.eval.test.ts`** (required by conventions): (1) URL + `@handle` → dispatch
  `repurpose_reel`; (2) URL only, no identity → `ask_clarification` (not a hallucinated handle).
- **Unit:** `parseVoiceProfile` / `parseReelRewrite` coercion guards; `repurposeStore` merge
  guard drops an interrupted run; zod refine rejects missing identity.
- **Deserialization fixture:** asserts `kind === 'repurpose'` is stable (frozen-discriminant).
- **Corpus:** voice-profile methods tested against the in-memory repo via the existing
  `makeCorpusStore` factory seam.

## 14. Out of scope (YAGNI)

- No new `/api/analyze-reel-video` / `DeepReelAnalysis` path for the source reel.
- No corpus harvest of generated repurpose packages (conversation snapshot only).
- No TTL-based auto-rebuild (explicit Rebuild only).
- No video generation / editing — text package only.
- No per-profile version history.

## 15. Defaults resolved

- Source structure: single endpoint (`analyze-single-reel`).
- Reel count: 8.
- Edit depth: full inline.
- Edit rights: any authenticated teammate.
- Result persistence: conversation-only.
- Pasted-scripts key: handle if given, else `__scripts__<slug>` requiring a display name.
