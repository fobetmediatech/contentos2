# Content OS 2.0 — Code Audit Findings

Read-only audit. Scope: `src/` (pages, hooks, ai, ai/prompts, lib, store, tools, components, shared), config, root docs. Build + lint + test were run and captured.

**Build/Test status at audit time**
- `npx tsc -b` → **11 errors** (all in test fixtures except 1 in `ChatPage.tsx`). Exit 2.
- `npx eslint .` → **19 errors, 0 warnings**. Exit 1.
- `npx vitest run` → **446 passed / 27 files**, 0 failures. (Vitest uses esbuild, which ignores `noUnusedLocals`, so the tsc test-file errors don't fail the suite.)

Severity counts: **Critical 3 · High 11 · Medium 16 · Low 12** (42 findings).

---

## CRITICAL

### C1 — Gemini API key sent as a URL query parameter (key leakage)
- **Severity:** Critical
- **Where:** `src/ai/gemini.ts:114` (`?key=${apiKey}`), `src/ai/gemini.ts:453`, `src/ai/intentParser.ts:81`, `src/lib/hashtagGenerator.ts:118`, `src/pages/SettingsPage.tsx:31`
- **What:** Every Gemini call puts the raw API key in the URL. URLs land in browser history, devtools Network tab, disk cache, extension hooks, and any proxy/referrer logs. This is the standard Gemini REST pattern but it is the highest-exposure surface in a browser-only app where the user's own key is the only secret.
- **Fix:** Send the key via the `x-goog-api-key` request header instead of the `?key=` query param (Gemini supports both); keeps it out of URLs/history.

### C2 — Apify raw error bodies forwarded to the UI (URL/internal leakage + key-fragment risk)
- **Severity:** Critical
- **Where:** `src/lib/apifyCore.ts:89` (`Failed to start actor run: ${res.status} ${body}` where `body = await res.text()`), surfaced via `useCompetitorAnalysis.ts:218` (`Scraping error (${err.code}): ${err.message}`) and shown in a chat bubble.
- **What:** `startRun`/`pollRun` embed the full Apify response text into `ApifyError.message`, and `buildErrorMessage` (competitor) forwards `err.message` verbatim to the chat. Apify error bodies can echo the request (actor IDs, the directUrls/usernames you sent) and other internal detail straight into the user-facing UI. `useConversation.runCompetitorDiscovery` (line 254-256) and `useLocationDiscovery` (line 205) correctly use generic messages — but the competitor *analysis* path (`useCompetitorAnalysis`) does not, so the protection is inconsistent.
- **Fix:** Never interpolate `ApifyError.message` into UI text; map `err.code` → a fixed friendly string in `buildErrorMessage` (as the discovery hook already does). Keep raw bodies in `console` only.

### C3 — `console.debug` logs full Apify request payloads on every run
- **Severity:** Critical (defense-in-depth / data exposure)
- **Where:** `src/lib/apifyCore.ts:70` (`console.debug('[apify] POST', url, input)`)
- **What:** Logs the request body for every actor start. Combined with C1 (Gemini key in URL), production console output contains scraped handles, target URLs, and (for Gemini) the key in the URL string. Browser-only app → these logs are on the end-user's machine and in any error-reporting capture.
- **Fix:** Remove or gate behind `import.meta.env.DEV`; never log full `input`.

---

## HIGH

### H1 — `useConversation` mutates Zustand and calls `Date.now()` during render (impure, 7 lint errors)
- **Severity:** High
- **Where:** `src/hooks/useConversation.ts` lines 337, 343, 360, 380, 396, 415, 434 (lint rule `react-hooks/purity`)
- **What:** `sendMessage`/`confirmSeeds` call `store.addMessage(...)` with `timestamp: Date.now()` synchronously inside the hook body's call path. React 19's hook purity rule flags `Date.now()` as impure-in-render. While these execute inside event-driven async callbacks (not literally the first render), the lint engine cannot prove that and the pattern is fragile under React's concurrent re-invocation. Unstable timestamps also feed the React `key` (`${message.timestamp}-${i}`) in `ChatPage.tsx:297`.
- **Fix:** Capture `const now = Date.now()` once at the top of the event handler (or have the store stamp `timestamp` itself in `addMessage`), so render-path code never calls the impure function.

### H2 — `ReelAnalysisPage.runAnalysis` accessed before declaration in mount effect (TDZ / stale-closure risk)
- **Severity:** High
- **Where:** `src/pages/ReelAnalysisPage.tsx:70` calls `runAnalysis(handles)` inside the mount `useEffect` (line 56) but `runAnalysis` is a `function` declared at line 78 — eslint `react-hooks/immutability`: "accessed before it is declared".
- **What:** Function declarations are hoisted so it runs today, but the linter flags that the effect captures a binding that changes over renders; the closure won't track updated state. The whole page also duplicates the `useReelAnalysis` hook's logic (see H3).
- **Fix:** Move the mount logic into `useReelAnalysis` (single source) and call its `startAnalysis`, or define `runAnalysis` with `useCallback` above the effect and add to deps.

### H3 — Reel analysis logic is duplicated between the page and the hook; the hook ignores `signal` everywhere
- **Severity:** High
- **Where:** `src/pages/ReelAnalysisPage.tsx:78-142` re-implements the exact pipeline already in `src/hooks/useReelAnalysis.ts:26-81`. ChatPage uses the hook; the standalone page uses its own copy. Both call `scrapeTopReels(handle, 10, apifyKeys)` (`useReelAnalysis.ts:52`, `ReelAnalysisPage.tsx:92`) and `analyzeReel(reel, geminiKey)` (`:60`, `:99`) **without passing an AbortSignal**, even though both functions accept one (`reelScraper.ts:101`, `reelAnalyzer.ts:29`).
- **What:** (a) Two implementations drift independently — a bug fixed in one is missed in the other. (b) No abort path: navigating away mid-reel-analysis leaves Apify polling loops and Gemini calls running as zombies that then write into a reset store. The reel pipeline is the only flow with **zero** cancellation despite being the longest-running (`reelHandles.length * 2–3 min`).
- **Fix:** Delete the page's copy and use `useReelAnalysis`; thread an `AbortController` (created on mount, aborted in cleanup) through `scrapeTopReels`/`analyzeReel`.

### H4 — Reel analysis synthesis effect can fire on a stale/empty store (cross-run contamination)
- **Severity:** High
- **Where:** `src/hooks/useReelAnalysis.ts:26-48` and the identical `ReelAnalysisPage.tsx:120-142`
- **What:** The synthesis `useEffect` depends on `[creatorStates, synthesisStatus]` and guards `synthesisStatus !== 'idle'`. `startAnalysis` calls `reset()` (sets statuses to idle, clears `creatorStates`) then immediately seeds new creator states — but Zustand `set` is batched/async relative to the effect. If a previous run left `synthesisStatus` non-idle, a new run's `reset()` returns it to idle and the effect can re-trigger `synthesizeNiche` against a half-populated `creatorStates`. There is also no abort/guard against a second synthesis when the user clicks "Analyze" again before the first finishes.
- **Fix:** Key synthesis to a run-id (increment on each `startAnalysis`) and ignore effect runs whose run-id is stale; or trigger synthesis explicitly at the end of `startAnalysis` rather than via a `creatorStates`-watching effect.

### H5 — ChatPage runs two independent reel-analysis orchestrators that can collide
- **Severity:** High
- **Where:** `src/pages/ChatPage.tsx:66` mounts `useReelAnalysis()` (its own module-level `pLimit(5)` and store), while `src/pages/ReelAnalysisPage.tsx:22` has a *separate* `pLimit(5)` and re-runs on mount. Both share the single `useReelAnalysisStore`.
- **What:** Reel analysis is reachable two ways: inline in ChatPage (via `startReelAnalysis`) and via `/reel-analysis?handles=...` (ResultsPage/DiscoveryResultsPage "Analyze reels" buttons, `ResultsPage.tsx:219`, `DiscoveryResultsPage.tsx:246`). They write to the same global store with different concurrency limiters and lifecycles. State bleeds across surfaces because there is one shared store but two orchestrators.
- **Fix:** Single orchestration path (the hook). Remove the `/reel-analysis` page's self-start or have it delegate to the hook.

### H6 — Orphaned result pages + documentation/runtime route mismatch
- **Severity:** High (dead UX surface + drift)
- **Where:** `src/App.tsx:32-38` registers `/results`, `/discover/results`, `/reel-analysis`. **No code navigates to `/results` or `/discover/results`** — ChatPage renders all competitor/discovery results inline and never calls `navigate(resultsPath)`. `PIPELINE_REGISTRY.resultsPath` (`registry.ts:47,60`) and `useActivePipeline.resultsPath` are computed but unused for navigation. `ResultsPage.tsx`/`DiscoveryResultsPage.tsx` are only reachable by manually typing the URL.
- **What:** Two full result pages (and their export bars, selection logic, reel buttons) are effectively dead unless a user hand-types a URL — and if they do, the pages read from a store that ChatPage may have already `reset()`. The `resultsPath` field is leftover scaffolding from the pre-inline architecture (PLAN-chat migration).
- **Fix:** Decide: either wire navigation to these pages or delete them + the `resultsPath` field. Update docs accordingly.

### H7 — `ReelAnalysisPage` redirect contradicts its own doc + reads `handles` twice (re-parse drift)
- **Severity:** High
- **Where:** `src/pages/ReelAnalysisPage.tsx:7` docstring says "redirects to /discover/results if empty" but `:62` does `navigate('/', ...)`. Also `handles` is parsed in the effect (`:59`) **and again** at render (`:149`) from `searchParams` — two parses of the same param, and the render-time parse is what drives the rendered list.
- **What:** Misleading doc; and the duplicated parse means the displayed list and the analyzed list are computed from `searchParams` independently. If the URL ever changed without remount they'd diverge.
- **Fix:** Parse once into state; fix the docstring.

### H8 — `locationFilter` reads `businessAddress` that is never populated (silent dead branch)
- **Severity:** High
- **Where:** `src/lib/locationFilter.ts:90,128` (`profile as ProfileWithAddress`, `profile.businessAddress`); `src/lib/transformers.ts` `NormalizedProfile` has no `businessAddress` and `normalizeProfile` never reads it from `ApifyProfileRaw`.
- **What:** Business accounts are supposed to pass the location filter when their `businessAddress` names the city (`:128`), but `businessAddress` is always `undefined`. So **every business without the city literally in its bio is rejected**, regardless of address. The "duck-typed extension … accessible via the biography field in practice" comment (`:86-88`) is false — it's never set. This systematically under-counts local businesses and shifts the pipeline toward the relaxed-filter path.
- **Fix:** Add `businessAddress` to `ApifyProfileRaw`/`NormalizedProfile` and populate it in `normalizeProfile`, or delete the dead branch and the misleading comment.

### H9 — Cross-tab `storage` listener can wipe keys in this tab on a malformed/partial write
- **Severity:** High
- **Where:** `src/store/keysStore.ts:75-90`
- **What:** On any `storage` event for `keys-store`, it does `useKeysStore.setState({ geminiKey: geminiKey ?? '', apifyKeys: apifyKeys ?? [] })`. If another tab writes a state shape without those fields (or mid-migration), this tab's keys are reset to empty in memory — the user appears "logged out" until reload. The `catch` only guards JSON parse, not missing fields.
- **Fix:** Only call `setState` for fields actually present in the event payload; bail if `newState.state` is missing the keys.

### H10 — Hashtag generator swallows ALL Gemini errors into a silent rule-based fallback (incl. auth)
- **Severity:** High
- **Where:** `src/lib/hashtagGenerator.ts:214-216` — `catch (err) { console.warn(...) }` then falls through to `ruleFallback`.
- **What:** A bad/expired Gemini key, a 429, or a safety block all degrade silently to template hashtags. The discovery pipeline then proceeds on low-quality tags and the user never learns their key is the problem — they just get worse results. The fallback is correct as a *resilience* measure but should not mask an auth failure that the rest of the app surfaces loudly.
- **Fix:** Re-throw `GeminiError` with `code === 'AUTH_ERROR'` (or surface a one-time warning to the chat); fall back only on transient/parse errors.

### H11 — `useReelAnalysis` propagates raw `(err as Error).message` into per-creator UI
- **Severity:** High
- **Where:** `src/hooks/useReelAnalysis.ts:68,70` and `ReelAnalysisPage.tsx:109,111` → rendered at `InlineReelResults.tsx:112` / `ReelAnalysisPage.tsx:301`.
- **What:** On failure the creator card shows `analysis failed: {state.error}` with the raw error message. For `ApifyError` from `apifyCore` that message includes the raw response body (see C2) and for network errors it can be `Failed to fetch`. Same key/internal-leak class as C2 but on the reel surface, which has none of the message-sanitisation the discovery hook added.
- **Fix:** Map error → friendly message (NoReels vs rate-limited vs generic) before storing; never store `err.message` verbatim.

---

## MEDIUM

### M1 — Hard-abort/nudge timers are shared single refs; concurrent discovery overwrites them (leak)
- **Severity:** Medium
- **Where:** `src/hooks/useConversation.ts:155-164,196-210,265-269`
- **What:** `discoveryAbortRef`, `nudgeTimerRef`, `discoveryTimeoutRef` are single slots. `runCompetitorDiscovery` overwrites them; a redirect path (`confirmSeeds` → `runCompetitorDiscovery`, line 772) or a rapid second send can replace a ref before the first's `finally` clears it, orphaning a timer/controller. The `finally` clears `discoveryTimeoutRef.current` which may now point at the *new* run's timer, cancelling it early.
- **Fix:** Use locals for each invocation's controller/timers and only mirror into the ref for unmount cleanup; clear the local in `finally`, not the shared ref.

### M2 — `discoveryAbortRef` is reused for parse, discovery, confirm-reply, AND follow-up — aborts the wrong request
- **Severity:** Medium
- **Where:** `useConversation.ts:405` (confirm reply), `:471` (follow-up), `:586` (parse), `:196` (discovery) all assign `discoveryAbortRef.current`.
- **What:** One ref multiplexes four different request lifecycles. A new send or the unmount cleanup can abort a request the user still wants, and the naming ("discoveryAbortRef") no longer matches usage.
- **Fix:** Separate refs per concern, or an array of active controllers aborted en masse on unmount.

### M3 — `pollRun` discards the abort reason; an aborted fetch becomes a generic POLL_FAILED
- **Severity:** Medium
- **Where:** `src/lib/apifyCore.ts:108-117`
- **What:** The loop checks `signal?.aborted` at the top, but if `abort()` fires *during* the in-flight `fetch`, the fetch rejects with an `AbortError` (a `DOMException`) that is not caught/translated — it propagates as an un-typed throw, and callers that check `err instanceof ApifyError` miss it, falling into "unexpected error". Timeout aborts then surface as the wrong message.
- **Fix:** Wrap the fetch in try/catch; if `signal.aborted` or `err.name === 'AbortError'`, throw `ApifyError('ABORTED', …)`.

### M4 — No Zod/schema validation on Apify responses, reel data, synthesis, or follow-up
- **Severity:** Medium
- **Where:** `apifyCore.ts:92,119,145` (`as ApifyRunResponse` / `as ApifyDatasetResponse<T>`), `reelScraper.ts:79` (`rawPosts as RawPost[]`), `reelAnalyzer.ts:33-40` (cast of Gemini output), `gemini.ts:485` follow-up.
- **What:** Only `intentParser.ts` uses Zod. Everything else trusts external JSON via `as` casts. `coerceDiscoveryOutput`/`validateAnalysisOutput` do minimal shape checks; reel analysis + synthesis do none — a malformed Gemini synthesis (`benchmarks` missing) crashes `InlineReelResults.tsx:66` (`.toFixed` on undefined).
- **Fix:** Add lightweight runtime guards (or Zod) at each external boundary, especially the reel synthesis benchmarks before `.toFixed`.

### M5 — Reel synthesis math is delegated to the LLM instead of computed in code
- **Severity:** Medium
- **Where:** `reelAnalyzer.ts:42` (`reel.commentsCount / Math.max(1, reel.likesCount)`) and `prompts/reelAnalysis.ts:188-193` (benchmarks computed *by Gemini*, not in code).
- **What:** `medianViews`, `likesViewsRatio`, `commentsLikesRatio` are asked of the LLM ("compute as mean … otherwise estimate from the distribution") instead of computed deterministically from the data already in hand (`buildPerCreatorSummary` already has the numbers). LLM arithmetic on numbers is unreliable and unverifiable; the UI then renders them as precise percentages.
- **Fix:** Compute benchmarks in `buildPerCreatorSummary`/synthesis client-side; ask Gemini only for the qualitative patterns/tips.

### M6 — Inline bold renderer breaks on nested/odd asterisks (cosmetic; no unsafe HTML sink)
- **Severity:** Medium
- **Where:** `src/components/ChatMessage.tsx:172-178`
- **What:** `text.split(/(\*\*[^*]+\*\*)/)` only matches `**x**` where `x` has no `*`. Content like `**a*b**` or a lone `**` renders raw. NOTE: this is NOT an injection risk — output is React text nodes only; the codebase has no raw-HTML sink anywhere (no unsafe HTML rendering in any chat bubble), which is correct.
- **Fix:** Acceptable as-is; if richer markdown is wanted use a small sanitizing parser.

### M7 — Prompt-injection surface: free user text flows into prompts; sanitisation is inconsistent
- **Severity:** Medium
- **Where:** `prompts.ts:378` (intent: only escapes quotes + strips newlines), `intentParser.ts:248` (retry concatenates the **raw** `userMessage` again into a new prompt), `prompts.ts:497` (confirm reply uses `JSON.stringify` slice — good), reel `buildReelAnalysisPrompt` injects raw `caption`/`hashtags` via `JSON.stringify` (good).
- **What:** The intent prompt embeds user text inside quotes with only quote-escaping; a crafted message can still break framing (the model is the only guard). The retry path (`intentParser.ts:246-249`) re-injects the original message plus an attacker-controllable "Note" — a user who writes injection text gets two shots. Bio text from Apify is injected into competitor/discovery prompts with newline-strip + quote-escape but no length-bounded structural fencing beyond `.slice(120)`.
- **Fix:** Use `JSON.stringify`-style escaping consistently (as confirm-reply does) for the intent prompt; don't re-inject raw user text on retry — keep the original as a fixed, escaped block.

### M8 — `_callGeminiWithRetry` backoff `sleep` ignores the AbortSignal
- **Severity:** Medium
- **Where:** `src/ai/gemini.ts:144-147` (`await sleep(backoff)` then recurse) vs the abort-aware delay in `intentParser.ts:198-201`.
- **What:** During a 429 backoff (up to 4s), an `abort()` won't interrupt the sleep; the retry fires anyway into a dead signal. `intentParser` does this correctly; `callGeminiWithSchema` does not.
- **Fix:** Make `sleep` abort-aware (reject on `signal` abort), mirroring `intentParser`.

### M9 — ChatPage discovery-error effect omits `discoveryError` from deps (stale message risk)
- **Severity:** Medium
- **Where:** `src/pages/ChatPage.tsx:107-112` (mount reset, `[]` deps) and `:127-135` (error effect, deps `[discoveryStatus, resetDiscovery]` but body reads `discoveryError`/`addMessage`/`setStatus`).
- **What:** The error-surfacing effect omits `discoveryError` from deps (suppressed via eslint-disable). It reads the current `discoveryError` only because the effect happens to re-run when `discoveryStatus` flips to 'error' — fragile; if the error string updates without a status change, the wrong/stale message shows.
- **Fix:** Include the read values in deps or read fresh from the store inside the effect.

### M10 — `pickAvailableKey` round-robin by wall-clock second is not real rotation
- **Severity:** Medium
- **Where:** `src/lib/keyRotator.ts:74-80`
- **What:** `idx = floor(Date.now()/1000) % available.length`. Two scrapes within the same second pick the **same** key; bursts (the discovery pipeline fires many parallel `scrapeProfiles` via `pLimit(3)`) all use one key, defeating the multi-key rate-limit avoidance the feature exists for. Also non-deterministic across the second boundary.
- **Fix:** Maintain a persisted rotating index (increment per pick) instead of deriving from the clock.

### M11 — Two clarification fallback questions are hardcoded and diverge from the shared FALLBACK
- **Severity:** Medium
- **Where:** `useCompetitorAnalysis.ts:85` (`['Exact niche match', 'Broader category']`) vs `gemini.ts:383-389` (`FALLBACK` with fuller option strings).
- **What:** When `inputProfiles[0]` is missing, the hook builds its own 2-option question that doesn't match `generateClarificationQuestion`'s FALLBACK, so UX copy is inconsistent depending on which path produced it.
- **Fix:** Export and reuse a single `CLARIFICATION_FALLBACK` constant.

### M12 — `confirmErrorCount` lock has no visible recovery once locked
- **Severity:** Medium
- **Where:** `useConversation.ts:805` (`isConfirmingLocked = confirmErrorCount >= 2`); reset only via successful resolve (`:419`) or button click (`:809-813`).
- **What:** Once locked, the textarea is disabled (`ChatPage.tsx:617`). The only escape is clicking an option button — but option buttons are disabled when `isConfirmingPending` / `status !== 'confirming'` (`ChatPage.tsx:300`); a transient error can leave the user soft-stuck. The lock never clears on its own.
- **Fix:** Re-enable input after a timeout, or always keep option buttons clickable while locked.

### M13 — Message `key` uses `timestamp-index`; rapid messages share a ms and the index causes reorder churn
- **Severity:** Medium
- **Where:** `src/pages/ChatPage.tsx:297` (`key={`${message.timestamp}-${i}`}`)
- **What:** Including the array index in the key defeats React's reconciliation (every insert can remount tails), and rapid `addMessage` calls share a `Date.now()` ms (see H1) so the timestamp portion isn't unique. Combined with the 50-message `slice(-50)` cap (`analysisStore.ts:180`), keys shift when the window slides.
- **Fix:** Give each message a stable unique id at creation; key on that.

### M14 — `useConversation` recursion on pipeline switch has no depth guard
- **Severity:** Medium
- **Where:** `useConversation.ts:356-370`
- **What:** On `detectPipelineSwitch`, it clears `isSendingRef`/pending flags, sets status to chatting, then `await sendMessage(safeText)` recursively. The comment (AE1) shows the author already hit the "inner sendMessage no-ops" bug. The recursion re-runs the whole handles/intent path; if the switched message *also* matches a switch condition, it could re-enter again.
- **Fix:** Add a recursion-depth guard or convert to an explicit re-dispatch without recursion.

### M15 — Discovery final pool slices assume quality order but lists are unsorted
- **Severity:** Medium
- **Where:** `discoveryClient.ts:266-267` (`allCreators.slice(0, MAX_CREATORS)`), `:220-222`
- **What:** Final pool is `creators.slice(0,15) + businesses.slice(0,10)` but within each list there's no quality ordering — slicing keeps whatever order the scrape batches returned (effectively Apify/hashtag order), not the highest-follower/ER creators. The "merge order matters for Gemini context bias" rationale (`apifyClient.ts:235`) is applied for competitor but not discovery.
- **Fix:** Sort each list by a quality proxy (followers×ER) before slicing.

### M16 — `noUnusedLocals` is on but test files aren't excluded from `tsc -b` → 10 fixture errors break the build
- **Severity:** Medium (build hygiene)
- **Where:** `tsconfig.app.json` includes `src` (which contains `*.test.ts`) with `noUnusedLocals`/`noUnusedParameters`; ESLint config has no Vitest globals/test override.
- **What:** `tsc -b` fails (exit 2) purely on test fixtures (unused imports, `private` field on `NormalizedProfile`, missing `routingConfidence`). `npm run build` runs `tsc -b && vite build`, so **the production build is currently red** even though runtime is fine. See the tagged list in the Build section.
- **Fix:** Add a separate `tsconfig` for tests or exclude `**/*.test.ts` from `tsconfig.app.json`; fix the fixtures.

---

## LOW

### L1 — Dead variable `isReelRunning` (lint + tsc)
- **Where:** `src/pages/ChatPage.tsx:234`. `isReelRunning` is computed and never used (`isReelDone` is used at `:576`). Flagged by both `tsc(6133)` and eslint `no-unused-vars`.
- **Fix:** Delete it.

### L2 — `apifyCore.ts:106` `datasetId` initial assignment is dead
- **Where:** `pollRun` sets `let datasetId = ''` then unconditionally reassigns from `json.data.defaultDatasetId` (`:121`). Lint `no-useless-assignment`.
- **Fix:** Initialise from first poll or drop the seed value.

### L3 — `hashtagGenerator.ts:27` unnecessary escape in regex
- **Where:** `/[^\w\s,\-]/g` — the `\-` is needless inside this class. Lint `no-useless-escape`.
- **Fix:** Use `-` unescaped at the end of the class.

### L4 — `preserve-caught-error` violations (lost error cause)
- **Where:** `useCompetitorAnalysis.ts:96,163`, `useLocationDiscovery.ts:216` — `throw new Error(message)` inside a `catch` without `{ cause: err }`. Three lint errors.
- **Fix:** `throw new Error(message, { cause: err })`.

### L5 — `useLocationDiscovery.ts:129` empty catch with unused binding
- **Where:** `catch (_expansionErr) {}` — expansion failure swallowed silently (by design) but the binding is unused (lint) and there's not even a `console.debug`.
- **Fix:** Drop the binding (`catch {`) and add a `console.debug`.

### L6 — `SettingsPage.tsx:10` `Date.now()` in render (lint purity) + stale countdown
- **Where:** `CooldownBadge` computes `remaining` from `Date.now()` during render; the badge never updates (no timer) so it shows a stale countdown until the next re-render.
- **Fix:** Compute in an effect/interval, or accept staleness and drive it from a memoised tick.

### L7 — DESIGN.md violations: non-warm Tailwind semantic colors used directly
- **Where:** `CompetitorCard.tsx:87` & `DiscoveryCard.tsx:127` `text-blue-500` (verified tick); `DiscoveryCard.tsx:147` `text-green-600`/`text-amber-600` (ER); `ResultsPage.tsx:188` & `DiscoveryResultsPage.tsx:215` `text-green-600`; `ProgressSteps.tsx:46` `bg-green-900/40 text-green-400`; `InlineReelResults.tsx` + `ReelAnalysisPage.tsx` `red-400/red-500/red-900`.
- **What:** DESIGN.md maps ER/location/semantic states to warm tokens (`success #4CAF7D`, `warning #D97706`, `danger #E05C5C`). These raw Tailwind blues/greens/ambers/reds bypass the token system (the warm-undertone rule). `text-blue-500` for the verified badge is the most visible — blue is explicitly "deprecate them". **No Inter / slate-* / indigo-* found in shipped code.**
- **Fix:** Replace with `text-success`/`text-warning`/`text-danger`/`text-secondary` tokens (the chat error bubble at `ChatMessage.tsx:54` already does this correctly).

### L8 — DESIGN.md: AI summary bubble missing the "✦ Gemini" eyebrow
- **Where:** `ChatPage.tsx:383-387` renders the violet AI summary card but DESIGN.md §Chat Bubbles requires a "✦ Gemini" eyebrow label in `--color-ai-tint` on AI-insight bubbles. The violet tint is correctly used only for AI content (good), just missing the label.
- **Fix:** Add the eyebrow.

### L9 — `ChatMessage.tsx:10` stale doc comment (`bg-red-50 border-red-200`)
- **Where:** The T13 comment references `bg-red-50 border-red-200`, but the code uses warm `rgba(224,92,92,...)` tokens. Harmless but misleading.
- **Fix:** Update the comment.

### L10 — App is desktop-only with a hard `min-width: 1024px`
- **Where:** `src/index.css` `body { min-width: 1024px }`; AppLayout uses fixed `max-w-7xl`. On <1024px viewports the page overflows with a horizontal scrollbar.
- **Fix:** Intentional per scope? If so, document it; otherwise add a small-screen message.

### L11 — `transformers.ts` trusts `ApifyPost.hashtags` element types beyond `typeof`
- **Where:** `transformers.ts:160-166` iterates `post.hashtags ?? []` with a `typeof tag !== 'string'` guard (good) but `ApifyPost.hashtags?: string[]` is trusted from `as ApifyProfileRaw` upstream. Low risk given the guard.
- **Fix:** None required; noted for completeness.

### L12 — `package.json` name is `instagram-competitor-finder` (drift from "Content OS 2.0")
- **Where:** `package.json:2`. Cosmetic identity drift vs the product name everywhere else.
- **Fix:** Rename or accept.

---

## Documentation Drift (cross-cutting)

- **Removed pages still referenced:** `AGENTS.md`/`CLAUDE.md` project-structure blocks omit `ReelAnalysisPage.tsx` (it exists) — minor. **`TODOS.md`** references `src/pages/InputPage.tsx` (TD3, TD7, TD10, the dependency chain at :199-201, D1.7 at :155) and `ProgressPage` — **none of these files exist**. **`PLAN-chat.md`** references `ProgressPage.tsx` (T19, :276-280, :301-304) and `InputPage` (:13,:163) — gone. **`CHANGELOG.md`** references `DiscoverPage.tsx`, `DiscoveryProgressPage`, `ProgressPage`, `InputPage` (:76,:106-107,:126-127,:138) as removed — that part is accurate (historical).
- **`PLAN-chat.md` T15/T16 (the indigo/slate tasks):** T15 specified `bg-indigo-100`/`bg-slate-100` avatar circles and T16 specified `border-slate-200`/`hover:border-indigo-400` pills. **These did NOT ship** — `ChatMessage.tsx:47` uses warm `bg-[rgba(224,123,58,0.12)]`/`bg-surface-raised` and `ChatOptions.tsx:41-45` uses warm tokens. So the plan text is stale relative to the (correct) implementation; **no indigo/slate violation is in the codebase**. Flag the plan, not the code.
- **`ReelAnalysisPage` docstring** says redirect → `/discover/results`; code → `/` (H7).
- **`locationFilter.ts:86-88`** comment claims `businessAddress` is "accessible via the biography field in practice" — false (H8).
- **`registry.ts:30-35`** documents `confirmMessage` for competitor as "unused at runtime" — accurate, but it (and `resultsPath`) is leftover scaffolding (H6).

---

## Build — full `tsc -b` error list (11), tagged

1. `useConversation.confirming.test.ts(21,53)` 'MockedFunction' unused — **[fixture-drift]**
2. `useLocationDiscovery.expansion.test.ts(94,15)` `FilterResult` not exported from discoveryClient — **[fixture-drift]** (it's exported from `locationFilter`; test imports from wrong module)
3. `useLocationDiscovery.expansion.test.ts(107,5)` `'private'` not on `NormalizedProfile` — **[fixture-drift]** (raw vs normalized shape confusion; `private` is on `ApifyProfileRaw`, not `NormalizedProfile`)
4. `apifyCore.fetch.test.ts(12,43)` 'ApifyError' unused — **[fixture-drift]**
5. `apifyCore.fetch.test.ts(12,55)` 'POLL_INTERVAL_MS' unused — **[fixture-drift]**
6. `ChatPage.tsx(234,9)` 'isReelRunning' unused — **[real-bug]** (dead code, L1)
7. `analysisStore.chat.test.ts(150,49)` intent literal missing `clientName`/`routingConfidence` — **[fixture-drift]** (fixture not updated after `ParsedIntent` gained `routingConfidence`)
8. `discoveryStore.expand.test.ts(49,3)` `'private'` on `NormalizedProfile` — **[fixture-drift]**
9. `discoveryStore.test.ts(36,3)` `'private'` on `NormalizedProfile` — **[fixture-drift]**
10. `registry.test.ts(19,7)` missing `routingConfidence` — **[fixture-drift]**
11. `registry.test.ts(30,7)` missing `routingConfidence` — **[fixture-drift]**

Net: **1 real (dead var), 10 fixture-drift.** The fixture drift means production `npm run build` fails (M16) despite all 446 tests passing — the type contracts `ParsedIntent` and `NormalizedProfile` evolved but test fixtures (and one stale `private` field) weren't updated, and tests aren't isolated from the app tsconfig.

## Lint — full `eslint .` error list (19), tagged

1-2. `useCompetitorAnalysis.ts:96,163` preserve-caught-error — **[real-bug]** (L4, lost cause)
3. `useConversation.confirming.test.ts:21` no-unused-vars — **[fixture-drift]**
4-10. `useConversation.ts:337,343,360,380,396,415,434` react-hooks/purity (Date.now) — **[real-bug]** (H1)
11. `useLocationDiscovery.ts:129` no-unused-vars `_expansionErr` — **[real-bug]** (L5, trivial)
12. `useLocationDiscovery.ts:216` preserve-caught-error — **[real-bug]** (L4)
13-14. `apifyCore.fetch.test.ts:12` two no-unused-vars — **[fixture-drift]**
15. `apifyCore.ts:106` no-useless-assignment — **[real-bug]** (L2, trivial)
16. `hashtagGenerator.ts:27` no-useless-escape — **[real-bug]** (L3, trivial)
17. `ChatPage.tsx:234` no-unused-vars — **[real-bug]** (L1)
18. `ReelAnalysisPage.tsx:70` react-hooks/immutability (use-before-declare) — **[real-bug]** (H2)
19. `SettingsPage.tsx:10` react-hooks/purity (Date.now) — **[real-bug]** (L6)

Net: **15 real (mostly purity + trivial), 4 fixture-drift.** None are `[rule-choice/config]` — all rules are reasonable React-19/TS defaults.

---

## Accessibility

- **A1 (Medium):** The entire inline results region (progress steps, all cards, reel analysis) lives *inside* the `role="log" aria-live="polite"` container (`ChatPage.tsx:292-587`). Screen readers get a `polite` flood — every progress step and every re-render of the card grid re-announces. Scope `aria-live` to conversation bubbles only; mark the results grid `aria-live="off"` with a separate concise status summary.
- **A2 (Medium):** The reel-analysis header and synthesis cards have no `aria-live`/`role=status`; the long reel flow finishes silently for screen-reader users.
- **A3 (Low):** ER above/below avg is conveyed by color (green vs orange, `CompetitorCard.tsx:104-113`); the "above avg/below avg" text mitigates it, but the L7 raw greens/ambers may not meet contrast on `#2C2218`.
- **A4 (Low):** `CompetitorCard`/`DiscoveryCard` whole-card selection `onClick` is on a `div` (`:38`,`:78`), not a button — not keyboard-focusable/operable; the checkbox icon is decorative. No `role`/`tabindex`/`onKeyDown`.
- **A5 (Low):** Icon-only buttons are labeled where it matters (Send `:642`, Remove key `SettingsPage:165`) — good.

---

## Test Coverage Gaps (critical paths with no/low coverage)

- **Reel analysis hook (`useReelAnalysis`)** — no test. Orchestration, the terminal-state synthesis trigger (H4), and the all-failed branch are untested. `reelScraper.filter.test.ts` covers only the pure `filterAndSortReels`; `reelAnalysisStore.test.ts` covers the store setters only. **`buildPerCreatorSummary`, `synthesizeNiche`, `analyzeReel` have zero tests.**
- **Content follow-up path (`callGeminiFollowUp` / `buildFollowUpContext` / `buildFollowUpAccountSummaries`)** — no test. The done→follow-up branch in `useConversation` (`:447-490`), including abort-of-previous-followup (`:469`), is untested.
- **Pipeline switching (`detectPipelineSwitch`)** — exported and used at `:356` but **no test**. `useConversation.confirming.test.ts` exercises `heuristicConfirmMatch` only. The recursive re-dispatch (M14) is untested.
- **Abort lifecycle** — no test asserts that unmount aborts in-flight discovery/parse/follow-up, or that timers are cleared (M1). `apifyCore.fetch.test.ts` exists but the abort-during-fetch translation (M3) is uncovered.
- **`keyRotator` rotation behavior (M10)** — the same-second collision is untested.
- **`ChatPage`/results rendering** — explicitly deferred per `TODOS.md:213`; no RTL tests for the inline result rendering or the orphaned pages.

---

## Top 10 to Fix First

1. **C1** — Move the Gemini key out of the URL into the `x-goog-api-key` header (5 call sites). Highest secret-exposure surface.
2. **C2 / H11** — Stop forwarding raw `ApifyError.message` (which contains the response body) to the UI in `useCompetitorAnalysis.buildErrorMessage` and the reel hook; map `code`→friendly string like `useLocationDiscovery` already does.
3. **C3** — Remove/DEV-gate `console.debug('[apify] POST', url, input)` in `apifyCore.ts:70`.
4. **M16 / Build red** — Exclude `**/*.test.ts` from `tsconfig.app.json` (or add a test tsconfig) and fix the 10 fixture errors so `npm run build` is green again.
5. **H3 / H5** — Collapse the duplicated reel pipeline into the single `useReelAnalysis` hook and thread an `AbortController` through `scrapeTopReels`/`analyzeReel` (the only flow with no cancellation).
6. **H1** — Stamp `timestamp` once per event (or in the store's `addMessage`) to clear the 7 `react-hooks/purity` errors and stabilise message keys (M13).
7. **H8** — Fix the silent dead `businessAddress` branch in `locationFilter` (populate it in `transformers` or delete the branch + false comment); it currently rejects most local businesses.
8. **H4** — Guard reel synthesis against stale `creatorStates` with a run-id so a re-run can't synthesize a half-populated pool.
9. **H9** — Make the cross-tab `storage` listener field-by-field so a partial write can't wipe the user's keys in another tab.
10. **H6 / docs drift** — Decide on the orphaned `/results` + `/discover/results` pages (wire navigation or delete) and purge the stale `InputPage`/`ProgressPage` references from `TODOS.md`/`PLAN-chat.md`; fix the `ReelAnalysisPage` redirect docstring (H7).
