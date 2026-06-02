# Testing

## Test Stack

- Unit and integration-style tests run with Vitest.
- UI/hook tests use React Testing Library and `jsdom`.
- Test configuration lives in `vitest.config.ts`.
- Node-based script checks live under `scripts/` for real API verification.

## Coverage Shape

- There are 24 colocated test files under `src/`.
- `npm test -- --run` currently reports 420 total tests.
- Coverage emphasis is on:
  - Gemini parsing and prompt behavior in `src/ai/*.test.ts`
  - conversation state-machine behavior in `src/hooks/*.test.ts`
  - discovery and Apify helpers in `src/lib/*.test.ts`
  - Zustand state transitions in `src/store/*.test.ts`
  - registry-level pipeline metadata in `src/tools/registry.test.ts`

## Scripted Verification

- `scripts/test-scraper.mjs` verifies the Apify scraper path.
- `scripts/test-ai.mjs` verifies Gemini flows.
- `scripts/test-discovery.mjs` exists for the discovery pipeline.
- `scripts/test-cors.mjs` exists for browser/network architecture validation.

## Current Status

- `npm test -- --run` is close to green but not fully passing.
- Latest observed result:
  - 24 test files run
  - 23 passed
  - 1 failed
  - 419 tests passed
  - 1 test failed
- Current failure is in `src/ai/gemini.discoveryParser.test.ts`, where the 429-path expectation does not align with the mocked fetch behavior and produces a `TypeError` instead of `GeminiError { code: 'RATE_LIMITED' }`.

## Build and Lint Interaction

- `npm run build` currently fails before the bundle step because TypeScript compilation includes tests with stale fixtures and missing fields.
- `npm run lint` currently fails on 17 errors, including React purity, unused variables, and preserved-cause rules.
- The repo therefore has a strong test suite but is not in a fully green verification state right now.

## Testing Gaps and Drift

- Repo-level docs in `AGENTS.md` and `CLAUDE.md` mention a 420-test suite, which is directionally correct now, but other adjacent documentation still describes outdated pages and flows.
- Some tests appear to lag behind live type evolution, especially around parsed intent fields and normalized profile shapes.
- The existence of `src/lib/coverage-gaps.test.ts` suggests the team is explicitly tracking known holes rather than assuming the suite is complete.
