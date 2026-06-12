## security
SUMMARY: Defensive security audit — all 8 issues bundled into one finding (see evidence/recommendation) due to output size limits.

[critical] Key exposure (CRITICAL) + 7 related issues — all detailed in evidence/recommendation
  FILE: src/store/keysStore.ts:19-51; src/App.tsx:56-69; vercel.json:5-7
  FIX: Proxy ALL Gemini/Apify calls via authenticated rate-limited serverless fns with server-only keys (as api/analyze-reel-video.ts); rotate exposed keys; invite-only Clerk sign-up; scope corpus UPDATE to sub=created_by; delimit untrusted prompt fields; pin redirects + pass authorizedParties; validate img src.

## state-bugs
SUMMARY: The agent-loop core (useAgentConversation latest-wins, linkAbort superseded-vs-timeout, reelPersist guard) is thoughtfully built, and StrictMode hazards are well-defended with ref guards. The systemic weakness is that all three pipelines write into singleton Zustand stores while conversation identity, abort ownership, and snapshot wiring live in component-local refs and effects: switching/deleting conversations or running back-to-back reel runs routes results into the wrong chat, strands ClarificationCards in a fake 'running' state, and leaves un-abortable zombie runs writing into reset stores (the reel pipeline's two hook instances each own a private AbortController). The Supabase persistence layer has a genuine data-loss path — whole-blob last-write-wins upserts with no hydration gating mean a failed rehydrate plus one message wipes a user's entire conversation history — plus unhandled setItem rejections offline, no persist versioning, and a reelPersist guard hole that restores a permanently stuck deep-report spinner.

[high] Competitor/discovery results and errors land in whichever conversation is active when the run finishes (no conversation binding)
  FILE: src/pages/ChatPage.tsx:184-205, 238-257; src/hooks/useAgentConversation.ts:72-73
  FIX: Capture the owning conversation id when a pipeline run starts (e.g. store `runConversationId` in analysisStore/discoveryStore the way reelAnalysisStore does) and snapshot with `addMessageTo(runConversationId, ...)`. Apply the same to error bubbles from useAgentConversation by capturing `activeId` at sendMessage time.

[high] Switching conversations mid-run wipes analysisStore params, leaving a ClarificationCard that dead-ends into a permanently 'running' progress bubble
  FILE: src/pages/ChatPage.tsx:306-310, 342-345; src/hooks/useCompetitorAnalysis.ts:213-218
  FIX: Abort the in-flight run on conversation switch/delete (expose an abort from useAgentConversation or thread the conversation id), or in `answerClarification` set status back/raise an error instead of returning after status was already flipped to 'running'. Re-order: check params BEFORE calling storeAnswerClarification.

[high] Back-to-back reel runs never update the reel marker or reelConversationId — React batching masks the 0→non-empty transition the effect depends on
  FILE: src/pages/ChatPage.tsx:211-226; src/hooks/useReelAnalysis.ts:127-144
  FIX: Stop deriving the run boundary from a render-time edge detector. Have `startAnalysis`/`startDeepReport` accept and set the owning conversation id explicitly, and append the marker message imperatively at run start (where the run is created), not from a useEffect watching activeHandles.

[high] Two useReelAnalysis instances (ChatPage + useAgentConversation) each own a private abortRef over one singleton store — steering/reset cannot cancel cross-instance runs, leaving zombies that write into a reset store
  FILE: src/hooks/useReelAnalysis.ts:87-88; src/hooks/useAgentConversation.ts:46, 63-70; src/pages/ChatPage.tsx:100, 364-369
  FIX: Move run ownership out of the hook instance: keep ONE module-level AbortController (or store it in reelAnalysisStore) so any `startAnalysis`/`reset`/steer aborts the actual in-flight run regardless of which component initiated it.

[high] Failed rehydrate + any subsequent write overwrites the user's entire cloud conversation history with the blank default state
  FILE: src/App.tsx:36-37; src/store/supabaseStorage.ts:17-31; src/store/conversationsStore.ts:118-119, 174-179
  FIX: Gate writes on successful hydration: track hydration success (onRehydrateStorage / persist.hasHydrated) and make setItem a no-op (or queue) until the first getItem has succeeded; surface a 'couldn't load your history — retry' state instead of silently starting blank. Consider read-modify-write or per-conversation rows instead of one whole-blob upsert.

[medium] Whole-blob last-write-wins upserts: two tabs/devices of the same user clobber each other, and high-frequency reel-run writes can land out of order
  FILE: src/store/supabaseStorage.ts:26-31; src/store/reelAnalysisStore.ts:149-174
  FIX: Debounce/serialize setItem (a per-key in-flight queue that always writes the latest state, in order), add a monotonic revision column with a conditional update, and consider not persisting mid-run reel churn at all (persist only on terminal transitions — the restore guard discards mid-run states anyway).

[medium] Persist setItem rejections are completely unhandled — offline/expired-token writes are silently dropped as unhandled promise rejections
  FILE: src/store/supabaseStorage.ts:27-31
  FIX: Catch setItem failures in the storage adapter, retry with backoff, and surface a 'changes not synced' indicator; at minimum log + toast instead of letting the rejection escape.

[medium] reelPersist guard hole: a reload during deep-report synthesis restores a forever-stuck 'Synthesizing the niche report…' spinner
  FILE: src/store/reelPersist.ts:27-39; src/store/reelAnalysisStore.ts:203-210; src/components/InlineReelResults.tsx:54-58
  FIX: In the merge function (or isCleanReelRun), clamp non-terminal statuses on restore: map `deepReportStatus: 'running'` → 'failed' (or 'idle') and `synthesisStatus: 'running'` → 'failed' rather than restoring them verbatim; alternatively require BOTH statuses to be terminal-or-idle.

[medium] Latest-wins steering cannot cancel the Phase-2 ranking mutation (answerClarification has no external signal) — superseded results still arrive and snapshot
  FILE: src/pages/ChatPage.tsx:577; src/hooks/useCompetitorAnalysis.ts:213-218; src/hooks/useAgentConversation.ts:106-116
  FIX: Thread the agent's current controller into answerClarification (expose it from useAgentConversation, or store a run-scoped AbortController in analysisStore that stopLingeringProgress aborts). Also disarm `competitorResultArmedRef` when a steer resets status.

[medium] A pipeline finishing while ChatPage is unmounted (user on Memory/Report) loses its results silently; navigating away also silently kills agent-dispatched runs
  FILE: src/pages/ChatPage.tsx:109-117, 132-135, 174-205; src/hooks/useAgentConversation.ts:57; src/hooks/useReelAnalysis.ts:88
  FIX: Move result-snapshotting out of ChatPage render effects into the mutation onSuccess (which knows the owning conversation), so results are recorded regardless of which page is mounted. If unmount-cancel is intentional, append an 'analysis cancelled' message to the owning conversation.

[medium] Persisted stores have no version/migrate — any future shape change to ChatMessage/ResultPayload or reel state silently breaks or discards stored data
  FILE: src/store/conversationsStore.ts:174-179; src/store/reelAnalysisStore.ts:187-211
  FIX: Add `version` + a `migrate` function now (even an identity one), and make result-message components defensive against missing/unknown payload fields.

[low] corpusStore.remember read-modify-write race can drop mirror entries under concurrent harvests
  FILE: src/store/corpusStore.ts:48-53
  FIX: Use a functional update: `set((s) => ({ creators: { ...s.creators, ...keyBy(merged) } }))` (zustand set with updater is atomic per call).

[low] Shared corpus_creators upserts are last-write-wins across team members with no concurrency control
  FILE: src/lib/supabaseCorpus.ts:114-118
  FIX: Guard metric upserts with a `last_post_date`/`updated_at` conditional (only overwrite if newer), and treat feedback as append-only events or include feedback_at in a conditional update.

## pipeline-bugs
SUMMARY: The pipeline code is unusually well-commented and most past audit fixes (key failover, abort threading, C2 error hygiene) are real, but there are concrete remaining bugs concentrated in four areas: (1) Apify run lifecycle — runs are never aborted server-side and a single transient poll failure kills an entire scrape, both of which burn paid credits; (2) unbounded Round-2 scraping in the competitor pipeline, which is both the main cost driver and the main cause of 150s timeouts; (3) the location filter, whose alias map is one-directional and whose relaxation threshold (15) exceeds the realistic pool size, making the filter and the downstream expansion gate largely inert; (4) the serverless deep-reel path, whose internal Files-API timeout equals the whole function budget and whose response parsing is strictly weaker than the browser client's. Gemini JSON parsing is schema-constrained plus coercion (Zod only in dead code), which is adequate, but the `retryable` error flag is dead — 500/503/malformed-function-call errors are never retried anywhere live.

[high] Apify actor runs are never aborted — timeouts, steers, and poll failures leave orphaned runs burning credits
  FILE: src/lib/apifyCore.ts:154-198
  FIX: In pollRun's POLL_TIMEOUT path and in an abort handler (signal 'abort' listener), fire a best-effort `POST ${BASE_URL}/actor-runs/${runId}/abort` with the same key (fire-and-forget, .catch(() => {})). Do the same when withKeyFailover rethrows a non-key error after startRun succeeded.

[high] Round 2 of competitor discovery is uncapped — unbounded actor runs blow both cost and the 150s timeout
  FILE: src/lib/apifyClient.ts:154-179
  FIX: Cap candidateHandles before chunking (e.g. `.slice(0, depth === 'deep' ? 40 : 25)`), prioritizing handles that appear in multiple input profiles' relatedHandles (frequency = stronger adjacency signal).

[high] One transient poll failure (429/5xx/network blip) kills the entire scrape with no retry
  FILE: src/lib/apifyCore.ts:165-182
  FIX: Tolerate transient poll errors: on !res.ok with status 429/>=500, or on a network TypeError, sleep POLL_INTERVAL_MS (with small backoff) and continue the loop while the deadline allows; only throw POLL_FAILED on 4xx auth-type statuses or after consecutive-failure budget exhaustion.

[medium] City alias map is one-directional — searching by the alias misses the canonical name (and vice-versa aliases)
  FILE: src/lib/locationFilter.ts:56-60
  FIX: In getCityTerms, reverse-lookup: if `normalized` is not a canonical key, scan CITY_ALIASES entries for one whose alias list contains it, and return canonical + all aliases. Mirror the same canonicalization in getAllOtherCityTerms (it already handles the exclusion side correctly).

[medium] Location filter relaxation threshold (15) exceeds the max candidate pool, making the filter — and the downstream expansion gate — mostly inert
  FILE: src/lib/locationFilter.ts:26,154-159
  FIX: Gate expansion on `passedCount` (the pre-relaxation number), not `filtered.length`; and lower MIN_RESULTS to a value achievable from a 25-profile pool (e.g. 8) or make it proportional (e.g. 40% of pool). Keep wrong-city creator rejections (line 137) even when relaxing, instead of returning `profiles` wholesale.

[medium] GeminiError.retryable is a dead flag — 500/503/MALFORMED_FUNCTION_CALL errors marked retryable are never retried in the live app
  FILE: src/ai/gemini.ts:106-110,149-182,577-580
  FIX: In geminiGenerate, also retry (with the existing abortableSleep backoff, 1-2 attempts) when the mapped error would be retryable: HTTP 500/503. In useAgentConversation.sendMessage, catch GeminiError with retryable===true (the malformed-function-call case) and re-issue callModel once before surfacing an error bubble.

[medium] Serverless deep-reel function: internal Files-API timeout (120s) equals the whole maxDuration budget — guaranteed overrun window, no cleanup on kill
  FILE: api/_lib/geminiFiles.ts:63,100-107
  FIX: Pass an overall deadline into analyzeVideoWithGemini (e.g. start + 100s) and derive activeTimeoutMs from remaining budget (e.g. cap 60s); add AbortSignal.timeout() to the video fetch and generateContent calls so the function returns a clean 504 with cleanup instead of being killed.

[medium] Server-side Gemini response parsing reads only parts[0].text and ignores finishReason — strictly weaker than the browser client for the same model
  FILE: api/_lib/geminiFiles.ts:122-133
  FIX: Mirror the client: filter `p.thought`, join all part texts, check `candidates[0].finishReason === 'MAX_TOKENS'` for a distinct error, and set `maxOutputTokens`/`thinkingConfig: { thinkingBudget: 0 }` in generationConfig like the rest of the codebase does for deterministic JSON tasks.

[medium] Creator-enrichment expansion profiles bypass the quality gate
  FILE: src/lib/discoveryClient.ts:250-258
  FIX: Apply the same filter: `const expansionProfiles = expansionResults.flat().filter(meetsQualityThreshold)` before the creator/business split.

[medium] Transient Apify 429 on run start benches a key for 15 minutes
  FILE: src/lib/apifyCore.ts:125-127
  FIX: Differentiate cooldown duration by cause: keep 15 min for 402/403-quota, use a short cooldown (~30-60s, like geminiKeyRotator's 60s) for 429, e.g. `markKeyCooldown(apiKey, SHORT_MS)` with an optional duration parameter.

[medium] Hidden-likes sentinel (likesCount: -1) not handled in engagement math; no videoPlayCount fallback for reel views
  FILE: src/lib/transformers.ts:133
  FIX: Clamp per-post metrics: `Math.max(0, p.likesCount ?? 0)` (or exclude posts with likesCount < 0 from the average), and in filterAndSortReels use `p.videoViewCount ?? p.videoPlayCount ?? 0` with the same fallback in toReelData.

[medium] Discovery expansion pass re-scrapes profiles with no cross-pass dedup before the Apify run
  FILE: src/hooks/useLocationDiscovery.ts:111-127
  FIX: Thread an `excludeHandles: Set<string>` into runLocationDiscovery and filter `uniqueHandles` before `slice(0, PROFILE_CAP)` (discoveryClient.ts:337-351), so the second pass only scrapes net-new handles.

[low] pollRun timeout error reports the wrong limit when a custom maxPollMs is passed
  FILE: src/lib/apifyCore.ts:197
  FIX: Capture `const limit = maxPollMs ?? MAX_POLL_MS` at the top and interpolate `${limit / 1000}s`. Also fix the stale 'pLimit(1)' comments in reelScraper.ts:10 and reelVideoClient.ts:7 (the shared limiter is pLimit(3)).

[low] deepReelCache has no version key — prompt/schema upgrades never invalidate cached analyses
  FILE: src/lib/deepReelCache.ts:18-22
  FIX: Store `{ promptVersion, analysis }` and export a PROMPT_VERSION constant from deepReelPrompt; treat a version mismatch in getCachedDeep as a miss (optionally lazy-deleting the stale row).

[low] intentParser.ts is dead in the live app but still maintained — and its Gemini path lacks the key rotation the comments claim
  FILE: src/ai/intentParser.ts:92-182
  FIX: Either delete intentParser.ts and move the ParsedIntent type next to analysisStore/tools, or route fetchIntent through geminiGenerate so it matches the documented behavior before any re-adoption.

[low] Competitor ranking output items are not field-coerced, unlike the discovery path
  FILE: src/ai/gemini.ts:312-317
  FIX: Mirror the discovery coercion in validateAnalysisOutput: filter items without a string username, coerce `rank: Number(c.rank) || 0`, `rationale: c.rationale ?? ''`, and default category to 'trending' when outside the enum.

## architecture
SUMMARY: Content OS 2.0 has clean low-level seams (pure view derivations, a tested agent decision core, raw-API normalization contained in transformers.ts) but no pipeline-level module boundary: adding a 4th pipeline today requires touching ~12 files and extending 6 hand-maintained unions/switches spread across agentTools.ts, useAgentConversation's dispatch if-chain, the ResultPayload union living inside analysisStore, ChatPage's ternary renderer + duplicated snapshot effects, and gemini.ts/prompts.ts god-files. The competitor and discovery verticals are ~600 lines of near-duplicate code across stores, hooks, result messages, view modules, and cards, and the documented extension point (PIPELINE_REGISTRY → useConversation.confirmSeeds) references a deleted file while the registry's confirm fields and the entire 276-line intentParser are dead at runtime. The recommended target is a PipelineModule registration pattern (tool declaration + Zod schema + store instance + run() + ResultMessage + buildSnapshot per module, with AGENT_TOOLS, dispatch, rendering, and snapshot effects all derived from one PIPELINES array), reachable via an 8-step re-export-shim migration that keeps the 578 pure-function-heavy tests and the persisted payload shapes intact.

[high] Adding a 4th pipeline today touches ~12 files and 6 hardcoded unions/switches — far from 'drop in a module + register'
  FILE: src/tools/agentTools.ts:22-38, src/hooks/useAgentConversation.ts:196-245, src/store/analysisStore.ts:96, src/pages/ChatPage.tsx:461-499
  FIX: Introduce a real PipelineModule registration pattern: `interface PipelineModule<TParams, TPayload extends {kind:string}> { id; tool: { declaration: GeminiFunctionDeclaration; argSchema: z.ZodType; toParams(args): TParams }; useStore: PipelineStoreApi; run(params, ctx:{signal, keys}): Promise<void>; ResultMessage: ComponentType<{payload:TPayload}>; buildSnapshot(state): TPayload | null; systemPromptHint: string }`. Put modules in `src/pipelines/<name>/` and a single `src/pipelines/registry.ts` exporting `PIPELINES`; derive AGENT_TOOLS, argSchemas, the dispatch table, the ChatPage renderer map (`renderers[payload.kind]`), and the snapshot effects from it. Target end state: a 4th pipeline = one new folder + one array entry.

[high] Agent tool dispatch is an if-chain with 'competitor' as implicit fallthrough, not a table
  FILE: src/hooks/useAgentConversation.ts:196-245
  FIX: Replace with an exhaustive `Record<DispatchableToolName, (args, signal) => Promise<void>>` table (TypeScript enforces exhaustiveness on a Record over a union), and move the hashtag-seed fallback into useCompetitorAnalysis (e.g. `analyze({ niche })` resolves seeds itself). In the target architecture, the table is derived from PipelineModule.run, so registration is the only step.

[high] Type-home inversion: ChatMessage and the entire ResultPayload union live inside the competitor pipeline's store
  FILE: src/store/analysisStore.ts:67-113
  FIX: Create `src/domain/chat.ts` (ChatMessage, ResultPayload + per-kind payloads) and `src/domain/profile.ts`. Move the types there and add `export type { ... } from '../domain/chat'` re-exports in analysisStore so all existing imports and the 578 tests compile unchanged; delete the shims after a mechanical import update. Longer-term, each PipelineModule contributes its payload via a generic, and ResultPayload becomes `PipelinePayload<typeof PIPELINES[number]>`.

[high] ChatPage.tsx is a 654-line god component that owns pipeline lifecycle logic, not just rendering
  FILE: src/pages/ChatPage.tsx:145-272, 461-550
  FIX: Extract a generic `useResultSnapshot(pipeline: PipelineModule)` hook: watches the module's store status, arms on running, fires `addMessage({type:'result', result: pipeline.buildSnapshot(state)})` + `corpusHarvest` once on done, resets. ChatPage maps over PIPELINES for effects and over `renderers[result.kind]` for rendering (replacing the l.461-499 ternary chain). This shrinks ChatPage to layout + input + selection state.

[high] Competitor vs discovery vertical is ~600 lines of near-duplicate code across 5 layer pairs
  FILE: src/store/discoveryStore.ts:1-111 vs src/store/analysisStore.ts; src/hooks/useLocationDiscovery.ts vs src/hooks/useCompetitorAnalysis.ts; src/components/discoveryResultView.ts vs competitorResultView.ts
  FIX: Three unifications, in test-safe order: (1) `createPipelineStore<TParams, TExtra>(initialExtra)` factory returning the shared status/step/params/error/didExpand surface — re-implement discoveryStore as an instance exporting the identical names so discoveryStore.test.ts passes unchanged. (2) One `deriveRankedView<T extends {username; category; rank}>(items, profiles)` in shared/ — keep the two old exports as one-line wrappers so view tests pass. (3) One `RankedResultMessage` component parameterized by {categories, Card, warningNotes(payload)} from registry metadata. Extract the shared mutation scaffolding (guards, linkAbort, dismissed-filter, hallucination filter, zero-retry, error mapping) into a `runRankedPipeline(config)` helper in lib/, leaving each hook ~50 lines of pipeline-specific steps.

[medium] PIPELINE_REGISTRY is mostly dead metadata with a stale extension guide pointing at a deleted file
  FILE: src/tools/registry.ts:7-10, 33-39; src/tools/types.ts:5-8
  FIX: Either delete confirmMessage/confirmOptions (and their tests) or repurpose the registry as the real PipelineModule registry from finding 1. Rewrite the extension guide in registry.ts, types.ts, and CLAUDE.md (which still says 'Two pipelines' at line 66) to describe the actual current path.

[medium] intentParser.ts (276 lines) is dead at runtime but still anchors the type system
  FILE: src/ai/intentParser.ts:247; src/tools/types.ts:13
  FIX: Delete intentParser.ts, its tests, and the eval suite (or move evals to a non-CI folder if kept for prompt research). Replace ResolvedIntent in tools/types.ts with a standalone interface (niche/location/knownHandles), and drop analysisStore.parsedIntent + setParsedIntent (also dead — only confirmSeeds, which no longer exists, read it).

[medium] Four parallel naming schemes identify the same pipeline concept, mapped by hand
  FILE: src/tools/agentTools.ts:22-27; src/tools/registry.ts:28-75; src/store/analysisStore.ts:67-96; src/ai/intentParser.ts:59
  FIX: Make the pipeline id the single key: PipelineModule.id drives the payload `kind`, the registry key, and the renderer map; the Gemini tool name lives inside the module's tool declaration with `toParams()` providing the only mapping point.

[medium] useActivePipeline models only 2 of 3 pipelines and ChatPage half-bypasses it anyway
  FILE: src/hooks/useActivePipeline.ts:56-126; src/pages/ChatPage.tsx:556-593
  FIX: Define a common `PipelineRunState = { phase: 'idle'|'running'|'awaiting-input'|'done'|'error', step, stepLabels, progressLabel }` selector that every pipeline store (via the createPipelineStore factory) exposes. computeActivePipeline becomes `PIPELINES.map(p => p.selectRunState()).find(s => s.phase !== 'idle')`, and isAnyPipelineRunning/stopLingeringProgress iterate the same list.

[medium] gemini.ts (609 lines) and prompts.ts (598 lines) are god-files mixing transport, per-pipeline API, and domain types
  FILE: src/ai/gemini.ts:1-609; src/ai/prompts.ts:64-258
  FIX: Split gemini.ts into `src/platform/geminiTransport.ts` (GeminiError, geminiGenerate, callGeminiWithSchema, callGeminiWithTools, abortableSleep — ~300 lines, frozen) and move each analyzeX + its schema + its prompt builder + its output types into the owning pipeline module (`src/pipelines/competitor/ai.ts` etc.). Re-export the moved types from prompts.ts temporarily so the 578 tests compile during migration.

[medium] lib/ modules import domain types from store/ — dependency arrows point upward
  FILE: src/lib/reelScraper.ts:15; src/lib/reelAnalyzer.ts:31; src/lib/corpusHarvest.ts:10; src/lib/deepReelCache.ts:16; src/tools/registry.ts:13-14
  FIX: Move ReelData/ReelAnalysis/CreatorAnalysisState/SynthesisOutput/StoredDeepReelAnalysis to `src/domain/reel.ts`; move STEP_LABELS into the registry/pipeline module and have the stores import the labels from there (reversing the arrow). Keep re-export shims in the store files during migration.

[medium] Inconsistent output validation: Zod for tool args, hand-rolled coercion for pipeline outputs, hand-duplicated responseSchemas
  FILE: src/ai/gemini.ts:312-336, 260-308; src/ai/prompts.ts:69-91, 243-276
  FIX: Define one Zod schema per pipeline output as the single source: derive the TS type via `z.infer`, validate/coerce with `.parse` (replacing both hand validators), and either generate the Gemini responseSchema from it or co-locate the two in the pipeline module so review catches drift. This pattern already proved itself in agentTools.

[low] Snapshot 'trimming' is untyped — persisted payloads claim full NormalizedProfile/ReelData but carry blanked fields
  FILE: src/pages/ChatPage.tsx:45-47; src/lib/reelSnapshot.ts:21-26
  FIX: Define explicit snapshot types (`ProfileCardData = Pick<NormalizedProfile, 'username'|'fullName'|'followersCount'|'verified'|'engagementRate'|'profilePicUrl'|...>`) in domain/, make the payloads carry those, and let the compiler enforce what result cards may read. Each PipelineModule.buildSnapshot owns its trim.

[low] Navigation sections are hardcoded per-route booleans and ReportPage reads a single last-run-wins global slot
  FILE: src/components/AppLayout.tsx:17-19, 48-71; src/pages/ReportPage.tsx:16; src/App.tsx:80-101
  FIX: Data-drive the shell: `const SECTIONS = [{path:'/', label:'Chat', icon, fullBleed:true}, ...]` consumed by both AppLayout (map links, derive active via useLocation) and App.tsx (map routes). For Report, route as /report/:id reading from conversation snapshots (fall back to the live store slot for the latest), which also gives future sections (e.g. a Reports list) a clean home.

[low] Agent tool layer is one refactor away from genuinely extensible — validation is registry-driven but action-kind routing is name-hardcoded
  FILE: src/tools/agentTools.ts:46-66, 134-171
  FIX: Give each tool entry a `kind: 'ask' | 'answer' | 'dispatch'` (or a `toAction(args): AgentAction` fn) alongside its schema and declaration in one record; derive decideAction, AGENT_TOOLS, and the per-tool routing lines of AGENT_SYSTEM_PROMPT from that record. agentTools.test.ts keeps passing since validateToolCall/decideAction behavior is unchanged for existing tools.

[medium] Migration path: 8 ordered steps, each green against the existing 578 tests
  FILE: src/ (repo-wide refactoring plan)
  FIX: Order: (1) extract shared buildErrorMessage + pipeline scaffolding into lib/ (both hooks consume it; hook tests unchanged); (2) move ChatMessage/ResultPayload/profile types to src/domain with re-export shims from analysisStore/prompts; (3) unify deriveRankedView with thin named wrappers; (4) introduce createPipelineStore, re-implement discoveryStore as an instance with the identical export surface; (5) restructure agentTools into a single tool record deriving AGENT_TOOLS/argSchemas/dispatch table; (6) extract useResultSnapshot + renderer map, shrinking ChatPage; (7) move per-pipeline ai code (schema+prompt+analyzeX) into src/pipelines/<name>/, keep gemini.ts transport-only; (8) delete dead code (intentParser runtime, registry confirm fields, analysisStore.parsedIntent/discoveredSeeds) and update CLAUDE.md + registry extension docs. Persisted payload shapes (`kind` discriminants, field names) must NOT change at any step — they are the real public API of the conversation store.

## ai-intelligence
SUMMARY: The AI layer is unusually disciplined for a browser-side app: every structured call uses Gemini responseSchema JSON mode with post-parse coercion, hallucination filtering against the scraped set, client-side arithmetic instead of LLM math, and a shared key-rotation/429-failover core (geminiGenerate). The biggest gaps are operational intelligence, not prompt hygiene: the live function-calling router shipped with zero eval coverage (the golden-set eval still targets the retired intentParser), the agent loop is a single-shot dispatcher whose content tool silently drops the research grounding the prompts were designed for, retryable model errors surface to users instead of being retried, and the creator corpus + feedback memory — the product's claimed moat — is exploited only as a 5-exemplar prompt block plus a dismissed-filter, with no caching of quick reel analyses, no batching, no embeddings, no model tiering, and no streaming.

[high] The live intent router has zero eval coverage — the golden-set eval tests a dead code path (intentParser)
  FILE: src/ai/__evals__/intent.eval.test.ts:26 (evals parseIntent); src/pages/ChatPage.tsx:98 (runtime uses useAgentConversation); src/tools/agentTools.ts:197-206 (the actual live router prompt)
  FIX: Port the eval to the live path: add agentLoop.eval.test.ts that feeds each GoldenCase.message through runAgentTurn(buildGeminiHistory([{role:'user',content:msg}],8), h => callGeminiWithTools(KEY, h, AGENT_TOOLS, {systemInstruction: AGENT_SYSTEM_PROMPT, thinkingBudget: 512})) and judges the returned AgentAction (ask vs dispatch:<tool>) with the same underAsk/overAsk metrics. Reuse intentGolden.ts (the ExpectedBehavior shapes map 1:1 to tool names). Then delete intentParser.ts + its 3 test files (move the ParsedIntent type into tools/types.ts) or explicitly mark it legacy. Finally, populate YOUR_EXAMPLES — the file itself says that is where the highest-signal data goes.

[high] answer_content drops all research grounding — the ContentContext plumbing exists but the live agent loop passes undefined
  FILE: src/hooks/useAgentConversation.ts:183; src/ai/prompts.ts:523-596 (ContentContext + buildContentPrompt grounding block)
  FIX: In performAction's 'answer' case, assemble a ContentContext before calling callGeminiContent: scan the active conversation's messages (useConversationsStore.getState()) backwards for the latest type:'result' message and map its payload → {researchSummary: msg.content, accounts: result.profiles.map(p=>({username,followers,er}))}; read useReelAnalysisStore.getState().synthesis → {hookPatterns: topPatterns, replicateTips}. ~25 lines in useAgentConversation.ts, zero new prompts — the grounding block already exists and is already injection-sanitized.

[high] Retryable Gemini errors are never retried on live paths: malformed function calls and 5xx surface straight to the user
  FILE: src/ai/gemini.ts:577-579 (MALFORMED_FUNCTION_CALL → retryable:true); src/hooks/useAgentConversation.ts:144-147 (catch → error bubble); src/tools/agentTools.ts:82-85 (repair loop only covers invalid args); src/hooks/useCompetitorAnalysis.ts:121 (retry: 0)
  FIX: Two targeted fixes: (1) in runAgentTurn, wrap callModel so a GeminiError with retryable===true counts as one repair attempt (re-call with the same history) before falling back to ask; (2) in geminiGenerate, retry retryable non-429 statuses (500/503) once or twice with the existing geminiBackoffMs/abortableSleep machinery — it is the single chokepoint all callers share, so ranking, synthesis, hashtags, and the copilot all inherit it. Keep INVALID_PROMPT/AUTH non-retried.

[medium] Agent loop is a one-shot classifier dispatch, not a tool-use loop — tool results never return to the model, and the 8-message window plus same-role collapse erode cross-turn memory
  FILE: src/hooks/useAgentConversation.ts:35 (HISTORY_WINDOW=8), 141-143 (single runAgentTurn then performAction); src/tools/agentTools.ts:106-125 (buildGeminiHistory collapse)
  FIX: Minimum viable upgrade without a full loop: (a) when a pipeline completes, append a compact model-readable digest into the result message content (top usernames + niche + key stats — ChatPage.tsx:187 currently writes only a count); (b) exempt type:'result' messages from the same-role collapse in buildGeminiHistory (merge their text into the surviving turn instead of dropping it); (c) raise HISTORY_WINDOW for cheap text turns. Full upgrade: after dispatch completes, feed a functionResponse turn back via callGeminiWithTools so the model can chain analyze_reels on its own discover_competitors output (bounded to 2-3 steps).

[medium] Content copilot replies can be silently truncated: callGeminiContent never checks finishReason MAX_TOKENS and caps output at 1024 tokens
  FILE: src/ai/gemini.ts:484-508
  FIX: In callGeminiContent: read candidates[0].finishReason; on MAX_TOKENS either append a visible '…(truncated — ask me to continue)' marker or re-issue once with maxOutputTokens 4096. Also pass thinkingConfig:{thinkingBudget:0} (matching every other non-routing call) so reasoning tokens don't consume the output budget. ~10 lines.

[medium] One model for every job — no tiering between the 6 distinct call types (routing, hashtags, clarification, ranking, synthesis, multimodal video)
  FILE: src/ai/gemini.ts:20 (`const MODEL = import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-2.5-flash'`); api/_lib/geminiFiles.ts:15 (`const DEFAULT_MODEL = 'gemini-2.5-flash'`)
  FIX: Make the model a parameter of geminiGenerate/callGeminiWithSchema/callGeminiWithTools (default MODEL) and split: gemini-2.5-flash-lite for callGeminiWithTools routing, callGeminiForHashtags, and generateClarificationQuestion (all are simple classification/extraction with schemas — validate with the ported golden eval first); keep flash for ranking/synthesis; consider gemini-2.5-pro behind a flag for synthesizeDeepReport (one call per report, cost is negligible relative to the scrape). The env override becomes per-tier (VITE_GEMINI_MODEL_ROUTER / _RANKER).

[medium] Quick-path reel analyses are never cached or batched: 10 Gemini calls per creator, repeated in full on every re-run, while the corpus already stores the answers
  FILE: src/hooks/useReelAnalysis.ts:96-103 (per-reel calls, no cache check); src/lib/deepReelCache.ts:37-46 (deep path HAS a cache); src/pages/MemoryPage.tsx:128 (corpus content only read for display)
  FIX: Two compounding fixes in useReelAnalysis.runCreatorPipeline: (1) cache — before analyzeReel, check a quickReelCache keyed by `${shortCode}:${PROMPT_VERSION}` (clone the 40-line deepReelCache.ts pattern, or read the corpus ContentRecord via repo.listContentFor and reuse when hookArchetype is present and caption metrics match); (2) batch — replace 10 single-reel calls with one callGeminiWithSchema call whose responseSchema is `{type:'array', items: REEL_ANALYSIS_SCHEMA + shortCode}` over all uncached reels of a creator, sending the taxonomy table once (captions are ≤600 chars; 10 reels fit comfortably). 10x fewer calls, faster runs, far less rate-limit pressure.

[medium] Corpus memory is stored richly but exploited shallowly: sightings/recognition never reach the ranking prompt, and creator similarity has no embedding path
  FILE: src/lib/corpus.ts:265-281 (selectPreferenceExemplars cap=5 is the only prompt-facing consumer); src/ai/prompts.ts:46-58 (preference block = soft tiebreaker only); src/ai/prompts.ts:124-131 (candidate lines carry no corpus signal)
  FIX: (1) Cheap, immediate: in buildCompetitorPrompt/buildDiscoveryPrompt, append a corpus annotation to candidate lines when a record exists — e.g. `[KNOWN: seen 3x in 'street food'/'cafe culture', previously ranked Top]` (data is synchronously available via useCorpusStore.getState().creators; sanitize niches with the existing sanitizeForPrompt). Add a rule line telling the model repeat niche-relevant sightings are a positive prior. (2) Embeddings: on corpus remember(), call gemini-embedding-001 on `bio + niches` per creator, store the vector in the Supabase corpus row (pgvector) — enables 'similar to my saved creators' candidate boosting and a real similarity surface on MemoryPage; batchEmbedContents keeps it to one call per pipeline run.

[low] thinkingBudget: 0 on the hardest reasoning call in the app — competitor ranking with multi-step niche derivation
  FILE: src/ai/gemini.ts:363 (`{ temperature: 0.3, maxOutputTokens: 16384, thinkingBudget: 0, signal }` for analyzeCompetitors); src/ai/prompts.ts:171-187 (the prompt demands STEP 1/STEP 2 derivation)
  FIX: Run an A/B on real runs: thinkingBudget 1024 vs 0 for analyzeCompetitors only (one-line change in gemini.ts:363), judged on adjacent-niche contamination over a ~20-case ranked-output golden set (this is also the natural second eval after porting the intent eval). Keep 0 for hashtags/clarification/reel classification where it is correctly applied.

[low] No streaming anywhere — copilot prose and agent text replies render only after full completion
  FILE: src/ai/gemini.ts:158 (`:generateContent` only); no streamGenerateContent/SSE usage repo-wide
  FIX: Add a streamGeminiContent variant in gemini.ts using `:streamGenerateContent?alt=sse` with the same geminiHeaders/key-rotation pick (rotation per attempt still works — pick the key before opening the stream), parse SSE chunks, and have performAction's 'answer'/'message' cases append a placeholder assistant message and update its content via a new conversationsStore updateMessage action. Scope it to the two prose paths only.

[low] Prompts are unversioned, and the forever-cache for deep reel analyses is keyed by shortCode alone — prompt improvements never reach previously analyzed reels
  FILE: src/lib/deepReelCache.ts:37-46 (get keyed only by shortCode), 5-7 ('we cache ... forever, keyed by shortCode'); src/ai/prompts/*.ts (no version constants)
  FIX: Add `export const DEEP_PROMPT_VERSION = 2` next to buildDeepReelPrompt; key the cache as `${shortCode}@v${DEEP_PROMPT_VERSION}` (one-line change in get/setCachedDeep callers) so a version bump is an automatic, lazy invalidation. Have api/_lib/deepReelPrompt.test.ts assert string-equality against the src copy (build-time sync check instead of a comment). Apply the same version constant to the proposed quick-path cache.

## ux
SUMMARY: The chat-first architecture is genuinely good — input stays live during runs (PLAN.md's Gap 2 'boxed into buttons' is fixed for the agent loop), results persist as messages, progress renders in-lane, and error strings are unusually well written. The serious UX debt clusters around three things: (1) the always-live input is a loaded gun during the mid-run clarification state, where typing an answer aborts the run instead of answering, and steering/cancel has zero discoverability or explicit control; (2) the deliverable path is broken — fully-built CSV/clipboard exporters for the two main pipelines are dead code with no UI affordance, and errors after 2-minute runs offer no retry; (3) accessibility was never passed over — card selection and the conversation switcher are mouse-only, the warm-muted palette fails contrast exactly on the metric text the product sells, and there is no reduced-motion or mobile support (body min-width: 1024px). Design-system adherence is strong on fonts/saffron/violet semantics but drifts on hardcoded cool surfaces, inconsistent ER colors between the two card types, and non-mono metrics.

[high] Typing a reply to the mid-run ClarificationCard silently kills the run instead of answering it
  FILE: src/hooks/useAgentConversation.ts:91-116 (with src/pages/ChatPage.tsx:568-582)
  FIX: In sendMessage, special-case status === 'clarifying': route the typed text to answerClarification(text) instead of aborting (free-text refinement is already supported — the answer is injected as USER REFINEMENT context). Alternatively add a free-text input inside ClarificationCard and a 'or type your own answer' affordance, and exclude 'clarifying' from the steering/abort path.

[high] Competitor/discovery CSV + clipboard export is dead code — result cards have no export affordance at all
  FILE: src/shared/utils/export.ts:26,62,162,211 (consumers: src/components/CompetitorResultMessage.tsx, DiscoveryResultMessage.tsx — none)
  FIX: Add an export row (Copy for slides / Download CSV) to CompetitorResultMessage and DiscoveryResultMessage next to the 'Start over' button, wiring the existing generateCSV/formatForClipboard functions to the snapshotted payload. Add a copied-confirmation state (the existing copyToClipboard gives no feedback either).

[high] No cancel/stop control during 1-3 minute runs, and mid-run steering is completely undiscoverable
  FILE: src/pages/ChatPage.tsx:556-593,620 and src/hooks/useAgentConversation.ts:106-117
  FIX: 1) Add a small 'Stop' button to ProgressBubble that aborts currentRun. 2) While a pipeline is running, swap the placeholder to something like 'Type to redirect me — this cancels the current run'. 3) Consider an inline hint line under the progress bubble ('Changed your mind? Just tell me.').

[high] Error bubbles have no retry affordance (the ChatMessage docstring claims one exists)
  FILE: src/components/ChatMessage.tsx:7,44-60 and src/lib/errorMessages.ts:13-44
  FIX: Attach a 'Retry' pill to type:'error' messages that re-sends the last user message through agentConv.sendMessage (the message is already in conversationsStore). For rate-limit errors, consider auto-retry with countdown. Update or implement the docstring claim.

[medium] Auto-scroll yanks the user to the bottom on every progress tick during long runs
  FILE: src/pages/ChatPage.tsx:274-277
  FIX: Track 'stick to bottom' state (e.g. only auto-scroll if the container is within ~120px of the bottom before the update) and show a 'Jump to latest' chip when detached — standard chat pattern.

[medium] Hard desktop-only lock: body min-width 1024px, no mobile layout anywhere
  FILE: src/index.css:19
  FIX: Remove the min-width (or scope it to data-dense pages only) and verify the chat + cards at 390px; the existing md:/xl: breakpoints do most of the work already. Change InlineReelResults base grid to grid-cols-1.

[medium] Card selection and conversation switcher are mouse-only (no keyboard or screen-reader path)
  FILE: src/components/CompetitorCard.tsx:41-47, src/components/DiscoveryCard.tsx:81-87, src/components/ConversationSwitcher.tsx:51-78
  FIX: Give cards role="checkbox" aria-checked, tabIndex=0, and Enter/Space handling (or render a real visually-hidden <input type=checkbox>). In ConversationSwitcher use real <button> items, add aria-expanded on the trigger, close on Escape, and make delete focus-visible (`focus-visible:opacity-100` alongside group-hover).

[medium] Contrast failures: muted text (#7A6A54) carries real data at ~2.9-3.5:1, and white-on-saffron user bubbles are ~3:1
  FILE: src/shared/styles/tokens.css:17 (usage: CompetitorCard.tsx:112-130, InlineReelResults.tsx:131-141,278, MemoryPage.tsx:178-186); ChatMessage.tsx:33
  FIX: Reserve #7A6A54 for truly decorative text; promote metric values/labels to --color-text-secondary (#C4A882, ~7.6:1 on surface). Switch user-bubble text to #1A1410 on saffron (matching the CTA buttons) or darken the bubble background; update DESIGN.md accordingly.

[medium] First-run with no keys is a dead end with developer-only instructions (and the documented Settings page doesn't exist)
  FILE: src/pages/ChatPage.tsx:390-399, src/lib/constants.ts:19, src/lib/errorMessages.ts:14,26 (routes: src/App.tsx:77-99)
  FIX: Either (a) add the Settings page the docs promise, letting team members paste keys into keysStore at runtime, or (b) rewrite the banner/error copy for the deployed reality ('Ask your admin to configure API keys for this deployment') and keep dev instructions behind import.meta.env.DEV.

[medium] Conversation delete is one-click destructive with no confirmation or undo
  FILE: src/components/ConversationSwitcher.tsx:68-77 and src/pages/ChatPage.tsx:347-350
  FIX: Add a lightweight confirm step (second click turns the icon into 'Delete?' for 3s) or a toast with Undo backed by keeping the deleted conversation in memory until timeout.

[low] Clarifying state shows a spinning 'Generating AI rationale' step while the pipeline is actually waiting on the user
  FILE: src/pages/ChatPage.tsx:558-567
  FIX: Add a 'paused/waiting' visual state to ProgressBubble (e.g. a pulsing question-mark or static accent ring instead of Loader2) when status === 'clarifying', or insert an explicit 'Waiting for your answer' pseudo-step.

[low] Design-system drift: off-token cool colors, inconsistent ER semantics, and metrics not in DM Mono
  FILE: src/components/InlineReelResults.tsx:55,109,117,130 (cold surfaces #1E1A2E/#13101E); DiscoveryCard.tsx:41,49,56,182 (greens #1A2E1A/#4DB88A, teal #1A2520/#4DB894/#2A3D35); CompetitorCard.tsx:121-133 vs DiscoveryCard.tsx:160-174; ReportPage.tsx:21,38
  FIX: Tokenize: one --color-er-above/--color-er-below pair (already defined in tokens.css:46-47 but unused), font-mono on all metric values, a warm-compatible --color-ai-surface for AI cards, serif-italic page titles everywhere. Also DESIGN.md:41 specifies a <link> tag for fonts but tokens.css:3 uses a render-blocking CSS @import — move to index.html with preconnect (index.html currently has neither, and its <title> is the dev artifact 'content-os').

[low] No prefers-reduced-motion handling for the always-animating chat
  FILE: src/index.css (entire file — no media query); animations at ChatMessage.tsx:88-90, InlineReelResults.tsx:55,109,315; ChatPage.tsx:276
  FIX: Add a global `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important } }` block in index.css, or use Tailwind's motion-safe: variants on the animate-* utilities.

[low] Selection-limit toast is invisible to assistive tech and selection state leaks across result sets
  FILE: src/pages/ChatPage.tsx:352-369,401-406
  FIX: Add role="status" aria-live="polite" to the toast. Either scope selection per result message (keyed by message.id) or surface the selected handles as removable chips next to the 'Analyze N' CTA so cross-result mixing is at least visible.

[low] Top nav won't communicate state as sections grow; Report nav item is a mystery-meat empty page until a deep run happens
  FILE: src/components/AppLayout.tsx:48-71 and src/pages/ReportPage.tsx:14-33
  FIX: Drive nav items from a small array (path, icon, label, optional badge fn) using NavLink's isActive. Show a dot/badge on Report when a report exists; longer-term, persist reports per conversation (they already snapshot into ReelResultMessage payloads — ReportPage could list those instead of mirroring the live store).

[low] Reel pipeline progress is coarse for its 2-9 minute duration (3 static steps per creator, no incremental signal)
  FILE: src/components/InlineReelResults.tsx:16,234-241 and src/pages/ChatPage.tsx:508-513
  FIX: Surface incremental detail in the quick path: reel count once the scrape returns ('12 reels found, analyzing hooks 3/12'), or at minimum an elapsed-time ticker on the active step so the UI visibly stays alive.

## dx
SUMMARY: This repo has genuinely strong test discipline (608 fast, mostly behavioral vitest tests; real-API evals properly cost-gated behind env keys; zero ts-ignores and only 3 explicit anys) but the scaffolding around that discipline is broken: the documented `npm run test` gate actually exits 1 on a fresh clone due to ~100+ unhandled real network calls to a placeholder Supabase host, both lockfiles are unusable (`npm ci` fails out-of-sync; bun.lock is missing two production dependencies while vercel.json builds with bun), and there is no CI, no hooks, and no enforcement of anything before merge. Onboarding is effectively impossible as written — no README, macOS-only setup commands for a Windows owner, a setup script living in a gitignored directory, and CLAUDE.md/AGENTS.md feeding every agent session stale architecture facts (localStorage keys, no backend, IndexedDB corpus, a Settings page that no longer exists). The highest-leverage fixes are cheap: hermetic-ize the Supabase test fallback, pick one package manager and commit a synced lockfile, add a 2-minute CI workflow, enable `strict: true` (verified zero errors today), and do one accuracy pass over CLAUDE.md and the version/CHANGELOG drift (VERSION says 3.4.0.0, HEAD commit says v3.5.0.0, no tags).

[critical] `npm run test` exits 1 despite all 608 tests passing — ~100-120 unhandled real-network rejections to placeholder.supabase.co
  FILE: src/lib/supabaseClient.ts:21-22 (root cause), vitest.config.ts:4-6
  FIX: Stub the Supabase storage layer in tests: either inject a no-op storage adapter when `import.meta.env.MODE === 'test'`, mock `src/lib/supabaseClient` globally via a vitest setupFile, or make persisted stores use an in-memory PersistStorage under vitest. Then treat unhandled errors as failures intentionally (they already are) and keep the suite at exit 0.

[critical] Both lockfiles are broken: `npm ci` fails out-of-sync, and bun.lock is two releases stale (missing @supabase/supabase-js and @clerk/backend) while vercel.json builds with bun
  FILE: bun.lock, package-lock.json, vercel.json:2
  FIX: Pick ONE package manager. Given vercel.json says bun: run `bun install` to regenerate bun.lock, delete package-lock.json, add `package-lock.json` to .gitignore (or the inverse: delete bun.lock, change vercel.json to `npm run build`, run `npm install` once and commit the synced lock). Add a CI step that runs the frozen-lockfile install so drift fails fast.

[high] Zero merge-gate enforcement: no CI workflows, no git hooks, nothing runs tests/lint/typecheck before merge
  FILE: .github/ (absent), .claude/launch.json, .git/hooks (samples only)
  FIX: Add `.github/workflows/ci.yml` running install (frozen lockfile) + `tsc -b` + `tsc -p api/tsconfig.json` + `eslint .` + `vitest run` on PRs — the whole suite takes ~12s, so CI would be <2 min. Optionally add a pre-push hook. This is the highest leverage 30 minutes available in this repo once finding #1 is fixed.

[high] Onboarding instructions are unrunnable: macOS-only brew command, setup script in a gitignored directory, no README, no local .env quickstart — owner is on Windows
  FILE: CLAUDE.md:11-17, AGENTS.md:5-19, .env.example:1-7, .gitignore:21
  FIX: Add a README.md with a cross-platform quickstart: (1) install via the chosen package manager (with Windows instructions — `powershell -c "irm bun.sh/install.ps1 | iex"` or just npm), (2) `cp .env.example .env` + which 3 vars are minimally required locally, (3) run/test/lint commands. Fix AGENTS.md `.Codex` → `.claude`. For scripts, use cross-env or document `$env:APIFY_KEY='...'; node scripts/test-discovery.mjs`.

[high] CLAUDE.md (the agents' primary context) materially misdescribes the architecture: claims no backend, localStorage keys, IndexedDB corpus, a Settings nav, and 578 tests
  FILE: CLAUDE.md:66, CLAUDE.md:78, CLAUDE.md:117, CLAUDE.md:138
  FIX: Do one accuracy pass over CLAUDE.md/AGENTS.md against current code (keys = build-time env; backend = one Vercel fn + Supabase w/ RLS; corpus = Supabase; no Settings page; drop the hardcoded test count or say '600+'). Make /ship or /document-release responsible for keeping the file map current, and generate AGENTS.md from CLAUDE.md instead of hand-copying.

[medium] Version/release bookkeeping drifted: HEAD commit says v3.5.0.0 but VERSION and package.json say 3.4.0.0, CHANGELOG has no 3.5.0.0 entry, and no git tags exist
  FILE: VERSION:1, package.json:4, CHANGELOG.md:7
  FIX: Backfill: set VERSION + package.json to 3.5.0.0, write the CHANGELOG entry from the (already detailed) commit message, and `git tag v3.4.0.0 e6d0a23 && git tag v3.5.0.0 4bcd3e3`. Add a CI check that VERSION == package.json version. Also consider whether the nonstandard four-segment 3.x.y.z scheme is worth keeping over semver — tooling (npm, Vercel) assumes three segments.

[medium] TypeScript strict mode is OFF for the entire app source — and enabling it is currently free (zero errors)
  FILE: tsconfig.app.json:2-23, tsconfig.node.json:2-22
  FIX: Add `"strict": true` to tsconfig.app.json and tsconfig.node.json now, while it costs nothing. One-line change, verified passing.

[medium] api/ serverless code is never typechecked by any command: api/tsconfig.json exists but nothing runs it
  FILE: api/tsconfig.json:2, tsconfig.json:3-6, package.json:6-16
  FIX: Add `"typecheck:api": "tsc -p api/tsconfig.json"` to package.json scripts and chain it into `build` (`tsc -b && tsc -p api/tsconfig.json && vite build`) and the future CI job.

[medium] No production error observability at all: no error tracker, and the privacy-motivated devLog design strips all diagnostic logging from prod
  FILE: src/lib/devLog.ts:14-20, src/lib/errorMessages.ts, src/lib/supabaseClient.ts:21-22
  FIX: Add a privacy-respecting error channel: at minimum a prod-enabled `devError`-style hook that reports error code + pipeline stage + key-index (never handles/niches/cities) to Sentry or even a Supabase `error_events` table the team already controls. Also replace the silent placeholder Supabase fallback with a visible startup warning banner like the existing keys banner (ChatPage.tsx:389-396 proves the pattern exists for Gemini/Apify keys).

[medium] Env validation is inconsistent across the four env groups: Clerk hard-fails, Gemini/Apify get a UI banner, Supabase fails silently, REEL_FN_SECRET drift only fails at call time
  FILE: src/main.tsx:9-11, src/pages/ChatPage.tsx:389-396, src/lib/supabaseClient.ts:21-22, .env.example:36-39
  FIX: Add a single `src/lib/env.ts` that validates all required VITE_ vars at startup (zod is already a dependency) and feeds one consolidated 'configuration incomplete: missing X, Y' banner — reusing the existing ChatPage banner pattern. Have /api/analyze-reel-video return a distinct error code for secret mismatch so the client can say so.

[low] ESLint only covers *.ts/*.tsx — scripts/*.mjs and all config files are unlinted; no formatter (Prettier) or format check anywhere
  FILE: eslint.config.js:11, scripts/test-discovery.mjs:28-37
  FIX: Add a `{ files: ['**/*.{js,mjs}'], extends: [js.configs.recommended], languageOptions: { globals: globals.node } }` block to eslint.config.js. Longer term, replace the inline-duplicated script logic with imports from src/lib via vite-node/tsx so the gates test the real code.

[low] Stale planning docs at repo root contradict shipped reality (TODOS.md all-unchecked, PLAN.md still 'DRAFT' for shipped features)
  FILE: TODOS.md:13-16, PLAN.md:7, PLAN-smart-pipelines.md:6
  FIX: Move PLAN*.md and TODOS.md into .planning/archive/ (the .planning/ convention already exists) with a one-line 'shipped in v2.x, see CHANGELOG' header, or mark statuses SHIPPED. Keep repo root to README/CLAUDE/DESIGN/CHANGELOG.

[low] Test suite is fast and mostly behavioral, with eval/integration tests correctly cost-gated — but coverage-gaps.test.ts signals metric-driven testing
  FILE: src/lib/coverage-gaps.test.ts:1-12, src/ai/__evals__/intent.eval.test.ts:56, api/analyze-reel-video.integration.test.ts:34-37
  FIX: When any test in coverage-gaps.test.ts next fails, relocate it into the owning module's test file (transformers.test.ts etc.) instead of fixing it in place; avoid adding new tests to this file.

## performance
SUMMARY: Content OS 2.0 ships as a single 587.7 kB (163.7 kB gzip) JS chunk with no code-splitting and ~220 kB of provably dead or oversized vendor code (unused Supabase auth/realtime/storage subsystems, full zod for 5 tiny schemas). The heaviest runtime cost is sync chattiness: both persisted Zustand stores write their ENTIRE state to Supabase on every set(), which during a deep reel run means ~100+ full-state upserts of a multi-hundred-KB payload, while ChatPage subscribes to whole stores without selectors and renders an unmemoized transcript, so every per-reel progress tick re-renders every result card in the conversation. Network pipelines (Apify rounds, Gemini prompts) are well-parallelized and dedup within a run; the corpus write path and the duplicate full-corpus hydration are the remaining network inefficiencies. Profile/reel images are hotlinked raw from Instagram's CDN with no referrerPolicy or lazy loading, so most likely never load at all.

[high] Persisted Zustand stores upsert full state to Supabase on every set() — ~100+ multi-hundred-KB writes per deep reel run
  FILE: src/store/supabaseStorage.ts:26-31, src/store/reelAnalysisStore.ts:140-211, src/store/conversationsStore.ts:174-179
  FIX: Debounce/coalesce setItem (e.g. trailing 2-5 s debounce per key with flush on visibilitychange/beforeunload), or persist only on terminal states for the reel store (partialize already exists — gate writes on synthesisStatus/deepReportStatus being terminal, matching the existing isCleanReelRun merge guard which already discards mid-run snapshots anyway). For conversations, write only the changed conversation row (one row per conversation keyed by id) instead of the whole map.

[high] Single 587.7 kB bundle; ~165 kB is unused Supabase subsystems and ~56 kB is zod used for 5 small schemas
  FILE: vite.config.ts:5-7, src/lib/supabaseClient.ts:24-26, src/tools/agentTools.ts:19,134-171
  FIX: 1) Replace `createClient` from @supabase/supabase-js with `PostgrestClient` from @supabase/postgrest-js (~15 kB) and inject the Clerk JWT via a per-request Authorization header — the app only uses .from() queries. 2) Swap zod for `zod/mini` or hand-rolled guards in agentTools.ts. 3) Add manualChunks (e.g. react/react-dom, clerk, data layer) in vite.config.ts for cache-stable vendor chunks. Route-level lazy() for MemoryPage/ReportPage is cheap but low-yield (app source is only ~15 kB of the bundle) — do it last.

[high] ChatPage subscribes to whole stores and renders an unmemoized transcript — every progress tick re-renders all result cards
  FILE: src/pages/ChatPage.tsx:54,98-100, src/hooks/useReelAnalysis.ts:65-82, src/hooks/useCompetitorAnalysis.ts:39, src/hooks/useLocationDiscovery.ts:38
  FIX: 1) Replace whole-store subscriptions with per-field selectors (the file already does this correctly for discoveryStore — apply the same to useAnalysisStore and useReelAnalysisStore; useReelAnalysis should select only what it returns). 2) Wrap ChatMessage, CompetitorResultMessage, DiscoveryResultMessage, ReelResultMessage, CompetitorCard, DiscoveryCard in React.memo and memoize deriveCompetitorView/deriveDiscoveryView with useMemo keyed on payload. 3) Move the textarea into its own component so typing doesn't re-render the transcript. 4) Gate the auto-scroll on 'user is at bottom' and drop creatorStates from its deps. Virtualization is optional given the 50-message cap (conversationsStore.ts:26) — memo fixes 90% of it.

[medium] Corpus remember() is a sequential per-creator waterfall: 2N+2 Supabase round trips per pipeline result
  FILE: src/lib/supabaseCorpus.ts:96-135
  FIX: Batch: one `upsert(rows)` for all hasData creators, one `upsert(rows, { ignoreDuplicates: true })` for the rest, and one `insert(sightingRows)` — Supabase accepts arrays for all three. Keeps identical semantics (per-row conflict handling) at 3-4 round trips total.

[medium] Full corpus is downloaded twice at startup and held unbounded in memory; MemoryPage has no pagination
  FILE: src/App.tsx:38, src/components/AppLayout.tsx:30-32, src/store/corpusStore.ts:44-47, src/lib/supabaseCorpus.ts:166-178
  FIX: Guard hydrate() with the existing `hydrated` flag (or dedupe via an in-flight promise) and remove one of the two call sites. Hydrate a bounded slice for badges (e.g. list({ limit: 500 }) of usernames + recognition fields, skipping sightings), and make MemoryPage query its own sorted/paginated page server-side (the SORT_COLUMN map already exists) with sightings fetched per expanded card.

[medium] Instagram CDN images hotlinked with no referrerPolicy, no lazy loading, and expiring signed URLs in persisted snapshots
  FILE: src/components/CompetitorCard.tsx:71-80, src/components/InlineReelResults.tsx:270-275,333-338, src/pages/MemoryPage.tsx:152-160
  FIX: Add `referrerPolicy="no-referrer"` and `loading="lazy"` to every Instagram-CDN <img>. Verify in the network tab whether pics currently load at all; if they do not, that single attribute restores them. For persisted result messages, accept the initials fallback or proxy/cache avatars (e.g. a tiny serverless image proxy) since signed URLs cannot be stored long-term.

[low] Google Fonts loaded via @import inside bundled CSS — render-blocking request chain with no preconnect
  FILE: src/shared/styles/tokens.css:3, index.html:1-13
  FIX: Move the font stylesheet into index.html as `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` + `<link rel="stylesheet" ...>` (or self-host the 3 families as woff2 in /public with @font-face) and delete the @import.

[low] Apify polling is a fixed 2 s interval with no backoff; in-run dedup is solid but nothing is reused across runs
  FILE: src/lib/apifyCore.ts:17,154-198, src/lib/reelScraper.ts:111, src/lib/apifyClient.ts:151-201
  FIX: Use a mild backoff (2 s start, ×1.5 to a 6-8 s cap) in pollRun — actor runs take 25-60 s so early 2 s polls are wasted. Higher leverage: before scrapeHandles, serve profiles whose corpus lastSeenAt is < N hours old from the corpus mirror and scrape only stale handles (the NormalizedProfile fields needed for prompts/cards are already persisted in corpus_creators).

[low] Gemini usage is efficient — prompts are line-capped, history is windowed; no action needed (informational)
  FILE: src/ai/prompts.ts:106,131,296, src/hooks/useAgentConversation.ts:35, src/tools/agentTools.ts:106-125
  FIX: No change required. If candidate pools grow past ~150 profiles, cap the serialized pool before prompting (pre-rank by ER/followers in code) rather than raising maxOutputTokens.

