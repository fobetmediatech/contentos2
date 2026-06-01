# Structure

## Top-Level Layout

- `src/` contains application code and colocated tests.
- `scripts/` contains Node-based integration and verification scripts such as `scripts/test-ai.mjs`, `scripts/test-scraper.mjs`, and `scripts/test-discovery.mjs`.
- `public/` contains static assets.
- Planning and process artifacts live in files such as `PLAN.md`, `TODOS.md`, `CHANGELOG.md`, and `.planning/`.

## Source Tree

### `src/pages/`

- `src/pages/ChatPage.tsx` is the main conversational UI.
- `src/pages/ResultsPage.tsx` renders competitor-analysis results.
- `src/pages/DiscoveryResultsPage.tsx` renders location-discovery results.
- `src/pages/SettingsPage.tsx` manages Gemini and Apify keys.

### `src/hooks/`

- Runtime hooks:
  - `src/hooks/useConversation.ts`
  - `src/hooks/useCompetitorAnalysis.ts`
  - `src/hooks/useLocationDiscovery.ts`
  - `src/hooks/useActivePipeline.ts`
- Test files are colocated in the same folder, including `src/hooks/conversationalUX.test.ts` and confirm/discovery-specific cases.

### `src/ai/`

- `src/ai/prompts.ts` contains prompt builders.
- `src/ai/gemini.ts` contains the Gemini client.
- `src/ai/intentParser.ts` contains intent extraction and schema validation.
- Multiple focused tests exist here, including `src/ai/gemini.discoveryParser.test.ts`.

### `src/lib/`

- External actor/input configuration in `src/lib/actors.ts`
- Apify lifecycle helpers in `src/lib/apifyCore.ts`
- Competitor pipeline in `src/lib/apifyClient.ts`
- Discovery pipeline in `src/lib/discoveryClient.ts`
- Key rotation in `src/lib/keyRotator.ts`
- Hashtag generation in `src/lib/hashtagGenerator.ts`
- Location filtering in `src/lib/locationFilter.ts`
- Storage abstraction in `src/lib/storage.ts`
- Normalization in `src/lib/transformers.ts`

### `src/store/`

- `analysisStore.ts`, `discoveryStore.ts`, and `keysStore.ts` are the primary Zustand stores.
- Tests are colocated beside the stores.

### `src/tools/`

- `src/tools/registry.ts` is the registry for pipeline metadata such as confirm options, steps, and result routes.
- `src/tools/types.ts` defines shared pipeline descriptor types.

### `src/shared/`

- `src/shared/styles/tokens.css` defines design tokens.
- `src/shared/utils/categories.ts` defines category metadata.
- `src/shared/utils/export.ts` handles clipboard and CSV serialization.

## Naming and Layout Patterns

- Feature modules use descriptive names instead of deep nesting.
- Tests are mostly colocated as `*.test.ts`.
- Pages and components use PascalCase filenames.
- Hooks use `useX` naming.
- Shared utilities and lower-level adapters use camelCase filenames.

## Notable Structural Mismatches

- `AGENTS.md` and `CLAUDE.md` still describe files like `InputPage.tsx` and `ProgressPage.tsx` that are no longer present.
- The actual codebase contains additional files not mentioned in those docs, including `src/tools/types.ts`, `vitest.config.ts`, and a broad test suite.
- `DESIGN.md` exists at repo root, even though an early read failed before the file listing reflected the full workspace.
