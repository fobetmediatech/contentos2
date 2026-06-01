# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.4.0.0] — 2026-06-02

Content-copilot overhaul: three research tools callable independently by natural language, a conversational content copilot, and deeper HookMap-style reel analysis — on top of a green baseline and a security pass.

### Added

- **Content copilot** — the chat now answers content/strategy questions and *generates* content (hooks, captions, scripts, ideas) via a new `content` intent, with no scraping. Answers are grounded in the session's own research (competitor/discovery accounts and the winning hook archetypes from a reel synthesis) when available. `callGeminiContent` + `buildContentPrompt` + `useConversation.answerContent()`/`buildContentContext()`.
- **Reel/hook analysis as an independent, NL-routable tool** — "analyze @x's hooks" routes to it directly (new `reel` pipelineType + `PIPELINE_REGISTRY` entry). Three discoverable tool chips in the empty state (Find competitors / Discover by city / Break down hooks).
- **Deeper reel analysis** — per-reel `openingLine` (the verbatim hook that stops the scroll) on every card; a "Generate hooks like these for my niche" button on the synthesis card hands the winning archetypes to the content copilot.
- "✦ Gemini" eyebrow on the violet AI-summary bubble (per DESIGN.md).

### Changed

- **Reel pipeline consolidated.** `useReelAnalysis` runs scrape → analyze → synthesize as one awaited sequence with synthesis triggered explicitly (no `creatorStates` effect), so the hook can mount in both `ChatPage` and `useConversation` without double-firing. One `AbortController` per run, aborted on unmount (reel was the only flow with no cancellation). `ReelAnalysisPage` now delegates to the hook instead of duplicating the pipeline.
- **Reel benchmarks computed in code**, not by the LLM — `computeBenchmarks()` derives medianViews / likesViewsRatio / commentsLikesRatio from real metrics (the model was previously asked to do arithmetic and the UI rendered its guesses as precise percentages).
- `addMessage` now stamps the message timestamp inside the store action (callers no longer pass `Date.now()`), clearing the React 19 `react-hooks/purity` errors.
- Raw Tailwind `blue`/`green`/`amber` swapped for the warm `success`/`warning`/`danger` design tokens across the cards (verified badge, ER, copy check, progress step).

### Fixed

- **Build + lint were red; now green.** 11 `tsc` errors (stale test fixtures) and 19 eslint errors fixed; 452 unit tests pass.
- **Bare-handles dead-end.** Pasting handles without `@` (e.g. `nike, adidas`) set the confirming state without a parsed intent, so confirming dead-ended on "Session expired." The fast path now synthesizes a competitor intent.
- Reel synthesis output is coerced/guarded so a missing or mistyped LLM field can't crash the results card.

### Security

- **Gemini API key moved out of the URL** (`?key=`) into the `x-goog-api-key` header at all 5 call sites, via a shared `geminiHeaders()` helper — keys no longer leak to browser history, the devtools Network tab, referrers, or disk cache.
- **Apify error bodies no longer reach the UI.** Error codes map to fixed friendly strings; raw response bodies (which can echo request internals) stay in the DEV console only.
- DEV-gated the Apify request-payload debug log.
- Cross-tab `storage` listener patches only present fields, so a partial write from another tab can no longer wipe the user's keys.
- Reel-analysis failures surface a friendly message instead of the raw error.

## [0.3.0.3] — 2026-06-01

### Fixed

- **Chai Dark design violation** — completion cards (analysis done, discovery done) in `ChatPage` were still using `bg-indigo-100 text-indigo-600` for the bot icon. Now correctly uses `bg-[rgba(224,123,58,0.12)] text-[#E07B3A]` matching every other bot icon in the file.
- **CSS token name mismatch** — `--color-surface-subtle` renamed to `--color-surface-raised` in `tokens.css` to match the name in `tailwind.config.js` and `DESIGN.md`. Previously any component writing `var(--color-surface-raised)` in inline styles would resolve to undefined.
- **Apify error message privacy** — `useLocationDiscovery` was forwarding raw `ApifyError.message` to the chat UI, which can contain run IDs and actor URLs. Now shows a generic message consistent with the competitor pipeline path.
- **Expansion candidate dedup** — dedup set was built from `finalFiltered` (location-filtered subset) rather than `finalCandidates` (full pool). Profiles scraped in the first pass that didn't pass the location filter would be re-added by the expansion pass, sending duplicate handles to Gemini ranking.
- **Expansion hashtag attribution** — expansion-pass `scrapedHashtags` are now merged into `scrapedHashtags` before `setResults`, so `discoveryStore.sourceHashtags` reflects the full set of hashtags used across both passes.
- **Discovery done-card city extraction** — replaced fragile `progressLabel.replace('Discovering creators in ', '')` string parsing with a direct `useDiscoveryStore(s => s.params?.city)` selector. City name now renders correctly when `progressLabel` is set to an expansion detail string.
- **Zod validation retry prompt injection** — the retry prompt for intent parsing was interpolating `result.error.message`, which can contain echoed user content when Gemini produces malformed JSON. Now uses only structural `issue.path: issue.code` pairs, never field values.
- **Expansion dedup set corrected** — built from `finalCandidates` (full scrape pool) not `finalFiltered`, preventing first-pass non-matching profiles from being re-inserted by expansion and skewing Gemini ranking with duplicate entries.
- **Handle length cap** — `@handle` fast-path now validates against `/^[a-zA-Z0-9._]{1,30}$/` (Instagram's 30-char maximum) rather than 50 chars, preventing invalid handles reaching Apify.
- **Border-radius token wiring** — `--radius-sm` (6px), `--radius` (10px), `--radius-lg` (14px) from `tokens.css` are now registered in `tailwind.config.js`'s `borderRadius` extension, so `rounded-sm`/`rounded`/`rounded-lg` utilities emit the design-system values instead of Tailwind defaults.

## [0.3.0.2] — 2026-06-01

### Added

- **Location discovery quality gate** — when a city search finds fewer than 4 location-matched creators, the tool automatically runs a second hashtag batch (excluding already-tried hashtags) to expand the pool before AI ranking. The done card shows a note when expansion ran.
- **Handle fast-path** — when you type `@handle` mentions directly in a message (e.g. "analyze @fitgirl and @delhibakes"), the tool skips the hashtag-discovery Apify run entirely and goes straight to confirming those handles as seeds. Faster and more reliable for direct competitor lookups.
- **Design system** — added `DESIGN.md` as the canonical design source of truth (Chai Dark aesthetic, Instrument Serif + Outfit + DM Mono typography, saffron orange accent).

### Fixed

- Discovery results done-card no longer shows garbled text when expansion ran — expansion detail text is cleared when results are set, so the city name renders correctly.
- Competitor sparse-niche detection now correctly reports when a niche has fewer than 8 discoverable accounts, without conflating "sparse" with "search expanded."
- `@handle` extraction now applies the same 50-character length cap as Gemini's own handle validation, preventing oversized handles reaching Apify.
- Removed stale `console.log` / `console.warn` calls from the quality-gate expansion path.
- `MIN_LOCATION_RESULTS` constant exported from the hook so the done-card copy stays in sync if the threshold ever changes.
- `MIN_COMPETITOR_RESULTS` elevated to module scope for the same reason.

### Changed

- 420 unit tests (up from 377) — added coverage for quality-gate expansion (catch path, dedup merge), handle fast-path (gemini vs client precedence, dedup, 5-handle cap), `setDidExpand` / `stepProgressDetail` store fields, step-6 dynamic labels in `useActivePipeline`, and `hashtagGenerator.excludeHashtags` param.

## [0.3.0.1] — 2026-06-01

### Fixed

- **Intent parser JSON failures** — the chat no longer shows a misleading "Network error" when Gemini returns malformed JSON
  - Added `responseSchema` to the intent API call — enforces valid JSON grammar at the token level, eliminating unquoted keys and trailing commas
  - Added `finishReason === 'MAX_TOKENS'` guard before `JSON.parse` — truncated responses now surface as a clear error instead of a vague `SyntaxError`
  - Disabled thinking mode for intent classification (`thinkingBudget: 0` on gemini-2.5 models) — reduces latency and non-determinism on this simple routing task; guarded so non-2.5 models are unaffected
  - Increased `maxOutputTokens` from 512 → 1024 — headroom for the intent JSON response
  - `SyntaxError` from `JSON.parse` now wraps as `PARSE_ERROR` (not `UNKNOWN`) after all retries are exhausted
  - Chat shows "Gemini returned an unexpected response — try again." instead of the misleading "Network error — check your connection"

### Changed

- **Results page** — "Analyzed N candidate accounts from @handle1, @handle2" header replaces the previous niche + source line, giving a concrete sense of how much data was analysed
- **Competitor summary** — moved into a distinct indigo card above the competitor grid for faster scanning
- **Analysis progress** — live "Found N candidate accounts" detail during the Apify wait phase

## [0.3.0.0] — 2026-06-01

### Added

- **Conversational pipeline UX** — chat input is now active during the confirming state, so users can type their direction instead of only clicking buttons
  - Three-stage handler: pipeline-switch detection → heuristic keyword match (no Gemini call) → Gemini fallback for free-form text
  - `detectPipelineSwitch()` — pure function detecting mid-confirmation intent to switch between competitor and discovery pipelines; exported for testability
  - `heuristicConfirmMatch()` — pure function mapping typed keywords (micro, macro, brands, proceed) to option strings; checks specific options before generic affirmatives to prevent false positives
  - `callGeminiConfirmReply()` — Gemini JSON mode fallback (temp 0, maxTokens 64) with `availableOptions` validation and safe fallback to `options[0]`
  - `buildConfirmReplyPrompt()` — prompt builder with full JSON-safe escaping for user text
  - `isConfirmingPending` state — disables textarea and buttons while Gemini mapping is in-flight, shows `TypingIndicator`
  - Textarea activates during confirming with "Or describe what you want…" placeholder and indigo focus ring
- **Pipeline Registry** (`src/tools/registry.ts`) — centralises `confirmMessage` and `confirmOptions` per pipeline type; `useActivePipeline` hook reads it to compute active pipeline state
- **Richer follow-up context** — `buildFollowUpContext` now accepts account summaries (top 5 found accounts) so Gemini can reference specific handles when answering refinement questions
- **Transparent pipeline routing** — confirm messages now name the pipeline type ("running **competitor analysis**" / "Running **location discovery**") and include a "Wrong pipeline?" hint
- **Inline progress** — pipeline progress steps shown inline in the chat thread; removed separate `ProgressPage`, `DiscoverPage`, `DiscoveryProgressPage`, and `InputPage` — `/analyze` redirects to Chat
- **`routingConfidence` intent field** — Gemini rates routing confidence (`high`/`medium`) for future UX differentiation; `.catch('high')` default keeps prior intents valid

### Fixed

- Intent parser: removed `thinkingConfig` that caused `400 INVALID_ARGUMENT`; added transient-failure retry logic
- Intent parser: null-safe Zod schema guards + correct `GeminiError` argument order
- Competitor prompt: niche derivation block prevents broad-keyword contamination of results
- Blank results page: redirect moved to `useEffect`, guards empty hallucination-filtered output
- Security: sanitize scraped Apify usernames before Gemini prompt injection; `buildConfirmReplyPrompt` uses `JSON.stringify` escaping (handles backslashes, control chars)
- Regex hardening: `detectPipelineSwitch` no longer uses unbounded `find.*creator` wildcard (false positive on "find the right macro creator"); `\banalysis\b` removed from discovery→competitor trigger (false positive on "thanks for the analysis!")
- Zombie AbortController: follow-up path now cancels the previous in-flight request before starting a new one
- Stuck UI on back-navigation: mount effect now resets `discovering`/`confirming`/`running`/`clarifying` states left behind when navigating away mid-pipeline
- Silent no-op in confirming path: null/clarification `parsedIntent` guard now shows an error message instead of silently dropping back to chatting
- DRY: extracted `GEMINI_KEY_MISSING_MSG` constant to `constants.ts` (three occurrences unified)

### Tests

- 365 unit tests across 17 test files (up from 61 at v0.1.0)
- `conversationalUX.test.ts` — 52 tests for `detectPipelineSwitch` and `heuristicConfirmMatch` including regression tests for the CRITICAL ORDER constraint (specific options before generic affirmatives)
- `useActivePipeline.test.ts` — 45 tests for pipeline state computation, precedence, and `progressLabel` fallbacks
- `registry.test.ts` — 23 tests for `PIPELINE_REGISTRY` shape and invariants
- `prompts.test.ts` — extended with `buildConfirmReplyPrompt` and `buildFollowUpContext` coverage including prompt-injection sanitization

## [0.2.0] — 2026-05-27

### Added

- **Location Discovery** — new `/discover` flow: city + niche → AI-ranked top 10 creator cards
  - `DiscoverPage` — city/niche form with depth toggle (Standard / Deep), optional client name
  - `DiscoveryProgressPage` — 5-step progress view (hashtag gen → hashtag scrape → profile scrape → location filter → AI insights)
  - `DiscoveryResultsPage` — Top 5 / Trending 5 sections with location filter relaxed banner
  - `DiscoveryCard` — creator card with specialties chips, location confidence badge (confirmed / likely / unknown), content focus, partnership-ready signal
- **hashtagGenerator** (`src/lib/hashtagGenerator.ts`) — Gemini micro-call to generate 5–8 location-aware hashtags; template-based rule fallback when Gemini is unavailable
- **locationFilter** (`src/lib/locationFilter.ts`) — bio-text city matching with alias map (Mumbai/Bombay, Bangalore/Bengaluru, Delhi/NCR, etc.); auto-relaxes when fewer than 15 profiles pass
- **discoveryClient** (`src/lib/discoveryClient.ts`) — hashtag scrape → dedup → profile scrape (cap 60) → location filter pipeline; pLimit(3) concurrency
- **apifyCore** (`src/lib/apifyCore.ts`) — extracted shared Apify primitives (startRun, pollRun, fetchDataset, sleep, chunk, ApifyError) so both pipelines can reuse them without coupling
- **Discovery Gemini analysis** (`src/ai/gemini.ts`) — `analyzeDiscovery()` with niche-agnostic schema: specialties[], contentFocus, partnershipReady, locationConfidence
- **Discovery prompts** (`src/ai/prompts.ts`) — `buildDiscoveryPrompt()` and `DiscoveryResult` / `DiscoveryOutput` types
- **discoveryStore** (`src/store/discoveryStore.ts`) — Zustand store for discovery state (results, candidateProfiles, locationFilterRelaxed, sourceHashtags)
- **useLocationDiscovery** (`src/hooks/useLocationDiscovery.ts`) — TQ mutation with 150s timeout, hallucination filter, zero-result retry without city/niche context
- **Discovery export** — `formatDiscoveryForClipboard`, `generateDiscoveryCSV` (rank, category, username, followers, ER, verified, specialties, content_focus, partnership_ready, location_confidence, rationale, city, niche, source_hashtags)
- **DISCOVERY_CATEGORIES** (`src/shared/utils/categories.ts`) — discovery-context taxonomy alongside existing COMPETITOR_CATEGORIES
- **Test script** (`scripts/test-discovery.mjs`) — 8-gate integration test (hashtag gen, rule fallback, scraper field check, profile normalization, location filter accuracy, pipeline timing < 120s, yield gate ≥3 profiles, AI schema validation)

### Fixed

- **Discovery crash on null array fields** (`src/ai/gemini.ts`) — `parseDiscoveryOutput` now coerces per-item fields (`specialties`, `contentFocus`, `rationale`, `rank`) before returning; Gemini can return `null` for array-typed properties even with a responseSchema
- **Discovery prompt over-constrains result count** (`src/ai/prompts.ts`) — changed "Always return exactly 10" → "Return up to 10" in `buildDiscoveryPrompt`; the previous instruction forced Gemini to hallucinate handles to fill 10, which then failed the hallucination filter leaving fewer results than expected
- **Deep scan timeout overflow** (`src/lib/discoveryClient.ts`) — reduced `EXPANSION_CAP` 40 → 20; worst-case budget was ~165s against the 150s AbortController timeout
- **`onError` navigation conflict in DiscoverPage** (`src/pages/DiscoverPage.tsx`) — removed redundant `onSuccess`/`onError` TanStack Query callbacks; navigation is handled by `DiscoveryProgressPage` via its `useEffect` on store status
- **Double-click race in ClarificationCard** (`src/components/ClarificationCard.tsx`) — added `disabled?: boolean` prop; option buttons now disable immediately after first click (wired from `isPending` in `ProgressPage`)
- **Hashtag injection sanitization** (`src/lib/hashtagGenerator.ts`) — Gemini-returned hashtags now stripped of non-`[\w]` chars and capped at 30 characters (Instagram hashtag rules)
- **Prompt injection via clarification newlines** (`src/ai/prompts.ts`) — `trimmedClarificationAnswer` now strips internal `\n`/`\r` before prompt injection
- **Zero-result retry still passed city/niche context** (`src/hooks/useLocationDiscovery.ts`) — retry now passes `''` for both city and niche (was incorrectly passing `safeCity`/`safeNiche`)
- **Firefox CSV download silent fail** (`src/shared/utils/export.ts`) — anchor element now appended to DOM before `.click()` and removed after; `revokeObjectURL` delayed 100ms for Firefox download initiation
- **clientName input unsanitized** (`src/pages/DiscoverPage.tsx`) — `onChange` now strips non-`[\w\s-]` chars; added `maxLength={100}`
- **Depth toggle buttons not keyboard-accessible** (`src/pages/DiscoverPage.tsx`) — added `focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-none` to toggle button classes

### Changed

- **AppLayout** — added "Discover" nav link (MapPin icon, teal active state); app name updated to "Content OS 2.0"
- **App.tsx** — added `/discover`, `/discover/progress`, `/discover/results` routes
- **ProgressSteps** — `currentStep` widened to `number`; added optional `steps?: string[]` prop for custom step labels (backward-compatible)
- **apifyClient** — refactored to import from `apifyCore` instead of duplicating shared primitives
- **package.json** — added `test:discovery` script

## [0.0.0] — Initial release

- Competitor analysis flow: handle input → Apify scrape (3 rounds + hashtag expansion) → Gemini analysis → ranked results
- Settings page for Gemini API key + up to 10 Apify keys (all stored in localStorage, no .env)
- Export: clipboard (formatted text) + CSV download
