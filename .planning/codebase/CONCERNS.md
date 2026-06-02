# Concerns

## 1. Documentation Drift

- `AGENTS.md`, `CLAUDE.md`, and especially `TODOS.md` still describe older app structure and behavior.
- Examples of stale references:
  - `InputPage.tsx` and `ProgressPage.tsx` are documented but no longer exist.
  - `TODOS.md` still describes a light/slate-indigo design system, while the actual app uses the chai-dark system from `DESIGN.md` and `src/shared/styles/tokens.css`.
- This drift makes onboarding and planning riskier because repo docs no longer consistently match runtime code.

## 2. Verification Is Not Green

- `npm run build` currently fails in TypeScript before bundling.
- `npm run lint` currently fails with 17 errors.
- `npm test -- --run` currently has 1 failing test out of 420.
- This means the project is close to healthy but not in a “green baseline” state for confident refactors.

## 3. React Purity / Modern Lint Rules

- The React hooks lint rules now flag `Date.now()` in render-sensitive contexts, notably in `src/hooks/useConversation.ts` and `src/pages/SettingsPage.tsx`.
- If the team intends to keep the new rule set, some UI and state-update patterns will need refactoring.
- If the team does not intend to enforce those rules, the lint config should be adjusted to avoid noisy failures.

## 4. Test Fixtures Out of Sync with Types

- TypeScript build failures show several tests still use outdated object shapes:
  - missing `routingConfidence` on parsed intents
  - outdated `private` field on normalized profile fixtures
  - importing non-exported `FilterResult`
- This suggests the app evolved faster than the test fixture maintenance.

## 5. Browser-Only Secret Model

- API keys are stored in `localStorage` and used directly from the browser.
- This is intentional for the product, but it remains an operational risk:
  - keys are visible to the user environment
  - browser/network quirks directly affect core functionality
  - rate limiting must be handled entirely client-side

## 6. Repo Process Complexity

- The repository mixes `npm`, Bun, Vercel, GSD planning artifacts, and gstack workflow instructions.
- There are multiple planning systems present: `.planning/`, `PLAN*.md`, `TODOS.md`, `AGENTS.md`, and `CLAUDE.md`.
- Without active maintenance, process artifacts can accumulate and contradict one another.

## 7. Potential Mock Fragility in Gemini Tests

- The single failing test in `src/ai/gemini.discoveryParser.test.ts` points to brittle mocking around fetch/error-path handling.
- Because Gemini integration is central to both routing and ranking, weak error-path tests can hide production regressions.

## 8. Desktop-Only Assumptions

- `src/index.css` sets `body { min-width: 1024px; }`.
- Repo docs explicitly frame this as desktop-only today, but that assumption affects future usability and QA expectations.
