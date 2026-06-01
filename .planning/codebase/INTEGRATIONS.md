# Integrations

## External APIs

### Gemini API

- Gemini is called directly over REST from `src/ai/gemini.ts`, `src/ai/intentParser.ts`, and `src/lib/hashtagGenerator.ts`.
- Default model is `gemini-2.5-flash`, overrideable by `VITE_GEMINI_MODEL`.
- Gemini handles:
  - intent classification and routing in `src/ai/intentParser.ts`
  - competitor ranking and rationale generation in `src/ai/gemini.ts`
  - location discovery ranking in `src/ai/gemini.ts`
  - hashtag generation in `src/lib/hashtagGenerator.ts`
  - follow-up / confirm-state language mapping in `src/ai/gemini.ts`

### Apify API

- Apify is called directly over REST from `src/lib/apifyCore.ts`.
- Actor lifecycle is:
  1. `startRun(...)`
  2. `pollRun(...)`
  3. `fetchDataset(...)`
- Competitor discovery uses actor wrappers in `src/lib/apifyClient.ts`.
- Location discovery uses actor wrappers in `src/lib/discoveryClient.ts`.
- Actor IDs and input builders live in `src/lib/actors.ts`.

## Browser-Native Integrations

- API keys are stored in browser `localStorage` through `src/lib/storage.ts` and `src/store/keysStore.ts`.
- Cross-tab sync for keys is handled by the `storage` event listener in `src/store/keysStore.ts`.
- Clipboard export uses helpers in `src/shared/utils/export.ts`.
- CSV download is also handled in `src/shared/utils/export.ts`.

## Deployment Integrations

- Vercel SPA routing is configured in `vercel.json`.
- There is no backend, no serverless function layer, and no database connection in the app code.

## Authentication and Secrets

- There is no user authentication system.
- API keys are user-supplied and stored locally in the browser.
- Optional bootstrapping through `VITE_GEMINI_KEY` and `VITE_APIFY_KEY_1` through `VITE_APIFY_KEY_5` is supported in `src/store/keysStore.ts`.
- `.env.example` exists, which suggests env-based local setup is part of the developer flow.

## Integration Risks

- All critical business logic depends on third-party APIs being reachable from the browser.
- Because this is a browser-only architecture, API keys are inherently exposed to the end user’s browser session.
- Apify rate limits are partially mitigated with cooldown logic in `src/lib/keyRotator.ts`.
- Gemini and Apify failures are surfaced to users, but the repo currently has at least one failing Gemini error-path test and several lint/build issues around error handling.
