# Fix: Intent Parser JSON Failures

<!-- /autoplan restore point: /Users/adityaraj0421/.gstack/projects/ContentOS2.0/feat-conversational-agent-autoplan-restore-20260601-142418.md -->

**Branch:** feat/conversational-agent
**Scope:** Bug fix — `intentParser.ts` consistently returning malformed/truncated JSON from Gemini

## Problem Statement

The intent parser (`src/ai/intentParser.ts`) is failing with two distinct errors in production:

1. `SyntaxError: Unexpected end of JSON input` — Gemini's JSON response is being truncated mid-object
2. `SyntaxError: Expected double-quoted property name in JSON at position 32` — Gemini returns JavaScript object notation (`{ key: "value" }`) instead of valid JSON (`{ "key": "value" }`)

Both errors surface as "Network error — check your connection and try again." in the chat UI — **a mislabeled error that confuses users into refreshing their network connection** when the real issue is the Gemini API response format.

### Reproduction path
1. Open the app
2. Type any message in the chat input
3. Both retries fail, user sees "Network error" (see attached console screenshot)

### Root causes

**RC1: `maxOutputTokens: 512` is too tight for `gemini-2.5-flash`**
The model (`gemini-2.5-flash`) is a thinking model. Even with thinking tokens billed separately, the output budget of 512 tokens can be exhausted by verbose JSON formatting or when the model adds any preamble, causing truncation (`Unexpected end of JSON input`).

**RC2: `gemini-2.5-flash` occasionally returns JS object syntax**
With `responseMimeType: 'application/json'` set, the model *usually* returns strict JSON, but sometimes returns `{ key: value }` (unquoted keys) particularly on short retry prompts — this is a known Gemini API quirk that `JSON.parse` doesn't handle.

**RC3: Mislabeled error propagation**
`callGeminiForIntent` wraps any non-GeminiError as `new GeminiError('UNKNOWN', 'Network error: ...')`. The string prefix "Network error:" causes `useConversation.ts` to match the `.includes('network')` check and show "Network error — check your connection" to the user.

**RC4: JSON parse retries don't inject error context**
The retry loop in `callGeminiForIntent` retries with the *identical* prompt on JSON failures — Gemini gets no feedback that its last response was invalid JSON. The `parseIntent()` validation-retry loop injects error context, but only triggers *after* a successful parse, which never happens here.

## Plan

### T1: Fix `src/ai/intentParser.ts`

**T1a: Increase `maxOutputTokens`**
Change `maxOutputTokens: 512` → `1024`. The intent JSON is ~150 tokens; 1024 gives 6.8x headroom.

**T1b: Disable thinking for the intent parser**
Add `thinkingConfig: { thinkingBudget: 0 }` to the `generationConfig`. Intent classification is a deterministic, low-creativity task — thinking adds latency and unpredictability without benefit.

**T1c: Add JSON repair for common Gemini malformations**
Before calling `JSON.parse(cleaned)`, apply a targeted repair for the two known failure patterns:
- Unquoted property keys: `{ key: "value" }` → `{ "key": "value" }`
- Trailing commas: `{ "a": 1, }` → `{ "a": 1 }`

**T1d: Fix error message prefix**
Change the `GeminiError` message from `'Network error: ...'` to `'Parse error: ...'` so `useConversation.ts`'s `.includes('network')` check doesn't fire.

### T2: Fix `src/hooks/useConversation.ts`

**T2a: Add a `PARSE_ERROR` error message path**
When Gemini returns valid HTTP but malformed JSON, show "Gemini returned an unexpected response — try again." instead of the misleading "Network error".

### Out of scope
- Switching intent parser model (addressed by T1b disabling thinking)
- Full JSON repair library (targeted repair covers the known failure modes)
- Caching intent results (unrelated to this bug)

## Files to change

| File | Change |
|------|--------|
| `src/ai/intentParser.ts` | T1a + T1b + T1c + T1d |
| `src/hooks/useConversation.ts` | T2a |

## Tests

- Update `src/ai/intentParser.test.ts` (if exists) to cover malformed-JSON repair
- Manually verify in the browser: typing a handle should parse correctly

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|---------------|-----------|-----------|----------|
| 1 | CEO | Premises accepted | Mechanical | P6 | Console errors are deterministic evidence of truncation (RC1) and JS-notation (RC2) | — |
| 2 | CEO | Scope is correct — 2 files | Mechanical | P2 | Full blast radius is `intentParser.ts` + `useConversation.ts`. No other consumers of `fetchIntent`. | — |
| 3 | CEO | Model switch deferred (see User Challenge) | USER CHALLENGE | — | Both models recommend either `gemini-2.0-flash` switch or `responseSchema` as structural fixes. Original plan dismissed without rationale. | — |
| 4 | Eng | Add `responseSchema` to `fetchIntent` (replaces regex repair T1c) | Taste | P5 | `responseSchema` enforces JSON grammar at token level — eliminates unquoted keys structurally. `gemini.ts` already uses this pattern for all other calls. Library (`jsonrepair`) also viable but adds dependency; `responseSchema` is zero-cost. | Regex repair (maintenance trap), `jsonrepair` library (unnecessary) |
| 5 | Eng | Guard `thinkingConfig` with model name check | Mechanical | P1 | `thinkingBudget: 0` causes 400 INVALID_ARGUMENT on non-2.5-flash models. Must guard by `MODEL.includes('2.5')` or equivalent. | Unconditional injection |
| 6 | Eng | Add `finishReason === 'MAX_TOKENS'` check before JSON.parse | Mechanical | P1 | Truncated JSON is a known-bad state. Detect it at source → throw PARSE_ERROR immediately → saves 3s wasted on retries. `gemini.ts` already does this at line 169. | Letting JSON.parse surface a vague SyntaxError |
| 7 | Eng | Throw `PARSE_ERROR` (not UNKNOWN) from callGeminiForIntent on SyntaxError | Mechanical | P5 | `PARSE_ERROR` already exists in `GeminiErrorCode`. Correct semantic. Unblocks proper error routing in useConversation. | UNKNOWN + message string matching |
| 8 | Eng | Tests: add in same commit | Mechanical | P1 | No existing tests for JSON failure paths. 6 test cases identified. | Deferring |

## Revised Tasks

### T1: Fix `src/ai/intentParser.ts`

**T1a: Increase `maxOutputTokens` to 1024** ✓ (auto-approved)

**T1b: Add `thinkingConfig` guarded by model name**
```typescript
...(MODEL.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
```

**T1c (REVISED): Add `responseSchema` instead of regex repair**
Add the intent schema as a `responseSchema` in `generationConfig`. This enforces JSON grammar at the token level — Gemini cannot produce unquoted keys or trailing commas when schema-constrained.

**T1d (REVISED): Check `finishReason === 'MAX_TOKENS'` before JSON.parse**
After extracting `candidate`, check `candidate.finishReason === 'MAX_TOKENS'` → throw `GeminiError('PARSE_ERROR', 'Intent response truncated (MAX_TOKENS) — increase maxOutputTokens', false)`.

**T1e: Throw `PARSE_ERROR` for SyntaxErrors in `callGeminiForIntent`**
When `lastErr instanceof SyntaxError`, throw `new GeminiError('PARSE_ERROR', ...)` instead of `new GeminiError('UNKNOWN', 'Network error: ...')`.

### T2: Fix `src/hooks/useConversation.ts`

**T2a: Add `PARSE_ERROR` branch**
```typescript
} else if (err.code === 'PARSE_ERROR') {
  errorContent = "Gemini returned an unexpected response — try again."
```

### T3: Add tests to `src/ai/intentParser.pipelineType.test.ts` (or new file)

1. `finishReason: 'MAX_TOKENS'` → throws `PARSE_ERROR`
2. `thinkingConfig` is included in request body when model is 2.5-flash
3. `thinkingConfig` is NOT included when model is 2.0-flash
4. All retries exhausted on SyntaxError → throws `GeminiError('PARSE_ERROR', ...)`
