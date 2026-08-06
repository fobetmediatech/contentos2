# Content OS 2.0

## gstack

This project ships with [gstack](https://github.com/garrytan/gstack) under `.claude/skills/gstack`. Use it for browsing, planning, reviewing, and shipping work.

### Teammate setup (one-time)

After cloning the repo:

```bash
# 1. Install bun (Windows — PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
# macOS: brew install oven-sh/bun/bun
# Linux: curl -fsSL https://bun.sh/install | bash

# 2. Run the gstack setup to link skills + install browsers
cd .claude/skills/gstack && ./setup
```

This links gstack's slash commands into `~/.claude/commands/` and downloads the Playwright browsers used by `/browse`.

### Browsing rule

For ALL web browsing, ALWAYS use the `/browse` skill from gstack.
NEVER use `mcp__claude-in-chrome__*` tools.

### Available gstack skills

- `/office-hours` — open-ended discussion / advice
- `/plan-ceo-review` — plan review from a CEO perspective
- `/plan-eng-review` — plan review from an engineering perspective
- `/plan-design-review` — plan review from a design perspective
- `/plan-devex-review` — plan review from a devex perspective
- `/design-consultation` — design consultation
- `/design-shotgun` — rapid design exploration
- `/design-html` — generate HTML design
- `/design-review` — review existing design
- `/devex-review` — review developer experience
- `/review` — code review of the current diff
- `/cso` — security review (chief security officer)
- `/ship` — finalize and ship work
- `/land-and-deploy` — land and deploy a branch
- `/canary` — canary release flow
- `/benchmark` — benchmarks
- `/browse` — web browsing (use this instead of Chrome MCP)
- `/connect-chrome` — connect to Chrome
- `/setup-browser-cookies` — set up browser cookies
- `/qa` — QA a URL
- `/qa-only` — QA only (no other steps)
- `/setup-deploy` — set up deployment
- `/setup-gbrain` — set up gbrain
- `/retro` — retrospective
- `/investigate` — investigate an issue
- `/document-release` — document a release
- `/document-generate` — generate documentation
- `/codex` — codex workflow
- `/autoplan` — auto-generate a plan
- `/careful` — careful mode
- `/freeze` — freeze
- `/guard` — guard
- `/unfreeze` — unfreeze
- `/gstack-upgrade` — upgrade gstack
- `/learn` — learn / capture lessons

## Project overview

**Content OS 2.0** — a browser-based Instagram research SaaS (internal team tool).

**Chat pipelines** — invoked from `ChatPage` by Gemini function-calling (tool defs in `src/tools/agentTools.ts`):

1. **Competitor Analysis** (`discover_competitors`) — scrape reference accounts → extract `relatedProfiles` → Gemini ranking → top/trending cards
2. **Location Discovery** (`discover_by_location`) — city + niche → hashtag generation → profile scrape → location filter → AI-ranked creator cards
3. **Reel Hook Analysis** (`analyze_reels`) — scrape top reels → Gemini hook analysis per creator → cross-creator pattern synthesis
4. **Single-Reel Analysis** (`analyze_single_reel`) — one reel URL → deep case-study breakdown
5. **Repurpose Reel** (`repurpose_reel`) — viral reel → rewritten in a client's voice
6. **Transcript** (`get_reel_transcript`) — one reel URL → transcript only (the fast path)

**Transcript intelligence** (NOT chat-routed) — Fireflies call → cited brief → deck:
`/strategy` (meeting list) → `/strategy/meeting/:externalId` (ingest + context docs + analysis) →
`/strategy/review/:clientId` (cited brief review) → `/strategy/deck/:clientId` (the FOBET deck).
The blank onboarding form now lives at `/strategy/brief`. Backed by six `cb_` tables with
**admin-only RLS** — transcripts carry client margins and ticket sizes, unlike every other table
here which is open to any signed-in member.

**Other dedicated-page features** (NOT chat-routed): Script Studio (`/script-studio`), Content
Calendar (`/calendar`), Payments (`/payments`, finance-only), Gallery (`/gallery`), Tracking
Dashboard (`/tracking`).

Entry point: `ChatPage` — conversational interface that routes to the chat pipelines above.

**Backend:** Eleven Vercel serverless functions under `api/` (see the tree below). All are gated by
Clerk JWT via `api/_lib/auth.ts` — except `warm-voice-profile.ts`, which is secret-gated for a
scheduled GitHub Action instead. Supabase (Postgres + RLS) backs conversation sync (`user_state`),
the shared team corpus (`corpus_creators`, `corpus_sightings`, `corpus_content`), and the feature
tables for strategies, calendar, payments, tracking, voice profiles and the creator directory.

**Keys:** Gemini and Apify keys live **server-side only** (`process.env`, set in Vercel dashboard — never `VITE_` prefixed). The browser needs only three env vars: `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. `src/lib/env.ts` validates these at startup and surfaces a banner if any are missing.

## Commands

```bash
bun run dev          # Start Vite dev server
bun run build        # Typecheck (app + api) + Vite build
bun run test         # Run 1100+ unit tests (vitest) — exits 0 on a fresh clone, no keys needed
bun run test:watch   # Watch mode
bun run lint         # ESLint
bun run typecheck:api        # Typecheck api/ directory only
bun run test:discovery       # Integration test for discovery pipeline (needs real API keys)
```

**Package manager: bun** (not npm/yarn — `vercel.json` builds with bun; `bun.lock` is the authoritative lockfile; `package-lock.json` is gitignored).

## Project structure

```
src/
  pages/                      # 16 pages — nav order is driven by NAV_SECTIONS in AppLayout.tsx
    ChatPage.tsx              # Primary entry point — single-surface conversational UX (results render inline)
    StrategyPage.tsx          # The onboarding FORM, now at /strategy/brief (not /strategy). Also the
                              #   handoff target after a brief review — do NOT move it back without
                              #   updating StrategyReviewPage's navigate(), or the brief is dropped.
    StrategyClientPage.tsx    # /strategy/:id — a saved client read-only + Attachments (upload/download/delete, informational only)
    StrategyMeetingsPage.tsx  # /strategy — THE ENTRY POINT. Fireflies call list, filter + sort
    StrategyMeetingPage.tsx   # /strategy/meeting/:externalId — ingest → context docs → run analysis
    StrategyReviewPage.tsx    # /strategy/review/:clientId — pre-filled brief with visible provenance + citations
    StrategyDeckPage.tsx      # /strategy/deck/:clientId — the FOBET deck (iframe; `sample` previews free)
    ScriptStudioPage.tsx      # Reference reel/Short → new-topic script; 3 modes (link, library pick, choose a creator)
    CalendarPage.tsx          # Content calendar (plan-only) — month grid, drag to reschedule, per-tracked-account or all
    PaymentsPage.tsx          # Manual payment tracking per client — FINANCE ROLE ONLY (useIsFinance + Supabase RLS)
    MemoryPage.tsx            # Browse the creator/content corpus remembered across searches
    GalleryPage.tsx           # Every reel the OS has scraped; click expands to an IG-desktop-style modal
    TrackingListPage.tsx      # "Dashboard" — tracked accounts list + latest snapshots
    TrackingAccountPage.tsx   # /tracking/:username — per-account snapshot history + reel trends
    TeamAccessPage.tsx        # Admin-only — grant/revoke the finance role by email (RLS + SECURITY DEFINER enforce)
    SignInPage.tsx            # Clerk auth gate, themed to DESIGN.md
  hooks/                      # 17 hooks — the pipeline orchestrators plus small shared utilities
    useAgentConversation.ts   # Turn-based agent loop — THE conversation engine (latest-wins steering)
    useActivePipeline.ts      # Reads PIPELINE_REGISTRY, computes active pipeline state
    agentRunLaunch.ts         # One run per URL, each with its own AbortSignal (no sibling aborts)
    useCompetitorAnalysis.ts  # Competitor pipeline (discover → clarify → rank)
    useLocationDiscovery.ts   # Discovery pipeline
    useReelAnalysis.ts        # Reel scrape + hook analysis + synthesis; self-contained deep-report run
    useSingleReelAnalysis.ts  # Chat-triggered "analyze ONE reel by URL"
    useTranscriptAnalysis.ts  # Chat-triggered transcript-only path
    useRepurposeReel.ts       # Chat-triggered "rewrite a viral reel in a client's voice"
    useContentStrategy.ts     # Content Strategizing — the 4-stage pipeline (scrape → aspirational → reels → write)
    useCreatorScript.ts       # Script Studio "Choose a creator" — handle + idea → script in their voice
    useReelRemix.ts           # Script Studio orchestration (transcribe → remix)
    useIsAdmin.ts / useIsFinance.ts  # Role checks (UX only — Supabase RLS is the real enforcement)
    useSlashMenu.ts           # The "/" tool-picker state machine for the chat input
    useColorScheme.ts         # Effective light/dark (honours the manual toggle, not just the OS)
    useElapsedTime.ts         # Live seconds counter for long-running pipelines
  ai/
    gemini.ts                 # Gemini REST API caller (no SDK) — proxies through /api/gemini with Clerk Bearer token
    prompts.ts                # Prompt builders for all Gemini calls
    prompts/                  # Per-feature prompt modules (e.g. deepReelAnalysis)
  lib/
    env.ts                    # Zod validation of the 3 browser-side env vars; envErrors feeds App.tsx banner
    apifyCore.ts              # Shared Apify primitives (startRun, pollRun, fetchDataset) — proxies through /api/apify
    apifyClient.ts            # Competitor pipeline scraper (3-round with hashtag expansion)
    discoveryClient.ts        # Discovery pipeline (hashtag → scrape → location filter)
    hashtagGenerator.ts       # Gemini micro-call for location-aware hashtags
    locationFilter.ts         # Bio-text city matching with alias map
    transformers.ts           # Apify raw → NormalizedProfile
    keyRotator.ts             # Round-robin Apify key selection with cooldown
    reelScraper.ts            # Top-reels scrape for a handle (NoReelsError when none)
    reelAnalyzer.ts           # Hook analysis + cross-creator synthesis + deep niche report
    reelVideoClient.ts        # Batch-resolve reel video URLs (deep multimodal path)
    reelSnapshot.ts           # buildReelResultPayload — snapshot a finished reel run (per-conversation parity)
    singleReelCache.ts        # IndexedDB cache for deep per-reel analyses (free re-runs)
    quickReelCache.ts         # Cache for the fast transcript/quick path
    corpus.ts                 # Pure corpus core (mergeCreator, recognition, CorpusRepository interface)
    corpusIdb.ts              # Re-exports createSupabaseCorpus() as `corpus` — filename kept for import compat
    supabaseCorpus.ts         # Supabase-backed CorpusRepository (the shared team brain)
    supabaseClient.ts         # Single Supabase client — Clerk JWT via accessToken callback
    corpusHarvest.ts          # Map pipeline results → corpus creator/content records
    errorMessages.ts          # Fixed, user-safe error strings (code-keyed; never raw API bodies)
    devLog.ts                 # DEV-only console helpers (C3 — research-target data never logs in prod)
    clerkToken.ts             # Clerk session-token access for plain modules (wired once from App.tsx)
    storage.ts                # Cross-runtime storage adapter (browser / Node)
    constants.ts              # Shared string constants
    # — feature repos (Supabase-backed) —
    strategyRepo.ts           # Saved client strategies + attachments (signed URLs; bytes never parsed)
    calendarRepo.ts           # Scheduled posts
    trackingDb.ts / trackingClient.ts  # Tracked accounts + snapshots
    creatorDirectory.ts       # Team-shared creator directory (Script Studio voices)
    teamAccess.ts             # Role grant/revoke RPC wrappers
    # — Script Studio / repurpose —
    reelTranscriber.ts, reelTranscriptClient.ts, transcriptCache.ts, youtubeTranscript.ts,
    remixFields.ts, repurposeHelpers.ts, singleReelClient.ts, singleReelCache.ts,
    quickReelCache.ts, reelDigest.ts, reelHookmap.ts, reelUrl.ts, sourceUrl.ts
    # — misc —
    geminiKeyRotator.ts       # Gemini key pool rotation (mirrors keyRotator for Apify)
    deckThemes.ts             # Deck palette presets + resolveDeckColors
    sampleStrategy.ts         # SAMPLE_RESULT + SAMPLE_EXTRACTIONS — preview the review UI + deck free
    deckTemplate.ts           # FOBET deck slot filling over src/deck/fobetDeck.html (imported ?raw)
    reviewGate.ts             # Pure — extractions → StrategyBrief + the export gate
    reviewRepo.ts             # cb_clients / cb_extractions access
    meetingsClient.ts         # Browser → /api/clients + /api/strategy-ai
    googleAuth.ts / googleExport.ts  # One-click export to Google Docs/Sheets
    competitorCache.ts, deriveNiche.ts, actors.ts, abortControl.ts, runControllers.ts,
    attachment.ts, fxRates.ts, knowledgeSeed.ts, webFallback.ts, toast.ts, clerkTheme.ts, konami.ts
  tools/
    registry.ts               # PIPELINE_REGISTRY — confirmMessage + confirmOptions per pipeline
    agentTools.ts             # Agent-loop tool defs + buildGeminiHistory
    types.ts                  # Shared TypeScript types
  store/                      # 15 stores. Every PERSISTED one needs `version` + `migrate` (see below)
    analysisStore.ts          # Competitor analysis state + ResultPayload union
    discoveryStore.ts         # Discovery state
    reelAnalysisStore.ts      # Reel run state (persisted; reelConversationId tags the owning chat)
    repurposeStore.ts         # Repurpose Reel run state (transient)
    runsStore.ts              # Per-run records (persisted) — one row per launched pipeline run
    strategyStore.ts          # Content Strategizing brief (form draft) + last result; both persisted
    conversationsStore.ts     # Multi-conversation chat history (persisted) + legacy migration
    corpusStore.ts            # Corpus hydration + remembered count
    creatorDirectoryStore.ts  # Sync mirror over the team-shared creator directory
    trackingStore.ts          # Tracking dashboard UI state (in-flight fetches + errors)
    themeStore.ts             # Light/dark preference driving `data-theme` on <html>
    keysStore.ts              # Key store shim (empty — keys live server-side)
    persistStorage.ts         # Import-safe persist storage wrapper (never throws)
    reelPersist.ts            # Reel persist guard — drop interrupted mid-runs on restore
    supabaseStorage.ts        # Zustand PersistStorage backed by the Supabase user_state table
  domain/                     # Shared domain types (strategy, chat, reel, runs)
```

```
api/                          # 11 serverless functions. Clerk-gated unless noted.
                              # HARD CAP: Vercel's Hobby plan allows 12 Serverless Functions per
                              # deployment, and EVERY file in api/ is one. Files in api/_lib/ are
                              # not. Exceeding it fails at "Deploying outputs..." with a clean
                              # build — add actions to an existing endpoint, don't add files.
  gemini.ts                   # Clerk JWT gate → Gemini REST proxy (model + endpoint allowlist)
  apify.ts                    # Clerk JWT gate → Apify REST proxy (actor-ID allowlist)
  config.ts                   # GET /api/config — { geminiReady, apifyReady } flags (never key material)
  analyze-reel-video.ts       # Deep multimodal reel analysis (Gemini Files API)
  analyze-single-reel.ts      # Deep case-study analysis of ONE reel
  get-transcript.ts           # Transcript-only extraction for ONE reel (SSRF-allowlisted video host)
  image-proxy.ts              # Proxies IG CDN images (their CDN blocks cross-origin <img>)
  team-access.ts              # ADMIN-ONLY: grant the finance role by email (needs the Clerk secret key)
  clients.ts                  # ADMIN-ONLY. actions: list | create | add-email | link-strategy
                              #   | list-meetings | ingest-meeting (delegates to _lib/handlerIngest)
  strategy-ai.ts              # ADMIN-ONLY dispatcher. actions: extract | deck-slots | ask
                              #   (delegates to _lib/handlerExtract / handlerDeckSlots / handlerAsk)
  warm-voice-profile.ts       # SECRET-gated (not Clerk) — background warmer run by a GitHub Action cron
  _lib/                       # 23 shared modules. All are SERVER-SIDE, ESM, self-contained —
                              # they must NOT import from ../src. Handler bodies live here so they
                              # do not count against the 12-function cap.
    auth.ts                   # requireClerkUser() — shared Clerk JWT verification
    geminiFiles.ts            # Gemini Files API helper (upload + generate)
    geminiText.ts             # Server-side text-only generateContent
    geminiJson.ts             # Text→JSON call with a responseSchema (+ pickGeminiKey)
    apifyRun.ts               # run-sync-get-dataset-items with a round-robin key ring
    deepReelPrompt.ts         # Prompt builder for the deep multimodal path
    singleReelPrompt.ts       # Single-reel deep analysis prompts
    transcriptPrompt.ts       # Transcript-only prompt (TRANSCRIPT_PROMPT_VERSION lives here)
    voiceProfilePrompt.ts     # Voice Profile prompt + schema + type
    warmSelector.ts           # Pure selector — which directory handles to warm next
    # — transcript intelligence —
    handlerIngest.ts          # Fireflies list + ingest (chunk, embed, exact-email join)
    handlerExtract.ts         # Brief extraction w/ citation verification + context documents
    handlerDeckSlots.ts       # Writes the deck's 10 AI slots
    handlerAsk.ts             # QnA — metadata + semantic retrieval, grounded
    transcriptSource.ts       # TranscriptSource interface + FirefliesSource (minutes→sec at the boundary)
    chunkTranscript.ts        # Pure speaker-turn chunking w/ overlap (start_sec survives)
    embed.ts                  # gemini-embedding-2 @ 768; throws on dim mismatch, refuses partial batches
    verifyExtraction.ts       # Pure — every citation checked VERBATIM against its chunk
    extractionPrompt.ts       # The 9 extractable fields (handles excluded by design)
    deckSlots.ts              # The 10 AI deck slots (keys mirrored from src, drift-tested)
    contextDocs.ts            # Validate/decode uploads — files go to Gemini, never parsed here
    sheetRow.ts               # Sales-sheet row → sheet-provenance extractions
    askQuery.ts               # Pure query planner: metadata vs semantic retrieval
  tsconfig.json               # Separate tsconfig for Vercel functions (nodenext, strict: true)
```

**Note on `api/` queries:** these functions talk to Supabase over PostgREST, so table and column
names are plain strings. TypeScript, ESLint and the test suite cannot verify them — a wrong column
name compiles, lints and tests clean, then fails at runtime. Check queries against the migration.

```
src/
  components/
    AppLayout.tsx             # Top nav + Outlet. NAV_SECTIONS is the single source of truth:
                              #   Chat | Strategy | Script Studio | Calendar | Payments* | Memory | Gallery | Dashboard
                              #   (*financeOnly; Team Access + Sign-in are routed but not in the nav). NO Settings page.
    ChatMessage.tsx           # Chat bubble with optional options
    CompetitorResultMessage.tsx  # Inline competitor results (results-as-messages)
    DiscoveryResultMessage.tsx   # Inline discovery results
    ReelResultMessage.tsx        # Inline snapshot of a finished reel run
    InlineReelResults.tsx     # Reel run rendering, shared by the live block + snapshots
    ConversationSwitcher.tsx  # New / switch / delete conversations
    ClarificationCard.tsx     # Inline clarification prompt
    CompetitorCard.tsx        # Competitor card for analysis results
    DiscoveryCard.tsx         # Creator card for discovery results
    FeedbackControl.tsx       # Save/dismiss verdict control (Phase 3 self-training capture)
    ProgressSteps.tsx         # Inline progress step indicator
  shared/
    utils/categories.ts       # COMPETITOR_CATEGORIES + DISCOVERY_CATEGORIES
    utils/export.ts           # CSV + clipboard + markdown export formatters
```

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, border radii, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

Key rules from DESIGN.md:
- Fonts: Instrument Serif (display/italic), Outfit (body/UI), DM Mono (metrics/data)
- Background: #1A1410 (chai dark) — NOT slate-50 or white
- Accent: #E07B3A (saffron orange) — NOT indigo-600
- All neutrals must have warm undertones — no pure Tailwind slate grays
- AI-generated content only uses the violet tint (#A78BFA)
- In QA mode, flag any code that uses Inter, slate colors, or indigo as the accent

## Extension conventions

These patterns are the official extension guide (Phase 7). Deviating requires explicit justification.

### Adding a new pipeline

1. Add a tool entry in `src/tools/agentTools.ts` — one record with `declaration`, `zod schema`, and `toAction`.
2. Add a dispatch branch in `useAgentConversation.ts` → `dispatchTool()`.
3. Create a store with `version: 1` and an identity `migrate` (see `analysisStore.ts` / `discoveryStore.ts`).
4. Create a `useXxxPipeline.ts` hook using `lib/runRankedPipeline.ts` scaffolding.
5. Create a `XxxResultMessage.tsx` result component and wire it into `ChatPage`'s render block.
6. Add an entry to `PIPELINE_REGISTRY` in `src/tools/registry.ts`.
7. **In the same PR:** add at least one eval case in the agent golden-set (`agentLoop.eval.test.ts`).

Persisted payload `kind` discriminants are **frozen** — changing them silently breaks stored conversations.

### Adding a new nav section

Add one entry to `NAV_SECTIONS` in `src/components/AppLayout.tsx`:
```ts
{ path: '/new-section', label: 'Label', icon: SomeIcon }
```
Then add the route in `src/App.tsx` under the `<Route element={<AppLayout />}>` block. Nav, active states, and routing all derive automatically.

### Adding a new server capability

Create `api/<name>.ts` using the pattern in any existing `api/*.ts`:
- Import `requireClerkUser` from `api/_lib/auth.ts` (Clerk JWT gate — required on every function).
- Read keys from `process.env` only — never `VITE_` env vars.
- Add to Vercel dashboard env vars; update `.env.example` with a comment-only placeholder.

### Persisted store schema changes

Every persisted Zustand store must have `version: N` and a `migrate(state, version)` function. Increment `version` with every shape change and handle old versions in `migrate`. This prevents silent data loss on restores.

### Releasing

1. Bump `VERSION` and `package.json` `version` to the same value (CI checks they match).
2. Add a CHANGELOG entry under the new version heading.
3. Git tag: `git tag v<version>` + push tags.
4. Run `/document-release` after shipping to keep CLAUDE.md's file map current.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **contentos2** (2226 symbols, 4596 relationships, 182 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/contentos2/context` | Codebase overview, check index freshness |
| `gitnexus://repo/contentos2/clusters` | All functional areas |
| `gitnexus://repo/contentos2/processes` | All execution flows |
| `gitnexus://repo/contentos2/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
