# Voice-profile warmer (Phase 2) — proactive background pre-building

**Date:** 2026-07-14
**Status:** Design approved (pending written-spec review)
**Owner:** Aditya
**Context:** Phase 2 of the perf effort. Makes Creator Voices feel instant at 100+ directory creators by building their voice profiles in the background *before* anyone picks them. Independent of Phase 1 (PR #81) — the warmer reuses the pre-existing `/api/get-transcript`, not Phase 1's client helper. See [[project_perf_roadmap]].

## 1. Summary

A secret-gated **Vercel serverless endpoint** (`api/warm-voice-profile.ts`), fired by **Vercel Cron** every ~10 min, that builds voice profiles for directory creators who don't have one yet — a few per run, rate-limited, backoff-aware. Because `corpus_voice_profiles` is team-shared and voice is stable, each creator is built **once, ever**; the cron drips through the 20→100+ backlog and catches new adds within minutes.

### Locked decisions
- **Runtime: Vercel serverless (Node)** — reuses the app's tested `getTranscript` + `geminiFiles` + the pure voice-profile prompt, instead of a Deno reimplementation.
- **Trigger: Vercel Cron** (endpoint is trigger-agnostic → a GitHub Action is a drop-in fallback if on the Hobby plan; see §9).
- **Pacing: 1–2 handles per invocation, sequential** (stays well under the 300s function limit; bounds Apify load).
- **Backoff via a small migration** (2–3 columns on `creator_directory`) so a bad handle doesn't retry forever.
- **Reel count = the same `PROFILE_REEL_COUNT` (8)** as the client build.

## 2. Architecture — `api/warm-voice-profile.ts`

`export const config = { maxDuration: 300 }`. Per invocation:

1. **Auth (fail closed):** verify `Authorization: Bearer $CRON_SECRET`. No Clerk — there is no user. Non-match → 401.
2. **Supabase service-role client:** `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })` — bypasses RLS to read the directory + write profiles.
3. **Pick 1–2 handles** (pure, unit-tested selector — §5): directory rows with **no** `corpus_voice_profiles` entry, not in backoff, oldest-attempt-first.
4. **For each handle (sequential):**
   a. **Scrape reels** — Apify `apify~instagram-scraper`, input `{ directUrls: ['https://www.instagram.com/<handle>/'], resultsType: 'posts', resultsLimit: 8 }`, via `run-sync-get-dataset-items` → reel items (shortCode, url, caption, metrics).
   b. **Resolve video URLs** — Apify `apify~instagram-reel-scraper`, input `{ username: [reelUrls], includeDownloadedVideo: true }`, run-sync → shortCode → `downloadedVideo` URL.
   c. **Transcribe** — `getTranscript({ downloadedVideoUrl, shortCode }, geminiKey)` (REUSED from `api/get-transcript.ts`) per reel, capped-parallel → transcripts.
   d. **Synthesize** — `geminiGenerateJson(buildVoiceProfilePrompt(handle, transcripts, captions), VOICE_PROFILE_SCHEMA, geminiKey)` → `parseVoiceProfile(raw, { handle, displayName, reelCount, builtAt, fromScripts: false, exemplars: pickExemplars(transcripts) })`.
   e. **Upsert** — `corpus_voice_profiles` (`onConflict: 'handle'`): `{ handle, owner_user_id: 'system:warmer', display_name, voice_data: profile, reel_count, updated_at }`.
   f. **Record the attempt** on `creator_directory` (§4): success → clear backoff; failure (no reels / bad handle / scrape error) → `warm_attempts += 1`, `warm_last_attempt_at = now`, `warm_last_error = <code>`.
5. Return `{ warmed: string[], failed: string[], skipped: number }` (booleans/counts only — never research-target data in logs, per C3).

## 3. Reused vs new

**Reused (no duplication):** `getTranscript` (exported from `api/get-transcript.ts`), `api/_lib/geminiFiles.ts`, `@supabase/supabase-js`, the server Apify + Gemini key envs (`APIFY_KEY_N`/`APIFY_KEYS`, `GEMINI_API_KEY`/`GEMINI_KEYS`).

**New:**
- `api/warm-voice-profile.ts` — the handler + orchestration.
- `api/_lib/voiceProfilePrompt.ts` — a **copy** of the pure pieces from `src/ai/prompts/voiceProfile.ts` (`buildVoiceProfilePrompt`, `VOICE_PROFILE_SCHEMA`, `parseVoiceProfile`, `VoiceProfile` type, `VOICE_PROFILE_PROMPT_VERSION`) + `pickExemplars` (from `src/lib/repurposeHelpers.ts`). The api/ boundary can't import `src/` at runtime (self-contained ESM), so this is the one duplication — guarded by a drift test (§8).
- `api/_lib/apifyRun.ts` — `runApifyActorSync<T>(actorId, input, apifyKeys): Promise<T[]>` (Node port of `tracking-cron`'s Deno `apifyRunSync`: `run-sync-get-dataset-items` + round-robin key failover) + `getApifyKeys()` from `process.env`.
- `api/_lib/geminiJson.ts` — `geminiGenerateJson(prompt, schema, apiKey): Promise<unknown>` (text→JSON via `responseMimeType: 'application/json'` + `responseSchema`, mirroring `get-transcript`'s inline call).
- migration: backoff columns (§4).
- `vercel.json` (or `vercel.ts`): a `crons` entry.

## 4. Backoff migration

Without failure state, a wrong seed handle would be re-scraped every 10 min forever and block the queue. Add to `creator_directory`:
```sql
alter table creator_directory
  add column if not exists warm_attempts       int         not null default 0,
  add column if not exists warm_last_attempt_at timestamptz,
  add column if not exists warm_last_error      text;
```
No new RLS policy — the existing `select` policy already exposes the columns to the app (read-only badges later, optional); only the **service-role warmer** writes them (bypasses RLS). Client edits (add/remove) are unaffected. Apply via the SQL editor + `migration repair --status applied` (per [[project_supabase_migration_workflow]]).

**Eligibility (the selector):** a handle is warmable when it has **no** `corpus_voice_profiles` row AND `warm_attempts < 5` AND (`warm_last_attempt_at IS NULL` OR `warm_last_attempt_at < now − 24h`). Order by `warm_last_attempt_at ASC NULLS FIRST` (never-tried first). This is computed in a **pure selector** over the fetched rows (Supabase-JS has no easy anti-join; two small reads + a JS diff at ≤200 rows is fine) so it's unit-testable.

## 5. Server-side pieces (how each works)

- **Apify:** `run-sync-get-dataset-items` (`POST https://api.apify.com/v2/acts/<actorId>/run-sync-get-dataset-items?token=<key>`) — blocks until the actor finishes and returns dataset items in one call (simpler than the app's start/poll/fetch dance; latency is fine off the user path). Key pool + round-robin failover on 401/402/403/408/429/5xx, ported from `tracking-cron`.
- **Gemini:** transcription via the reused `getTranscript`; synthesis via the new small `geminiGenerateJson`. Both pull a key with the `process.env.GEMINI_API_KEY`/`GEMINI_KEYS` pattern.
- **Supabase:** service-role client; read `creator_directory` + existing `corpus_voice_profiles` handles; upsert profiles + update backoff columns.

## 6. Secrets / env (Vercel)

New server-side vars: **`CRON_SECRET`** (Vercel auto-attaches it to Cron requests), **`SUPABASE_SERVICE_ROLE_KEY`**, and **`SUPABASE_URL`** (server-side; the browser uses `VITE_SUPABASE_URL`). Existing: `APIFY_KEY_N`/`APIFY_KEYS`, `GEMINI_API_KEY`/`GEMINI_KEYS`.

## 7. Edge cases

| Case | Behavior |
|---|---|
| Bad/deleted/private handle, or no reels | Record failure + backoff (retry ≤ daily, stop after 5 attempts) — never blocks the queue |
| Handle already has a profile | Skipped (the anti-join) |
| A run risks exceeding 300s | Capped at 1–2 handles/run |
| Apify pool rate-limited (402/429) | Round-robin failover; if all keys cool, that handle fails-soft → backoff |
| Concurrent crons (overlap) | Idempotent: upsert on `handle`; worst case two runs warm the same handle once each |
| Migration not applied | The `warm_*` columns are missing → the endpoint 500s cleanly; nothing else breaks (the app doesn't depend on the warmer) |

## 8. Testing

- **Pure selector** (`pickHandlesToWarm(directoryRows, existingProfileHandles, now, opts)`): unit-test — excludes already-profiled, excludes backoff (recent-fail / max-attempts), orders oldest-first, respects the batch cap.
- **Copy-drift guard:** a test importing BOTH `src/ai/prompts/voiceProfile.ts` and `api/_lib/voiceProfilePrompt.ts` (tests may cross the boundary) asserting `VOICE_PROFILE_PROMPT_VERSION` + `VOICE_PROFILE_SCHEMA` match — fails loudly if the copy drifts.
- **`geminiGenerateJson` / `runApifyActorSync`:** unit-test their pure request-body/response-parse helpers where extractable.
- **End-to-end warm:** manual on a Vercel preview (needs the migration + the 3 env vars + a real handle) — trigger the endpoint with the secret, confirm a `corpus_voice_profiles` row appears and Creator Voices shows that creator as instant. Flagged (not runnable in-sandbox).

## 9. Ops / deploy

1. Apply the backoff migration (SQL editor + `migration repair --status applied`).
2. Add Vercel env: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`.
3. Ship the `vercel.json` cron. **Cadence depends on plan:** Pro → `*/10 * * * *`; **Hobby → Vercel Cron is once/day**, so instead point a **GitHub Action** (clone `tracking-cron.yml`, every N min, `curl` the endpoint with `Bearer $CRON_SECRET`) — the endpoint is identical.
4. Seed-handle verification ([[project_pending_todos]]) pays off here: wrong handles just burn 5 backed-off attempts then stop.

## 10. Out of scope (deliberate)

- Client "warm-on-add" ping (the cron catches new adds within minutes — simpler; add later only if minutes-latency matters).
- Refreshing/rebuilding existing profiles (voice is stable; build-once).
- A UI for warm-status/badges (the `warm_*` columns are there if wanted later).
- Warming non-directory handles.
- Deno/Edge runtime (Vercel serverless chosen).
