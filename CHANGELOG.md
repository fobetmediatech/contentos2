# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.0] — 2026-05-27

### Added

- **Location Discovery** — new `/discover` flow: city + niche → AI-ranked top 10 creator cards
  - `DiscoverPage` — city/niche form with depth toggle (Standard / Deep), optional client name
  - `DiscoveryProgressPage` — 5-step progress view (hashtag gen → hashtag scrape → profile scrape → location filter → AI insights)
  - `DiscoveryResultsPage` — Top 5 / Trending 5 sections with location filter relaxed banner
  - `DiscoveryCard` — creator card with specialties chips, location confidence badge (confirmed / likely / unknown), content focus, partnership-ready signal
- **hashtagGenerator** (`src/lib/hashtagGenerator.ts`) — Gemini micro-call to generate 5–8 location-aware hashtags; template-based rule fallback when Gemini is unavailable
- **locationFilter** (`src/lib/locationFilter.ts`) — bio-text city matching with alias map (Mumbai/Bombay, Bangalore/Bengaluru, Delhi/NCR, etc.); auto-relaxes when fewer than 15 profiles pass
- **discoveryClient** (`src/lib/discoveryClient.ts`) — hashtag scrape → dedup → profile scrape (cap 60) → location filter pipeline; pLimit(3) concurrency
- **apifyCore** (`src/lib/apifyCore.ts`) — extracted shared Apify primitives (startRun, pollRun, fetchDataset, sleep, chunk, ApifyError) so both pipelines can reuse them without coupling
- **Discovery Gemini analysis** (`src/ai/gemini.ts`) — `analyzeDiscovery()` with niche-agnostic schema: specialties[], contentFocus, partnershipReady, locationConfidence
- **Discovery prompts** (`src/ai/prompts.ts`) — `buildDiscoveryPrompt()` and `DiscoveryResult` / `DiscoveryOutput` types
- **discoveryStore** (`src/store/discoveryStore.ts`) — Zustand store for discovery state (results, candidateProfiles, locationFilterRelaxed, sourceHashtags)
- **useLocationDiscovery** (`src/hooks/useLocationDiscovery.ts`) — TQ mutation with 150s timeout, hallucination filter, zero-result retry without city/niche context
- **Discovery export** — `formatDiscoveryForClipboard`, `generateDiscoveryCSV` (rank, category, username, followers, ER, verified, specialties, content_focus, partnership_ready, location_confidence, rationale, city, niche, source_hashtags)
- **DISCOVERY_CATEGORIES** (`src/shared/utils/categories.ts`) — discovery-context taxonomy alongside existing COMPETITOR_CATEGORIES
- **Test script** (`scripts/test-discovery.mjs`) — 8-gate integration test (hashtag gen, rule fallback, scraper field check, profile normalization, location filter accuracy, pipeline timing < 120s, yield gate ≥3 profiles, AI schema validation)

### Fixed

- **Discovery crash on null array fields** (`src/ai/gemini.ts`) — `parseDiscoveryOutput` now coerces per-item fields (`specialties`, `contentFocus`, `rationale`, `rank`) before returning; Gemini can return `null` for array-typed properties even with a responseSchema
- **Discovery prompt over-constrains result count** (`src/ai/prompts.ts`) — changed "Always return exactly 10" → "Return up to 10" in `buildDiscoveryPrompt`; the previous instruction forced Gemini to hallucinate handles to fill 10, which then failed the hallucination filter leaving fewer results than expected
- **Deep scan timeout overflow** (`src/lib/discoveryClient.ts`) — reduced `EXPANSION_CAP` 40 → 20; worst-case budget was ~165s against the 150s AbortController timeout
- **`onError` navigation conflict in DiscoverPage** (`src/pages/DiscoverPage.tsx`) — removed redundant `onSuccess`/`onError` TanStack Query callbacks; navigation is handled by `DiscoveryProgressPage` via its `useEffect` on store status
- **Double-click race in ClarificationCard** (`src/components/ClarificationCard.tsx`) — added `disabled?: boolean` prop; option buttons now disable immediately after first click (wired from `isPending` in `ProgressPage`)
- **Hashtag injection sanitization** (`src/lib/hashtagGenerator.ts`) — Gemini-returned hashtags now stripped of non-`[\w]` chars and capped at 30 characters (Instagram hashtag rules)
- **Prompt injection via clarification newlines** (`src/ai/prompts.ts`) — `trimmedClarificationAnswer` now strips internal `\n`/`\r` before prompt injection
- **Zero-result retry still passed city/niche context** (`src/hooks/useLocationDiscovery.ts`) — retry now passes `''` for both city and niche (was incorrectly passing `safeCity`/`safeNiche`)
- **Firefox CSV download silent fail** (`src/shared/utils/export.ts`) — anchor element now appended to DOM before `.click()` and removed after; `revokeObjectURL` delayed 100ms for Firefox download initiation
- **clientName input unsanitized** (`src/pages/DiscoverPage.tsx`) — `onChange` now strips non-`[\w\s-]` chars; added `maxLength={100}`
- **Depth toggle buttons not keyboard-accessible** (`src/pages/DiscoverPage.tsx`) — added `focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-none` to toggle button classes

### Changed

- **AppLayout** — added "Discover" nav link (MapPin icon, teal active state); app name updated to "Content OS 2.0"
- **App.tsx** — added `/discover`, `/discover/progress`, `/discover/results` routes
- **ProgressSteps** — `currentStep` widened to `number`; added optional `steps?: string[]` prop for custom step labels (backward-compatible)
- **apifyClient** — refactored to import from `apifyCore` instead of duplicating shared primitives
- **package.json** — added `test:discovery` script

## [0.0.0] — Initial release

- Competitor analysis flow: handle input → Apify scrape (3 rounds + hashtag expansion) → Gemini analysis → ranked results
- Settings page for Gemini API key + up to 10 Apify keys (all stored in localStorage, no .env)
- Export: clipboard (formatted text) + CSV download
