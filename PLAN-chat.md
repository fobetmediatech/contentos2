# Plan: Full Conversational Agent — Natural Language Input

**Branch:** feat/location-discovery
**Date:** 2026-05-29
**Author:** autoplan (aditya.raj@findmygenie.com)
**Supersedes design doc:** adityaraj0421-conversational-agent-design-20260529-130232.md
**Status:** ✅ APPROVED 2026-05-29 — 23 tasks, 3 review phases complete

---

## Problem

The form-based InputPage requires users to supply competitor handles — the
answer to the question they're trying to answer. Drop-off at the form is the
top conversion blocker. All four failure modes root-cause to the same thing:
upfront expert knowledge requirement.

---

## Architecture (CEO-reviewed)

### State Machine

```
idle → chatting → discovering → confirming → running → clarifying → done | error
           ↑           │               │
           │ needsClarification         │ 0 seeds → back to chatting
           └───────────┘               │
                                       └─ user confirmed → analyze()
```

State definitions:
- `chatting`    — user types intent; assistant may ask one clarification turn
- `discovering` — generateHashtags() + scrapeHashtagUsernames() running (up to 90s)
- `confirming`  — seeds shown, user picks direction or proceeds
- `running`     — existing analysis pipeline (unchanged, 150s timeout)
- `clarifying`  — existing ClarificationCard logic as chat bubble
- `done | error` — unchanged

### Data Flow

```
User message
     │
     ▼
parseIntent(geminiKey, userMessage, signal)
     │ ParsedIntent { niche, location?, knownHandles[], depth, clientName? }
     │ -- or { needsClarification, question } → extra chat turn → repeat
     ▼
discoverSeedHandles(niche, location, geminiKey, apifyKey, signal)
     │  Step 1: generateHashtags(geminiKey, location ?? '', niche, 'standard', signal)
     │  Step 2: scrapeHashtagUsernames(hashtags, apifyKey, signal)
     │  Step 3: return first 10 unique usernames (order-of-appearance; no frequency sort)
     │
     │  Shadow paths:
     │  - Nil location:  pass '' to generateHashtags (Gemini omits city clause)
     │  - 0 seeds:       transition back to chatting, ask user for known handle
     │  - Apify timeout: inline fallback input appears after 60s soft nudge, hard abort at 90s
     ▼
confirming state: show seeds + direction options
     │
     ▼
confirmSeeds(selectedOption)
     │  isProceedAsIs = selectedOption === PROCEED_LABEL || selectedOption === ''
     │  nicheContext = isProceedAsIs ? niche : `${niche} — ${selectedOption}`
     ▼
analyze({ handles: discoveredSeeds, depth, clientName, nicheContext })
     │  useCompetitorAnalysis.analyze() — unchanged
     ▼
status = 'running' → useEffect in ChatPage navigates to /progress
```

### New Store State Shape

```typescript
// analysisStore.ts additions
export type AnalysisStatus =
  'idle' | 'chatting' | 'discovering' | 'confirming' |
  'running' | 'clarifying' | 'done' | 'error'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  type?: 'text' | 'options' | 'progress'
  options?: string[]
  // NOTE: no onSelect callback — stale closure risk in Zustand
}

// New fields:
conversationMessages: ChatMessage[]   // cap at 50
discoveredSeeds: string[]             // set in 'discovering', read in 'confirming'
parsedIntent: ParsedIntent | null     // set after parseIntent(), read in confirmSeeds()
```

### Key Design Decisions (from CEO review)

1. **Frequency sort impossible** — `scrapeHashtagUsernames` deduplicates before
   returning. Seeds are returned in order-of-appearance (first unique handles seen
   across hashtags). This is fine for a confirming step where direction matters more
   than ranking.

2. **`useConversation.ts` imports `useCompetitorAnalysis`** — `confirmSeeds()` calls
   `analyze()` from the analysis hook. `useConversation` is the orchestrator that
   composes both state machine and analysis trigger.

3. **Separate AbortControllers** — seed discovery has its own 90s AbortController;
   analysis has its existing 150s AbortController. They are independent.

4. **ChatPage reset on mount** — if `status === 'done'` when ChatPage mounts, reset
   the store automatically (or show "Start new analysis" CTA). Old chat history must
   not be shown to a returning user.

---

## Error & Rescue Map

| Method | What Can Go Wrong | Rescued? | User Sees |
|--------|-------------------|----------|-----------|
| `parseIntent()` | Gemini API down | Y — catch + show error message | "Something went wrong. Try again." |
| `parseIntent()` | Invalid API key (401) | Y — catch 401 + route to settings | "Add your Gemini key in Settings." |
| `parseIntent()` | Non-JSON response | Y — catch + retry 1x | "Couldn't understand that. Try rephrasing." |
| `parseIntent()` | Invalid schema (missing niche) | Y — Zod validation + retry | "Couldn't understand that. Try rephrasing." |
| `discoverSeedHandles()` | generateHashtags fails | Y — propagate, catch in hook | Discovery error state |
| `discoverSeedHandles()` | Apify TIMEOUT | Y — 90s AbortController | Soft nudge at 60s, inline fallback at 90s |
| `discoverSeedHandles()` | 0 handles returned | Y — back to chatting | "Couldn't find accounts automatically. Name one you know?" |
| `confirmSeeds()` | parsedIntent is null | Y — guard + reset to chatting | "Session expired. Start over?" |
| `confirmSeeds()` | analyze() throws | Y — propagate to error state | Existing error UI |

**CRITICAL GAPS to fix (P1 tasks):**
- Zod validation on `parseIntent()` response (currently none specified)
- Empty seeds → confirming state with 0 options (currently unspecified)
- `parsedIntent` null guard in `confirmSeeds()`

---

## Interaction Edge Cases

| Interaction | Edge Case | Handling |
|-------------|-----------|---------|
| Chat send | Double-click while discovering | Disabled during non-chatting states |
| Chat send | Empty input | Send button disabled |
| Chat input | Length > 500 chars | maxLength={500} on textarea |
| Discovering | User navigates away | AbortController cleanup on unmount |
| Confirming | 0 seeds found | Back to chatting, ask for known handle |
| ChatPage | Opened after 'done' analysis | Store reset on mount or "New analysis" CTA |
| Back button | During discovering/confirming | AbortController abort + store reset |
| API keys missing | Page load | Same amber banner, chat input disabled |

---

## Corrected Implementation Sequence

| Step | Task | Files | Original Est | Revised Est |
|------|------|-------|-------------|-------------|
| 0 | Export `scrapeHashtagUsernames` from `apifyClient.ts` | `apifyClient.ts` | 15m | 15m |
| 1 | Add new states + conversation fields to `analysisStore.ts` (design the full new state shape) | `analysisStore.ts` | 45m | **1.5h** |
| 2 | `buildIntentPrompt` in `prompts.ts` | `prompts.ts` | 30m | 30m |
| 3 | `parseIntent()` with Zod schema validation | `intentParser.ts` (new) | 1h | **1.5h** |
| 4 | `discoverSeedHandles()` — full orchestration: generateHashtags + scrapeHashtagUsernames + 90s timeout + 0-seeds fallback | `useConversation.ts` (new) | 1.5h | **3h** |
| 5 | `<ChatMessage>` + `<ChatOptions>` + PROCEED_LABEL constant | new components + `src/lib/constants.ts` | 1h | 1h |
| 6 | `<ChatPage>` — full layout, keys banner, `useEffect` on `status === 'running'`, reset-on-mount | `ChatPage.tsx` (new) | 2h | **2.5h** |
| 7 | Update `App.tsx` routing, remove InputPage from default route | `App.tsx` | 30m | 30m |
| 8 | `confirmSeeds()` — null guard, proceed vs directional branching | `useConversation.ts` | 1h | 1h |
| 9 | ClarificationCard → chat bubble in `ProgressPage` | `ProgressPage.tsx` | 45m | 45m |
| 10 | Tests: intent parser, state machine, discoverSeedHandles, confirmSeeds | test files | 1.5h | **3.5h** |

**Total Phase 1 revised:** ~16h (human) / ~2-3h (CC + gstack)

---

## Implementation Tasks (from CEO review)

- [ ] **T1 (P1, human: ~30m / CC: ~5m)** — intentParser — Add Zod schema validation for `parseIntent()` response
  - Surfaced by: Section 2 (Error Map) — no type guard on Gemini JSON response
  - Files: `src/ai/intentParser.ts`
  - Verify: unit test with malformed Gemini response → Zod error caught, not thrown to caller

- [ ] **T2 (P1, human: ~30m / CC: ~5m)** — useConversation — Handle 0 seeds from `discoverSeedHandles()`
  - Surfaced by: Section 2 + Section 4 — confirming state with 0 options is a crash path
  - Files: `src/hooks/useConversation.ts`
  - Verify: mock `scrapeHashtagUsernames` returning [] → store transitions back to `chatting` with fallback message

- [ ] **T3 (P1, human: ~15m / CC: ~2m)** — useConversation — Null guard on `parsedIntent` in `confirmSeeds()`
  - Surfaced by: Section 2 — race condition if `confirmSeeds()` called before `parseIntent()` resolves
  - Files: `src/hooks/useConversation.ts`
  - Verify: unit test calling `confirmSeeds()` with `parsedIntent = null` → transitions to `chatting` with error message

- [ ] **T4 (P1, human: ~15m / CC: ~3m)** — constants — Extract PROCEED_LABEL to shared constant
  - Surfaced by: Section 5 (Code Quality) — DRY violation, magic string in two files
  - Files: `src/lib/constants.ts` (new or existing), `src/components/ChatOptions.tsx`, `src/hooks/useConversation.ts`
  - Verify: grep shows single definition of PROCEED_LABEL string

- [ ] **T5 (P1, human: ~20m / CC: ~3m)** — ChatPage — Disable send button when status !== 'chatting'
  - Surfaced by: Section 4 (Edge Cases) — double-submit risk during discovering/confirming
  - Files: `src/pages/ChatPage.tsx`
  - Verify: clicking send during `discovering` state does nothing

- [ ] **T6 (P2, human: ~15m / CC: ~2m)** — ChatPage — Add maxLength={500} to chat textarea + char counter at 400+
  - Surfaced by: Section 3 (Security) — unbounded input length
  - Files: `src/pages/ChatPage.tsx`
  - Verify: typing 501 chars is blocked

- [ ] **T7 (P2, human: ~30m / CC: ~5m)** — useConversation — Handle ChatPage re-entry after 'done'
  - Surfaced by: Section 4 — old chat history shows to returning user
  - Files: `src/pages/ChatPage.tsx`, `src/hooks/useConversation.ts`
  - Verify: navigate to / after analysis completes → store resets, fresh chat shown

- [ ] **T8 (P2, human: ~30m / CC: ~5m)** — useConversation — Add state machine ASCII diagram as file header
  - Surfaced by: Section 10 (Trajectory) — monolithic hook, knowledge concentration risk
  - Files: `src/hooks/useConversation.ts`
  - Verify: file header contains full state machine diagram

- [ ] **T9 (P2, human: ~20m / CC: ~3m)** — useConversation — Add `console.info()` observability at key transitions
  - Surfaced by: Section 8 (Observability) — no logging for debugging quality issues
  - Files: `src/hooks/useConversation.ts`
  - Log: `[chat] intent parsed:`, `[discovery] seeds found: N`, `[confirm] option selected:`

- [ ] **T10 (P3, human: ~15m / CC: ~2m)** — Design — Specify error state UI for `discovering` failure
  - Surfaced by: Section 11 (Design) — no error state specified for seed discovery failure
  - Files: `src/pages/ChatPage.tsx`, `src/hooks/useConversation.ts`
  - Verify: Apify error → assistant message with retry option shown in chat

### Design Review Tasks (from Phase 2 design review)

- [ ] **T11 (P1, human: ~45m / CC: ~8m)** — ChatPage — AppLayout conflict: add `noPadding` layout variant or `ChatLayout` wrapper
  - Surfaced by: Design review — AppLayout `py-8 px-6` makes `h-[calc(100vh)]` overflow; sticky input breaks
  - Files: `src/components/AppLayout.tsx`, `src/pages/ChatPage.tsx`, `src/App.tsx`
  - Fix: Add boolean `noPadding` prop to AppLayout, or render ChatPage under a dedicated `ChatLayout` route wrapper with `h-[100dvh]` and no padding
  - Verify: Chat input is visible and sticky on mobile Safari; message area scrolls independently

- [ ] **T12 (P1, human: ~30m / CC: ~5m)** — ChatMessage — Add animated typing indicator for discovering state
  - Surfaced by: Design review — no loading state in chat thread; plain text is ambiguous
  - Files: `src/components/ChatMessage.tsx`
  - Fix: Dedicated "thinking" bubble with three `animate-pulse` dots (staggered delays); transitions to real message when response arrives
  - Verify: Typing indicator visible during `discovering` state; disappears when seeds found

- [ ] **T13 (P1, human: ~30m / CC: ~5m)** — ChatMessage — Add error bubble variant (`bg-red-50 border-red-200`)
  - Surfaced by: Design review — zero error states in chat thread; intent failure and Apify timeout completely undefined
  - Files: `src/components/ChatMessage.tsx`, `src/hooks/useConversation.ts`
  - Fix: `type: 'error'` ChatMessage variant with retry button; two error messages: "Couldn't understand that — try rephrasing" and "Search timed out — try again"
  - Verify: Triggering Apify timeout → red error bubble with retry appears in chat

- [ ] **T14 (P1, human: ~20m / CC: ~3m)** — ChatPage — Add accessibility attributes to message list and input
  - Surfaced by: Design review — screen readers won't announce new messages; icon-only send button has no label
  - Files: `src/pages/ChatPage.tsx`
  - Fix: `<div role="log" aria-live="polite" aria-label="Conversation">` on message list; `aria-label="Send message"` on submit button
  - Verify: VoiceOver/NVDA announces new assistant messages

- [ ] **T15 (P2, human: ~20m / CC: ~3m)** — ChatMessage — Replace emoji avatars with Lucide Bot/User icon circles
  - Surfaced by: Design review — emoji inconsistent with design system; renders differently across OS
  - Files: `src/components/ChatMessage.tsx`
  - Fix: `w-8 h-8 rounded-full bg-indigo-100` + `Bot` Lucide icon (assistant) / `bg-slate-100` + `User` icon (user)
  - Verify: Avatar circles match ClarificationCard's established `w-9 h-9 rounded-full bg-indigo-100` pattern

- [ ] **T16 (P2, human: ~20m / CC: ~3m)** — ChatOptions — Change from full-width stacked to pill layout
  - Surfaced by: Design review — full-width buttons stretch bubble; chat context needs compact pills
  - Files: `src/components/ChatOptions.tsx`
  - Fix: `inline-flex flex-wrap gap-2` with `px-3 py-1.5 rounded-full border border-slate-200 text-sm hover:border-indigo-400`
  - Verify: Multiple options fit on one row without stretching the message bubble to full-width

- [ ] **T17 (P2, human: ~25m / CC: ~4m)** — ChatPage — Design empty/first-load state
  - Surfaced by: Design review — single message at top of tall scroll area looks broken
  - Files: `src/pages/ChatPage.tsx`
  - Fix: `flex-col justify-center` on message area (first load), switch to `justify-end` after first user message
  - Verify: Opening assistant message is visually centered on first load; subsequent messages anchor to bottom

- [ ] **T18 (P2, human: ~15m / CC: ~2m)** — ChatPage — Mobile keyboard + safe area handling
  - Surfaced by: Design review — sticky input sits behind iOS home indicator; mobile keyboard overlaps input
  - Files: `src/pages/ChatPage.tsx`
  - Fix: `pb-[env(safe-area-inset-bottom)]` on input container; use `h-[100dvh]` (not `100vh`) for chat container
  - Verify: Input visible above keyboard on iPhone Safari; home indicator doesn't overlap input

### Engineering Review Tasks (from Phase 3 eng review)

- [ ] **T19 (P1, human: ~20m / CC: ~3m)** — ProgressPage — Update redirect guard to handle new chatting/discovering/confirming states
  - Surfaced by: Eng review — `if (status === 'idle') navigate('/')` misses 3 new states; blank page on `/progress` if reached mid-chat
  - Files: `src/pages/ProgressPage.tsx`
  - Fix: `if (!['running', 'clarifying', 'done', 'error'].includes(status)) navigate('/')`
  - Verify: Navigating directly to `/progress` when store is `chatting` redirects to `/`

- [ ] **T20 (P2, human: ~30m / CC: ~5m)** — useConversation — Explicit AbortController lifecycle with useEffect cleanup
  - Surfaced by: Eng review — discovery AbortController has no specified cleanup; unmounting mid-discovery leaks the fetch
  - Files: `src/hooks/useConversation.ts`
  - Fix: Store AbortController in a ref; useEffect cleanup calls `controller.abort()` on unmount. Pattern: same as `useLocationDiscovery.ts` (AbortController inside mutationFn with clearTimeout)
  - Verify: Navigating away during discovering state — fetch is cancelled

- [ ] **T21 (P2, human: ~15m / CC: ~2m)** — useConversation — Clarification turn counter (max 1 turn)
  - Surfaced by: Eng review — if parseIntent() keeps returning needsClarification, state machine loops forever
  - Files: `src/hooks/useConversation.ts`
  - Fix: Track `clarificationTurns: number` in local hook state; after 1 clarification turn, proceed with what we have OR show "Having trouble understanding — type a handle to start directly"
  - Verify: Sending ambiguous input twice → second round forces progression, no infinite loop

- [ ] **T22 (P3, human: ~10m / CC: ~2m)** — analysisStore — Include new fields in initialState
  - Surfaced by: Eng review — new fields (conversationMessages, discoveredSeeds, parsedIntent) must be in initialState for proper reset
  - Files: `src/store/analysisStore.ts`
  - Fix: Add all 3 new fields to `initialState` object
  - Verify: `reset()` clears conversation state; returning to ChatPage shows fresh chat

- [ ] **T23 (P3, human: ~15m / CC: ~2m)** — ChatPage — Handle `status === 'error'` on mount (reset store)
  - Surfaced by: Eng review — ProgressPage error "Try again" → navigate('/') → ChatPage mounts with status 'error'; stale state
  - Files: `src/pages/ChatPage.tsx`
  - Fix: In the store-reset useEffect: also reset on `status === 'error'`
  - Verify: Clicking "Try again" from ProgressPage error → ChatPage shows fresh chat, not stale error state

---

## Pre-Implementation Checklist (unchanged from design doc)

- [ ] Verify `scrapeHashtagUsernames` is the correct function name in `apifyClient.ts`
- [ ] Verify `generateHashtags` argument order: `(geminiKey, city, niche, depth, signal)` in `hashtagGenerator.ts`
- [ ] Confirm `ownerUsername` field exists on Apify hashtag post objects (CONFIRMED: `ownerUsername?: string`)
- [ ] Confirm frequency sort is NOT possible with current `scrapeHashtagUsernames` (CONFIRMED: function deduplicates before return → use order-of-appearance)

---

## NOT in Scope (Phase 1)

- Streaming progress updates inline in chat (Phase 2)
- Results cards inline in chat thread (Phase 2)
- Multi-turn "re-run for different niche" (Phase 2)
- Depth toggle in chat (auto-detected from "thorough" / "complete" keywords)
- Client name post-analysis prompt (Phase 2)
- Profile cards for discovered seeds (shows handles only, not profile data)

---

## What Already Exists

| Sub-problem | Existing code | Reuse strategy |
|-------------|---------------|----------------|
| Generate niche hashtags | `hashtagGenerator.ts::generateHashtags()` | Direct call |
| Scrape hashtag usernames | `apifyClient.ts::scrapeHashtagUsernames()` | Export + call |
| Run full analysis from handles | `useCompetitorAnalysis.ts::analyze()` | Unchanged |
| Mid-run clarification | `ClarificationCard.tsx` | Kept as fallback |
| AbortController pattern | `useLocationDiscovery.ts` | Replicate pattern |
| Keys store (geminiKey, apifyKey) | `keysStore.ts` | Import as-is |

---

## Dream State Delta

```
CURRENT                       THIS PLAN                    12-MONTH IDEAL
────────────────────          ─────────────────────        ─────────────────────
Form: enter handles           Chat: type niche in          Full streaming agent
(circular: need               natural language             Results inline in chat
 competitor knowledge)        Tool discovers seeds         Multi-turn re-runs
                              User confirms direction      Shareable chat sessions
                              → 90s analysis fires
```

This plan moves from "Form" to "Chat: type niche". The 12-month ideal requires Phase 2 (streaming, results inline). The architecture is designed to support Phase 2 without a rewrite.

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO | HOLD SCOPE mode | Mechanical | P1 (completeness) | Design doc APPROVED after thorough /office-hours; no new scope needed | SELECTIVE EXPANSION |
| 2 | CEO | Frequency sort → order-of-appearance | Mechanical | P5 (explicit) | `scrapeHashtagUsernames` deduplicates before return; no frequency data available without refactor | Refactor function to return counts |
| 3 | CEO | `useConversation.ts` imports `useCompetitorAnalysis` | Architectural | P3 (DRY) | Orchestrator owns both state and analysis trigger; prop-drilling from ChatPage is worse | Pass analyze() as prop |
| 4 | CEO | Separate AbortControllers for discovery vs analysis | Mechanical | P4 (edge cases) | Independent timeouts; discovery abort should not cancel analysis | Shared controller |
| 5 | CEO | Zod validation on `parseIntent()` response | Mechanical | P2 (boil lake) | Gemini JSON mode without schema → arbitrary structure; validation is 5 lines | Skip validation |
| 6 | CEO | Cap `conversationMessages` at 50 | Mechanical | P7 (performance) | Unbounded array grows with every message; 50 covers all realistic conversation lengths | No cap |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open | 3 critical gaps, 10 tasks (T1–T5 P1, T6–T9 P2, T10 P3) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 5 tasks (T19 P1, T20–T21 P2, T22–T23 P3); 3 false alarms flagged and resolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | 4 critical gaps, 8 tasks (T11–T13 P1, T14–T18 P2) |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | SKIPPED | Codex unavailable — degraded to subagent-only mode |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | SKIPPED | Internal app, no DX scope |

**OUTSIDE VOICE (Claude subagent, all 3 phases):**
- CEO phase: Score 4/10 — 4 critical gaps in implementation spec (discoverSeedHandles orchestration, store state shape, confirmSeeds transition, latency accounting). All addressed as P1 tasks.
- Design phase: Score 4/10 — 4 critical design gaps (AppLayout conflict, loading state, error bubbles, accessibility). All addressed as P1 tasks.
- Eng phase: Score 4/10 — 3 false alarms + 2 critical real gaps (ProgressPage guard misses 3 new states, AbortController lifecycle). All addressed.

**TOTAL: 23 tasks across 3 review phases. Estimate: ~16h human / ~2–3h CC.**

**UNRESOLVED:** 0 (all decisions auto-made in autoplan run)

**VERDICT:** CEO REVIEW complete (issues_open — 3 critical gaps → P1 tasks T1–T5 address them). Eng review required before ship.
