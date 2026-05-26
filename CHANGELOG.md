# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] — 2026-05-27

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
