# Content OS 2.0

## gstack

This project ships with [gstack](https://github.com/garrytan/gstack) under `.Codex/skills/gstack`. Use it for browsing, planning, reviewing, and shipping work.

### Teammate setup (one-time)

After cloning the repo:

```bash
# 1. Install bun (gstack dependency)
brew install oven-sh/bun/bun

# 2. Run the gstack setup to link skills + install browsers
cd .Codex/skills/gstack && ./setup
```

This links gstack's slash commands into `~/.Codex/commands/` and downloads the Playwright browsers used by `/browse`.

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

**Content OS 2.0** — a browser-based Instagram research tool. No backend. All API keys stored in `localStorage`. Two pipelines:

1. **Competitor Analysis** — scrape reference accounts → extract `relatedProfiles` → Gemini ranking → top/trending cards
2. **Location Discovery** — city + niche → hashtag generation → profile scrape → location filter → AI-ranked creator cards

Entry point: `ChatPage` — conversational interface that routes to either pipeline based on Gemini intent classification.

## Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # TypeScript check + Vite build
npm run test         # Run 420 unit tests (vitest)
npm run test:watch   # Watch mode
npm run lint         # ESLint
npm run test:discovery  # Integration test for discovery pipeline (needs real API keys)
```

## Project structure

```
src/
  pages/
    ChatPage.tsx              # Primary entry point — conversational UX
    DiscoveryResultsPage.tsx  # Location discovery results
    ResultsPage.tsx           # Competitor analysis results
    SettingsPage.tsx          # API key management
  hooks/
    useConversation.ts        # Chat orchestration state machine
    useActivePipeline.ts      # Reads PIPELINE_REGISTRY, computes active pipeline state
    useCompetitorAnalysis.ts  # TanStack Query mutation for competitor pipeline
    useLocationDiscovery.ts   # TanStack Query mutation for discovery pipeline
  ai/
    intentParser.ts           # Gemini intent classification (pipeline routing)
    gemini.ts                 # Gemini REST API caller (no SDK)
    prompts.ts                # Prompt builders for all Gemini calls
  lib/
    apifyCore.ts              # Shared Apify primitives (startRun, pollRun, fetchDataset)
    apifyClient.ts            # Competitor pipeline scraper (3-round with hashtag expansion)
    discoveryClient.ts        # Discovery pipeline (hashtag → scrape → location filter)
    hashtagGenerator.ts       # Gemini micro-call for location-aware hashtags
    locationFilter.ts         # Bio-text city matching with alias map
    transformers.ts           # Apify raw → NormalizedProfile
    keyRotator.ts             # Round-robin Apify key selection with cooldown
    storage.ts                # Cross-runtime storage adapter (browser / Node)
    constants.ts              # Shared string constants
  tools/
    registry.ts               # PIPELINE_REGISTRY — confirmMessage + confirmOptions per pipeline
    types.ts                  # Shared TypeScript types
  store/
    analysisStore.ts          # Zustand store — competitor analysis state
    discoveryStore.ts         # Zustand store — discovery state
    keysStore.ts              # Zustand store — API keys (persisted)
  components/
    AppLayout.tsx             # Top nav bar + Outlet
    ChatMessage.tsx           # Chat bubble with optional options
    ChatOptions.tsx           # Confirm option buttons with label prop
    ClarificationCard.tsx     # Inline clarification prompt
    DiscoveryCard.tsx         # Creator card for discovery results
    CompetitorCard.tsx        # Competitor card for analysis results
    ProgressSteps.tsx         # Inline progress step indicator
  shared/
    utils/categories.ts       # COMPETITOR_CATEGORIES + DISCOVERY_CATEGORIES
    utils/export.ts           # CSV + clipboard export formatters
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
