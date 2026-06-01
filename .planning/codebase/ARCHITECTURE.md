# Architecture

## High-Level Shape

- The application is a client-only Instagram research tool with two coordinated pipelines:
  - competitor analysis
  - location discovery
- The conversational interface in `src/pages/ChatPage.tsx` is the primary entry point and now owns the “front door” for both flows.
- Routing is declarative in `src/App.tsx`, with separate result pages for each pipeline and a settings page for keys.

## Main Layers

### UI Layer

- Page components live in `src/pages/`.
- Reusable display components live in `src/components/`.
- `src/components/AppLayout.tsx` wraps route content.
- `ChatPage` is stateful and acts like a controller-view for the conversational experience.

### Orchestration Layer

- Hooks in `src/hooks/` orchestrate long-running workflows.
- `src/hooks/useConversation.ts` is the central state-machine coordinator for user messages, pipeline routing, confirm-state handling, and fallback behavior.
- `src/hooks/useCompetitorAnalysis.ts` runs the competitor mutation.
- `src/hooks/useLocationDiscovery.ts` runs the discovery mutation.
- `src/hooks/useActivePipeline.ts` bridges both stores into one UI-facing pipeline state.

### AI Layer

- `src/ai/intentParser.ts` classifies user intent and chooses `competitor` vs `discovery`.
- `src/ai/prompts.ts` builds all structured prompts.
- `src/ai/gemini.ts` owns the JSON-mode REST client and response coercion.

### Data Access Layer

- `src/lib/apifyCore.ts` is the low-level transport layer for Apify actor execution.
- `src/lib/apifyClient.ts` handles multi-round competitor discovery.
- `src/lib/discoveryClient.ts` handles hashtag-based location discovery, enrichment, and filtering.
- `src/lib/transformers.ts` normalizes raw Apify profile output into internal profile objects.
- `src/lib/locationFilter.ts` narrows candidates using city signals in profile bios.

### State Layer

- `src/store/analysisStore.ts` tracks the conversational competitor flow.
- `src/store/discoveryStore.ts` tracks the discovery flow.
- `src/store/keysStore.ts` tracks API keys and derived readiness.

## Data Flow

1. User types into `src/pages/ChatPage.tsx`.
2. `src/hooks/useConversation.ts` appends the message and calls `parseIntent(...)`.
3. Parsed intent routes to either:
   - competitor seed discovery, then confirm-state, then `useCompetitorAnalysis`
   - direct discovery confirm-state, then `useLocationDiscovery`
4. Pipeline hooks call Apify/Gemini helpers and update Zustand stores.
5. `useActivePipeline` exposes unified progress state back to `ChatPage`.
6. Final results are stored and optionally navigated to `/results` or `/discover/results`.

## Architectural Characteristics

- Heavy use of colocated comments to document test cases, invariants, and regressions.
- Logic is intentionally pushed into pure helpers where possible, especially in `useActivePipeline.ts`, `src/tools/registry.ts`, and several library modules.
- The architecture is mostly feature-sliced by domain rather than classic MVC.
- There is no backend boundary; the browser is both the UI host and the integration runtime.

## Current Architectural Drift

- `AGENTS.md`, `CLAUDE.md`, and `TODOS.md` still reference older file layouts such as `InputPage.tsx` and `ProgressPage.tsx`, but the live app has moved to a conversational `ChatPage` architecture.
- The code reflects the new architecture more accurately than the repo-level docs.
