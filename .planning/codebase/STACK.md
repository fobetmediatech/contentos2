# Stack

## Runtime and Build

- Frontend-only Vite app with React 19 and TypeScript 6.
- Entry points are `src/main.tsx` and `src/App.tsx`.
- Primary build command is `npm run build`, which runs `tsc -b` and then `vite build`.
- Vercel deployment is configured in `vercel.json` with `dist` as the output directory.
- Tailwind CSS is present for utility styling via `tailwind.config.js`, `postcss.config.js`, and `src/index.css`.

## Core Libraries

- `react` and `react-dom` drive the UI.
- `react-router-dom` provides route-level navigation for chat, results, discovery results, and settings pages.
- `@tanstack/react-query` is used for long-running mutation workflows in `src/hooks/useCompetitorAnalysis.ts` and `src/hooks/useLocationDiscovery.ts`.
- `zustand` stores app state for competitor analysis, discovery, and API keys in `src/store/`.
- `zod` validates Gemini intent-parser output in `src/ai/intentParser.ts`.
- `p-limit` limits concurrent Apify profile scrapes in `src/lib/apifyClient.ts` and `src/lib/discoveryClient.ts`.
- `lucide-react` supplies iconography across the UI.

## Tooling

- ESLint uses flat config in `eslint.config.js` with `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`.
- Vitest is configured and active via `vitest.config.ts`.
- React Testing Library and `jsdom` are installed for hook and UI-adjacent tests.
- The repository includes both `package-lock.json` and `bun.lock`, and `vercel.json` builds with Bun even though local docs mostly describe `npm`.

## Styling and Design

- The design system is tokenized in `src/shared/styles/tokens.css`.
- Global CSS imports those tokens in `src/index.css`.
- Tailwind theme extensions mirror the token palette and fonts in `tailwind.config.js`.
- The current UI uses the warm “chai dark” system defined in `DESIGN.md`, not the older light/slate system still mentioned in some legacy planning docs.

## Versioning and State of Repo

- `package.json` currently reports version `0.3.0.3`.
- The repo has active planning and changelog artifacts such as `PLAN.md`, `PLAN-chat.md`, `PLAN-smart-pipelines.md`, `TODOS.md`, and `CHANGELOG.md`.
- `.planning/` already existed with at least `.planning/fix-intent-parser-json-failures.md`; this mapping adds the `.planning/codebase/` subtree.

## Current Health Signals

- `npm run build` currently fails during TypeScript compilation because several tests are out of sync with the current types.
- `npm run lint` currently fails with React purity and error-handling rules in addition to a few unused variables.
- `npm test -- --run` executes 420 tests; 419 pass and 1 fails in `src/ai/gemini.discoveryParser.test.ts`.
