<!-- /autoplan restore point: /Users/adityaraj0421/.gstack/projects/ContentOS2.0/feat-conversational-agent-autoplan-restore-20260529-220107.md -->
# Plan: Conversational Pipeline UX

**Branch:** feat/conversational-agent
**Date:** 2026-05-29
**Author:** aditya.raj@findmygenie.com
**Status:** DRAFT — pending review

---

## Problem

The current confirm/routing flow creates three friction points that make the pipeline feel like a menu-driven chatbot rather than a conversation:

### Gap 1 — Invisible routing
Gemini silently classifies the user's message as `pipelineType: 'competitor'` or `'discovery'`. The user has no visibility into this decision until option buttons appear. For ambiguous messages like "food bloggers in Mumbai", the routing can be wrong — and the user has no natural way to correct it mid-flow.

**Current experience:**
```
User: "food bloggers in Mumbai"
AI:   [scans hashtags silently]
AI:   "Found 8 accounts in the food space in Mumbai. Which direction should I focus on?"
      [Proceed] [Micro-influencers] [Macro creators] [Businesses]
```
The user doesn't know if this is competitor analysis or location discovery. The buttons don't say.

### Gap 2 — Confirming state blocks typed input
When `status === 'confirming'`, the textarea is **disabled**. The user cannot type a custom refinement, ask a clarifying question, or correct the routing by saying "no, I meant find creators based in Mumbai". Their only options are the preset buttons.

This is the core conversational gap: **you can't hold a conversation when the other party only accepts menu picks**.

### Gap 3 — Follow-up context is too thin to be useful
`callGeminiFollowUp` receives only a 1-sentence summary:
`"Competitor analysis complete — found 12 accounts in the food space."`

When the user asks "show me only accounts under 50K followers", Gemini can't answer specifically because it doesn't know which accounts those are. It gives a generic "I can help you filter — the results with under 50K followers would be in the micro-influencer range" response that doesn't reference any real account.

---

## Goal

1. **Transparent routing** — confirm messages explicitly name the pipeline being run and invite natural-language correction. No more silent routing.
2. **Text input during confirming** — enable the textarea during `status === 'confirming'`. When the user types, interpret it as a natural-language confirm reply (via lightweight Gemini call) and route to the appropriate `confirmSeeds()` action.
3. **Richer follow-up context** — pass the top accounts (name + followers + ER) to `buildFollowUpContext` so Gemini can give specific, referenced answers.

---

## Cross-Phase Themes

**Theme: `isSendingRef` guard coverage** — independently flagged in Eng (Critical: recursive sendMessage) and Design (High: button+type race). Fix must be in two places: `isSendingRef.current = false` before recursive call AND `isConfirmingPendingRef.current` check inside `confirmSeeds`.

**Theme: Loading state during confirming text** — flagged in CEO (medium) and Design (high). Both phases agree: the 1-2s Gemini call window has no UI feedback. Fix: `isConfirmingPending` state + TypingIndicator + disabled buttons.

---

## Constraints

- No new Apify actors or Gemini models
- No new pages or routes
- All existing tests must still pass
- The button-based confirm flow continues to work exactly as before (buttons stay)
- Text input during confirming is additive — buttons remain as suggestions

---

## Engineering Review Amendments (incorporated)

| ID | Finding | Amendment |
|----|---------|-----------|
| AE1 | Code snippet for pipeline switch doesn't show `isSendingRef.current = false` | Explicit `isSendingRef.current = false` in code snippet before recursive call |
| AE2 | Button + type race in 200ms bypasses `isSendingRef` | Add `if (isConfirmingPendingRef.current) return` inside `confirmSeeds` before status check |
| AE3 | `callGeminiConfirmReply` return not validated against `availableOptions` | Validate returned string; fallback to `options[0]` if not in list |
| AE4 | No AbortController for confirming Gemini call — zombie Apify run | Assign new AbortController to `discoveryAbortRef.current` in confirming path |
| AE5 | `.nullish().default('high')` misses null from Gemini | Use `.catch('high')` to match `pipelineType` pattern; move `intentParser.ts` to Files to Modify |
| AE6 | Heuristic order: "fine/start" fire before specific options | Check specific options (micro/macro/biz/redirect) first; generic affirmatives are final fallback |
| AE7 | Username case mismatch in `buildFollowUpArgs` | Case-insensitive `.find()`: `p.username.toLowerCase() === c.username.toLowerCase()` |
| AE8 | Test plan missing: `detectPipelineSwitch`, heuristic false-positives, retry counter, isConfirmingPending cleanup | Add unit tests for all pure functions in new test file |
| AE9 | User text not escaped in `buildConfirmReplyPrompt` | `replace(/"/g, '\\"').replace(/[\n\r]/g, ' ')` before injection |

---

## Design Review Amendments (incorporated)

| ID | Finding | Amendment |
|----|---------|-----------|
| AD1 | Dual affordance — buttons and textarea are visually equal | Add "Quick picks:" label above buttons in confirming state; change placeholder to "Or describe what you want…" |
| AD2 | `isConfirmingPending` underspecified + buttons race | Move `isConfirmingPending` to `useConversation` return; expose from hook; disable confirm buttons while pending |
| AD3 | No echo after typed confirm — intent mapping invisible | Add echo message before `confirmSeeds(mappedOption)`: "Got it — running with '[option]'…" |
| AD4 | Route-switch hint is broken compound sentence + inconsistent | Remove confidence-conditional from message body; always append static one-line "Wrong pipeline? Just type what you want." below options (CSS: text-xs text-slate-400) |
| AD5 | Error recovery uses red bubble; no retry escalation | Use `type: 'text'` for confirm errors; add 2-retry counter; on 3rd fail, disable textarea and say "Let's keep it simple — just pick one of the options." |
| AD6 | `isSendingRef` bug: recursive `sendMessage` silently no-ops | Add `isSendingRef.current = false` before recursive call; add "Switching to [pipeline]…" transition message |
| AD7 | `isConfirmingPending` lifecycle orphaned in ChatPage | Move to `useConversation`, cleared in `finally` block, exposed in return value |
| AD8 | Textarea enabled during pending — allows double submit | Add `|| isConfirmingPending` to textarea disabled condition |
| AD9 | `discoveryStore.candidateProfiles` field unvalidated | Read `discoveryStore.ts` before implementing Change 3; verify field name |
| AD10 | No visual affordance for textarea in confirming state | Add `border-indigo-300 ring-1 ring-indigo-100` to textarea on confirming entry; auto-focus textarea |

---

## Decision Audit Trail

<!-- AUTONOMOUS DECISION LOG -->

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO | Accept pipeline-switch gap as Critical → add `detectPipelineSwitch` | Mechanical | P1 | One clearly correct fix; gap would make Gap 2 non-functional | None |
| 2 | CEO | Add `routingConfidence` to intent schema | Mechanical | P1+P5 | Removes need for confidence-conditional copy variants; 2-line schema change | Not adding |
| 3 | CEO | `callGeminiConfirmReply` must validate return against availableOptions | Mechanical | P5 | Explicit validation; Gemini near-miss would corrupt niche context | Silently using return |
| 4 | CEO | Follow-up text-only is acceptable with explicit scope note | Taste (auto) | P3 | In-place filtering requires new state machine; scope it down | Full re-run scope |
| 5 | CEO | Heuristic pre-filter before Gemini (AM5) | Mechanical | P5+P3 | Faster, cheaper, 80% hit rate; Gemini fallback for the rest | Always Gemini |
| 6 | Design | Move `isConfirmingPending` to useConversation return | Mechanical | P5 | Lifecycle co-located with the logic that manages it | ChatPage useState |
| 7 | Design | Add echo message after typed confirm resolves | Mechanical | P1 | Closes conversational loop; user sees what was inferred | Silent option map |
| 8 | Design | Always show "Wrong pipeline?" hint, not confidence-conditional | Mechanical | P5 | Removes inconsistency; identical UX regardless of Gemini confidence | Conditional hint |
| 9 | Design | Use `type: 'text'` not `type: 'error'` for confirm error | Mechanical | P5 | Red bubble + "options above" creates spatial confusion | type:'error' |
| 10 | Design | Add 2-retry counter; lock textarea on 3rd fail | Mechanical | P1 | Prevents infinite-loop confirm; guides user back to buttons | No escalation |
| 11 | Design | Add border-indigo-300 + focus when confirming state entered | Mechanical | P1 | Visual affordance that typing is possible | No affordance |
| 12 | Eng | Explicit `isSendingRef.current = false` in code snippet (not just amendment table) | Mechanical | P5 | An implementer following the code verbatim must get the right version | Implicit fix |
| 13 | Eng | Add pending guard inside `confirmSeeds` | Mechanical | P1 | Button race bypasses `isSendingRef` entirely | Only UI disable |
| 14 | Eng | Use `.catch('high')` not `.nullish().default('high')` | Mechanical | P5 | Matches established `pipelineType` pattern; null from Gemini handled correctly | .default() |
| 15 | Eng | Specific options checked before generic affirmatives in heuristic | Mechanical | P5 | "fine" and "start" false-positives would route user wrong | Original order |
| 16 | Eng | Case-insensitive username match in buildFollowUpArgs | Mechanical | P1 | Gemini may return different casing; 0 followers/ER is worse than no feature | Exact match |

---

## CEO Review Amendments (incorporated)

| ID | Finding | Amendment |
|----|---------|-----------|
| AM1 | Text-during-confirming doesn't handle pipeline switch | Add pipeline-switch detection (keyword heuristic) before `callGeminiConfirmReply`; if switch detected → reset to chatting + re-submit |
| AM2 | `callGeminiConfirmReply` must handle discovery options (only 2 options) | Explicit handling for `[PROCEED_LABEL, DISCOVERY_REDIRECT_TO_COMPETITOR]` pair |
| AM3 | Invisible routing causes the ambiguity that labeling then has to fix | Add `routingConfidence: 'high' \| 'medium'` to intent schema; when 'medium', add route-switch hint to confirm message |
| AM4 | No loading state when text submitted during confirming | Add `isConfirmingPending` state flag → TypingIndicator or button spinner |
| AM5 | Always-Gemini for confirm reply adds latency for common cases | Add `heuristicConfirmMatch()` pure function as pre-filter before Gemini call |

---

## Architecture

### Change 0: Add `routingConfidence` to intent schema (AM3)

**`src/ai/prompts.ts` — `buildIntentPrompt()`**

Add to the PIPELINE ROUTING section:
```
- Add routingConfidence: "high" if you are confident in the routing choice, "medium" if the message is ambiguous
  (e.g. location mentioned but could be either competitor or discovery)
```

**`src/ai/intentParser.ts` — IntentSchema**

```typescript
routingConfidence: z.enum(['high', 'medium']).nullish().default('high'),
```

This field is used by confirm messages to optionally append a route-switch hint.

### Change 1: Transparent routing messages

**`src/hooks/useConversation.ts` — `runCompetitorDiscovery()`**

Replace the opaque seed-confirm message with one that names the pipeline and offers a switch:

```typescript
// Current (opaque):
content: `Found ${seeds.length} accounts in the **${niche}** space${location ? ` in ${location}` : ''}. Which direction should I focus on?`

// New (transparent):
const locationSuffix = location ? ` in ${location}` : ''
const switchHint = location
  ? ` Or say "find ${location} creators" to run location discovery instead.`
  : ''
content: `Found ${seeds.length} **${niche}** accounts — running **competitor analysis**. Pick a direction to focus the ranking:${switchHint}`
```

**`src/tools/registry.ts` — discovery `confirmMessage`**

Replace with a message that names the pipeline and offers a switch:

```typescript
// Current:
return `I'll find **${niche}** creators physically based in **${location}**. Ready to search?`

// New:
return `Running **location discovery** — finding ${niche} creators physically based in **${location}**. Say "go" to start, or type what you actually want.`
```

### Change 2: Text input during confirming

**Scope:** 3 files — `useConversation.ts`, `ChatPage.tsx`, `ai/gemini.ts` + `ai/prompts.ts`

#### 2a. Enable text input + loading state in ChatPage (includes AM4)

Add `isConfirmingPending` state flag:
```typescript
const [isConfirmingPending, setIsConfirmingPending] = useState(false)
```

Pass it to `sendMessage` wrapper to show TypingIndicator during confirming text submit.

#### 2a-form. Enable text input in ChatPage

Change the `disabled` condition and `canSend`:

```typescript
// Current:
const canSend = (status === 'chatting' || activePipeline.followUpAllowed)
  && inputText.trim().length > 0 && ready

disabled={status !== 'chatting' && !activePipeline.followUpAllowed}

// New:
const canSend = (status === 'chatting' || status === 'confirming' || activePipeline.followUpAllowed)
  && inputText.trim().length > 0 && ready

disabled={!['chatting', 'confirming'].includes(status) && !activePipeline.followUpAllowed}
```

Also change the placeholder during confirming state to invite typing:
```typescript
// Current:
? 'Select an option above to continue…'

// New:
? 'Type your preference, or pick an option above…'
```

#### 2b-pre. Pipeline-switch detection (AM1)

Before calling `callGeminiConfirmReply`, check if the user's text signals a pipeline switch:

```typescript
// In the confirming path of sendMessage():
const pipelineSwitch = detectPipelineSwitch(safeText, pipelineType)
if (pipelineSwitch) {
  // Reset to chatting and re-submit as a fresh message
  store.setStatus('chatting')
  await sendMessage(safeText)
  return
}
```

```typescript
/**
 * Returns true if the user's text clearly signals they want the other pipeline.
 * This is a heuristic — explicit keywords only. Ambiguous cases fall through to Gemini.
 */
function detectPipelineSwitch(text: string, currentPipeline: string): boolean {
  const lower = text.toLowerCase()
  if (currentPipeline === 'competitor') {
    // User is in competitor flow but wants location discovery
    return /\b(local|based in|located in|find.*creator|creator.*in|discovery|location)\b/.test(lower)
  }
  if (currentPipeline === 'discovery') {
    // User is in discovery flow but wants competitor analysis
    return /\b(competitor|global|dominates|analysis|similar to|who.*winning)\b/.test(lower)
  }
  return false
}
```

#### 2b-mid. Heuristic pre-filter (AM5)

Before calling Gemini, try a keyword-based option match:

```typescript
function heuristicConfirmMatch(text: string, options: string[]): string | null {
  const lower = text.toLowerCase()
  if (/\b(yes|go|ok|sure|proceed|start|looks? right|fine)\b/.test(lower)) return options[0]
  const microOpt = options.find(o => /micro/i.test(o))
  if (microOpt && /\b(micro|small|under|100k)\b/.test(lower)) return microOpt
  const macroOpt = options.find(o => /macro/i.test(o))
  if (macroOpt && /\b(macro|large|big|100k\+)\b/.test(lower)) return macroOpt
  const bizOpt = options.find(o => /business/i.test(o))
  if (bizOpt && /\b(business|brand|company)\b/.test(lower)) return bizOpt
  const redirectOpt = options.find(o => o === DISCOVERY_REDIRECT_TO_COMPETITOR)
  if (redirectOpt && /\b(competitor|global|dominates|analysis)\b/.test(lower)) return redirectOpt
  return null
}
```

If `heuristicConfirmMatch` returns non-null, call `confirmSeeds(match)` directly — no Gemini call.

#### 2b. Add confirming path in `sendMessage()`

In `useConversation.ts`, before the `if (store.status !== 'chatting') return` guard:

```typescript
// Confirming path: user typed instead of clicking a button
if (store.status === 'confirming') {
  if (!text.trim() || isSendingRef.current) return
  isSendingRef.current = true
  try {
    const safeText = text.replace(/[\n\r]/g, ' ').trim().slice(0, 500)
    store.addMessage({ role: 'user', content: safeText, timestamp: Date.now(), type: 'text' })

    if (!geminiKey?.trim()) {
      store.addMessage({
        role: 'assistant',
        content: 'Gemini API key missing. Add it in Settings.',
        timestamp: Date.now(),
        type: 'error',
      })
      return
    }

    // Interpret the typed text as a confirm reply
    const { parsedIntent } = store
    const pipelineType = parsedIntent && 'pipelineType' in parsedIntent
      ? (parsedIntent.pipelineType ?? 'competitor')
      : 'competitor'
    const availableOptions = PIPELINE_REGISTRY[pipelineType]?.confirmOptions(
      parsedIntent as ResolvedIntent
    ) ?? [PROCEED_LABEL]

    const mappedOption = await callGeminiConfirmReply(
      geminiKey,
      safeText,
      availableOptions,
    )
    confirmSeeds(mappedOption)
  } catch {
    store.addMessage({
      role: 'assistant',
      content: "Couldn't understand that. Pick one of the options above or try again.",
      timestamp: Date.now(),
      type: 'error',
    })
    store.setStatus('confirming') // stay in confirming
  } finally {
    isSendingRef.current = false
  }
  return
}
```

#### 2c. New function: `callGeminiConfirmReply()` in `src/ai/gemini.ts`

```typescript
/**
 * Map a free-form typed confirmation reply to one of the known option strings.
 * Uses temperature 0 for deterministic routing.
 * Falls back to the first option (PROCEED_LABEL) if the model is uncertain.
 */
export async function callGeminiConfirmReply(
  geminiKey: string,
  userText: string,
  availableOptions: string[],
  signal?: AbortSignal,
): Promise<string>
```

Uses a `buildConfirmReplyPrompt()` prompt in `prompts.ts`. Structured output (JSON mode):
```json
{ "selectedOption": "<one of the available option strings>" }
```

#### 2d. New function: `buildConfirmReplyPrompt()` in `src/ai/prompts.ts`

```typescript
export function buildConfirmReplyPrompt(
  userText: string,
  availableOptions: string[],
): string
```

Prompt structure:
```
The user was shown these options: [list of options]
They typed: "<userText>"
Return the option they most likely meant. If they said "go", "yes", "proceed", "ok" → return the first option.
Return JSON: { "selectedOption": "<exact option string>" }
```

### Change 3: Richer follow-up context

**`src/ai/prompts.ts` — `buildFollowUpContext()`**

Add an optional `accountSummaries` parameter:

```typescript
export function buildFollowUpContext(
  summary: string,
  accountSummaries?: Array<{ username: string; followers: number; er: number }>,
): string
```

When `accountSummaries` is provided, append a formatted table:
```
Top accounts from this analysis:
- @username1 — 45K followers, 4.2% ER
- @username2 — 120K followers, 2.8% ER
...
```

**`src/hooks/useConversation.ts` — `buildPipelineSummary()`**

Extend to pass account data:

```typescript
// Pass top 5 accounts (name + followers + ER) to follow-up context
const buildFollowUpArgs = (): Parameters<typeof buildFollowUpContext> => {
  if (store.status === 'done') {
    const summary = `Competitor analysis — ${store.competitors.length} accounts${store.niche ? ` in the ${store.niche} space` : ''}.`
    const accounts = store.competitors.slice(0, 5).map((c) => {
      const profile = store.candidateProfiles?.find((p) => p.username === c.username)
      return {
        username: c.username,
        followers: profile?.followersCount ?? 0,
        er: profile?.engagementRate ?? 0,
      }
    })
    return [summary, accounts]
  }
  if (discoveryStore.status === 'done') {
    const n = discoveryStore.results.length
    const city = discoveryStore.params?.city
    const summary = `Location discovery — ${n} creator${n !== 1 ? 's' : ''}${city ? ` in ${city}` : ''}.`
    const accounts = discoveryStore.candidateProfiles?.slice(0, 5).map((p) => ({
      username: p.username,
      followers: p.followersCount ?? 0,
      er: p.engagementRate ?? 0,
    })) ?? []
    return [summary, accounts]
  }
  return ['Analysis complete.']
}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| *(none)* | All changes are to existing files |

## Files to Modify

| File | Change | Risk |
|------|--------|------|
| `src/ai/prompts.ts` | Add `buildConfirmReplyPrompt()`; extend `buildFollowUpContext()` signature; add `routingConfidence` to `buildIntentPrompt` | Low |
| `src/ai/intentParser.ts` | Add `routingConfidence` field to IntentSchema using `.catch('high')` (not `.default`) | Low |
| `src/ai/gemini.ts` | Add `callGeminiConfirmReply()` | Low |
| `src/tools/registry.ts` | Update discovery `confirmMessage` | Low |
| `src/hooks/useConversation.ts` | Add confirming path (pipeline-switch + heuristic + Gemini); update competitor confirm message with routingConfidence hint; update `buildFollowUpArgs` | High |
| `src/pages/ChatPage.tsx` | Update `canSend`, `disabled`, confirming placeholder; add `isConfirmingPending` flag | Medium |

## Files NOT to Change

- `src/store/analysisStore.ts`
- `src/store/discoveryStore.ts`
- `src/hooks/useActivePipeline.ts`
- `src/hooks/useCompetitorAnalysis.ts`
- `src/hooks/useLocationDiscovery.ts`
- `src/ai/intentParser.ts`
- `src/tools/types.ts`
- All existing test files — no deletions or rewrites

---

## Implementation Order

1. `src/ai/prompts.ts` — add `buildConfirmReplyPrompt()`; extend `buildFollowUpContext()` signature; add `routingConfidence` hint to `buildIntentPrompt`
2. `src/ai/intentParser.ts` — add `routingConfidence` field to IntentSchema
3. `src/ai/gemini.ts` — add `callGeminiConfirmReply()`
4. `src/tools/registry.ts` — update discovery `confirmMessage`
5. `src/hooks/useConversation.ts` — `detectPipelineSwitch()` + `heuristicConfirmMatch()`; confirming path; transparent competitor message (with routingConfidence hint); richer `buildFollowUpArgs()`
6. `src/pages/ChatPage.tsx` — `canSend`, `disabled`, placeholder, `isConfirmingPending`

---

## Success Criteria

1. All existing tests pass
2. TypeScript compiles clean
3. When competitor pipeline is chosen, the confirm message explicitly says "competitor analysis"
4. When discovery pipeline is chosen, the confirm message explicitly says "location discovery"
5. During `status === 'confirming'`, the user can type; typing triggers `callGeminiConfirmReply` and routes to the appropriate `confirmSeeds()` action
6. After pipeline completes and user asks "show me accounts under 50K followers", the follow-up response names specific accounts from the result set
7. Button-based confirmation still works exactly as before

---

## Test Plan

### New test files required
| File | Tests |
|------|-------|
| `src/hooks/conversationalUX.test.ts` | Pure functions: ① `detectPipelineSwitch('find Mumbai creators', 'competitor')` returns true ② `detectPipelineSwitch('global dominates niche', 'discovery')` returns true ③ `detectPipelineSwitch('go', 'competitor')` returns false (not a switch) ④ `heuristicConfirmMatch('yes', options)` returns PROCEED_LABEL ⑤ `heuristicConfirmMatch('focus on micro', options)` returns micro option ⑥ `heuristicConfirmMatch('I am fine with macro', options)` returns macro (NOT PROCEED_LABEL — "fine" false-positive regression) ⑦ `heuristicConfirmMatch('start with micro', options)` returns micro (NOT PROCEED_LABEL — "start" false-positive regression) ⑧ `heuristicConfirmMatch('something completely unexpected', options)` returns null |

### Existing test files to extend
| File | Addition |
|------|---------|
| `src/ai/prompts.test.ts` | ① `buildConfirmReplyPrompt` includes all option strings in output ② `buildFollowUpContext` with account summaries includes account data in output ③ `buildConfirmReplyPrompt` escapes `"` in user text |
| `src/hooks/useConversation` (integration) | ① sendMessage during 'confirming' calls callGeminiConfirmReply and then confirmSeeds ② sendMessage during 'confirming' with empty text is a no-op ③ isConfirmingPending resets to false in error path (not just success path) |

---

## Architecture Notes (Eng Review)

- `detectPipelineSwitch()` and `heuristicConfirmMatch()` are pure functions — zero imports, easy to unit test
- `callGeminiConfirmReply` uses JSON mode + `responseSchema: {selectedOption: string}`, temperature: 0, maxOutputTokens: 64
- All new code is in `useConversation.ts` or small additions to `gemini.ts`/`prompts.ts`; no new files required
- `isConfirmingPending` is reactive state in `useConversation`, exposed in return value, cleared in `finally` block
- No new Zustand state — `isConfirmingPending` is React `useState` in the hook
- `isSendingRef.current = false` must appear BEFORE `await sendMessage(safeText)` in the pipeline-switch block
- AbortController for confirm Gemini call: assign to `discoveryAbortRef.current` (same pattern as existing paths)

## What's Deferred

- Full pipeline re-run from follow-up (e.g., "redo with micro-influencers only" triggers a new Apify run) — requires new state machine state
- Streaming Gemini responses for faster perceived follow-up
- Filter results in-place (show filtered result cards inline in chat, not just text responses)
- `routingConfidence === 'medium'` analytics / telemetry (the field exists but we're not tracking how often it fires)

---

## GSTACK REVIEW REPORT

| Phase | Verdict | Key findings |
|-------|---------|--------------|
| CEO Review | APPROVE WITH AMENDMENTS | Critical: text-during-confirming doesn't handle pipeline switch → add `detectPipelineSwitch`; add `routingConfidence` field; heuristic pre-filter before Gemini |
| Design Review | APPROVE WITH AMENDMENTS | Critical: dual affordance confusion → label buttons as shortcuts, change placeholder; High: `isSendingRef` bug in pipeline-switch path; always-show "Wrong pipeline?" hint |
| Eng Review | APPROVE WITH AMENDMENTS | Critical: code snippet missing `isSendingRef=false`; High: button+type race, unvalidated Gemini return; Medium: `.catch` not `.default`, heuristic order, case-insensitive username match |
| **Final** | **APPROVED WITH AMENDMENTS** | All 16 auto-decisions applied; 0 user challenges; 0 taste decisions (all findings had clear right answers); test plan written to disk |

Auto-decisions applied: 16 (see Decision Audit Trail)
User Challenges: 0
Taste Decisions: 0
Phases skipped: DX (no developer-facing scope)
