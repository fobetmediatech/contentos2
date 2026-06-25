# Plan: Hybrid Competitor Discovery (close the ChatGPT recall gap)

- **Status:** Proposed (verified against codebase 2026-06-25)
- **Owner:** Aditya Raj
- **Area:** Competitor Analysis pipeline
- **Decision locked:** Full hybrid (4 components). Ranking precision is a **mode**, default `precise`.

---

## 1. Problem

Side-by-side, ChatGPT Plus produces visibly better competitor-analysis output than Content OS. The
strategist sees recognizable, on-niche creators with rich context; Content OS returns a thinner list,
sometimes with unfamiliar handles.

## 2. Root cause — it's recall, not the model or the prompt

Content OS uses the LLM **only as a ranker** over a candidate pool built by a 2-hop Instagram graph
walk (`relatedProfiles` + hashtag post-authors), seeded entirely from the user's reference handles.
A hard hallucination filter (`competitors.filter(inPool)`, `useCompetitorAnalysis.ts:232`) guarantees
the output can never contain an account that isn't already in that scraped pool.

ChatGPT uses the LLM as a **generator** — it recalls the actual top creators in a niche from world
knowledge, then reasons. No matter how good our prompt is, **Gemini can only pick from what the scrape
found.** That is a recall ceiling. The whole defensive prompt (adjacency guards, dead-account gate,
"empty slot beats filler") is optimizing *precision* on a fundamentally *low-recall* pool.

What we do **better** and must keep: our output is live and **verified** (real follower counts, real
ER, confirmed-active) and never invents a handle.

## 3. Goal / non-goals

**Goal:** Raise candidate recall to ChatGPT levels while preserving (and strengthening) our
verification edge, so results are both recognizable *and* trustworthy.

**Non-goals:**
- Removing the `inPool` filter (it is the safety net — we strengthen it, not drop it).
- Changing the persisted payload `kind` discriminants (frozen).
- A visual redesign of result cards (separate track).

## 4. Approach — "seed-and-verify" hybrid

Use the LLM (and the web) the way ChatGPT does — as a **candidate generator** — then run every named
account through the verification we already have, plus a new **identity** check.

```
BEFORE
  reference handles ──▶ relatedProfiles graph walk (R2/R3)
                       + hashtag post-authors            ──▶ pool ──▶ Gemini RANKS ──▶ inPool filter ──▶ results

AFTER (4 sources fan in, then verify → dedup → rank)
  reference handles ─┬▶ relatedProfiles graph walk (R2/R3)      ┐
                     ├▶ hashtag post-authors                    │
   niche (A) ────────┼▶ LLM names 20–30 creators ─▶ scrape ─────┼▶ MERGE+DEDUP ─▶ identity check
   niche (B) ────────┤   (+ Google Search grounding for recency)│       │
   niche (C) ────────┴▶ IG keyword search ─▶ scrape ────────────┘       ▼
                                                          dead-account gate ─▶ Gemini RANKS (precise|broad) ─▶ inPool ─▶ results
```

### Components

| # | Component | What it adds | Server change? |
|---|-----------|--------------|----------------|
| **A** | Knowledge seed generator | A Gemini call **names** 20–30 real creators in the niche; we scrape them to verify-real + attach live metrics. Tagged `discoverySource:'knowledge'`. | **No** (verified) |
| **B** | Web-recency grounding | Adds `tools:[{googleSearch:{}}]` to the seed call so it surfaces accounts past Gemini's training cutoff. | **No** (verified — proxy forwards body verbatim) |
| **C** | IG keyword-search source | A 4th pool source via the already-allowlisted `apify-instagram-scraper` with `searchType:'user'`. Tagged `discoverySource:'search'`. | **No** (verified — actor already allowlisted) |
| **D** | Broad vs precise mode | `mode:'precise'\|'broad'` (default `precise`) on the ranker; `broad` relaxes *prompt-level* niche guards only. | No |

## 5. Verified integration map

All facts below were confirmed by reading the code (6-agent verification pass, 2026-06-25).

### Component A/B — Gemini transport (`api/gemini.ts`, `src/ai/gemini.ts`, `src/ai/prompts.ts`)
- `api/gemini.ts` is a **verbatim body-forwarder** (reads `{model, endpoint, body}`, forwards `body`
  untouched). `tools:[{googleSearch:{}}]` passes through. **No proxy edit.**
- Effective model is `gemini-2.5-flash` (`VITE_GEMINI_MODEL` unset everywhere) — allowlisted and
  grounding-capable.
- **Hard constraint:** Gemini 2.5 **forbids** `responseSchema` / `responseMimeType:'application/json'`
  together with `tools:[{googleSearch:{}}]`. So the grounded seed call **cannot reuse
  `callGeminiWithSchema`** (always sets `responseSchema`) **nor `callGeminiWithTools`** (hardcodes
  `functionDeclarations`). Write a **new caller** `generateNicheCandidates()` that routes through
  `geminiGenerate`, instructs JSON in the prompt, and parses the text (reuse the fence-strip/`JSON.parse`
  block at `gemini.ts:227-237`; extract text via `joinThoughtFilteredText`).
- Use the modern `googleSearch` (camelCase) shape, **not** the legacy `google_search_retrieval`.

### Component C — IG search actor (`src/lib/actors.ts`, `src/lib/apifyClient.ts`)
- The search actor **is** `apify-instagram-scraper`, **already in `ALLOWED_ACTORS` (`api/apify.ts:37`)** —
  no server edit (it doubles as `REEL_SCRAPER`). A *dedicated* search actor would require an allowlist edit;
  reusing this one keeps `serverTouch:false`.
- Input: `{ search, searchType:'user', searchLimit, resultsType:'details' }`. `search` and `directUrls`
  are **mutually exclusive** — do not pass URLs.
- **Output field is `username`** (account search), **not `ownerUsername`** (the hashtag path). Copy-pasting
  the hashtag mapper yields zero results — smoke-test it.
- Add `scrapeSearchUsernames()` mirroring `scrapeHashtagUsernames()`, then profile-scrape the handles
  (two-step, like the hashtag path) so results enter the pool as real `NormalizedProfile`s.

### `discoverySource` union (`src/lib/transformers.ts:52`)
- Single source of truth. **Exactly one production consumer**: the source-label switch in
  `prompts.ts:162-168`. It has a **silent `''` else** — forgetting the new cases produces *unlabeled*
  candidates (a quality gap), **no compile error**. The `inPool` filter keys on username only, so it is
  source-agnostic.
- Must update: the union; the `prompts.ts` switch (add `knowledge`, `search`); the exhaustive-union test
  `transformers.test.ts:108`; label assertions in `prompts.test.ts`.
- **Not persisted** (lives on transient `NormalizedProfile`) → no store migration.

### Component D — mode threading (mirror `nicheContext`, **not** `depth`)
- Path: `agentTools.ts` `discover_competitors` (zod, default `'precise'` via nullish transform like
  `discover_by_location.depth`) → `useAgentConversation.ts` `dispatchTool` (**both** analyze calls) →
  `AnalysisParams` (`analysisStore.ts`) → `useCompetitorAnalysis.ts` `analyzeMutation` →
  `analyzeCompetitors` (`gemini.ts`) → `buildCompetitorPrompt`.
- `analyzeCompetitors` is called **twice** (strict `L222` + relaxed top-up `L242`) — pass `mode` in **both**.
- `broad` relaxes, in `buildCompetitorPrompt`: the ADJACENT NICHE GUARD (`L268`), the empty-slot rule
  (`L271`), the count instruction (`L217`), and the niche-derivation block (`L230-238`).

### Impact / blast radius (gitnexus + grep)
- `discoverCompetitors` — **LOW**, 1 production caller (`useCompetitorAnalysis` `mutationFn`).
- `buildCompetitorPrompt` — **LOW**, 1 production caller (`analyzeCompetitors`). (gitnexus reported 0 — a
  false-low; it drops test files and one CALLS hop.)
- Keep `discoverCompetitors` return shape `{ inputProfiles, candidateProfiles }` unchanged; new candidates
  ride in `candidateProfiles`.

## 6. Critical findings (these reshape the plan)

Three adversarial critiques changed the design. **The plan is not safe without their mitigations.**

### CR-1 — Latency: "parallel sources stay flat" is **WRONG** 🔴
All profile scrapes share **one** module-scoped `pLimit(3)` (`apifyClient.ts:33`). `Promise.all` is
concurrency *intent*, not capacity — new batches **queue behind** the existing Round 2 / hashtag / Round 3
batches on the same 3 slots. Current standard run already consumes ~100s of the 150s `TIMEOUT_MS`. Folding
in A (~3 verify batches) and C (two serial Apify runs: search → profile-scrape) pushes total wall-clock
toward/over 150s → **mid-run abort → partial/empty pool** (the exact recall regression we're fixing).

**Required mitigations (all):**
1. Give the speculative sources (A, C) a **dedicated limiter** *or* raise `MAX_CONCURRENT` to ~6 **and**
   confirm Apify per-key concurrency headroom.
2. **Hard-cap** seed handles (≤20) and IG-search results (≤20) → each new source adds ≤1–2 waves.
3. Account for the extra **serial** stages (C's search→scrape; A's prior Gemini+grounding call).
4. **Budget the 150s window explicitly** (or raise it) — verify worst-case `waves × ~25s + R1 + Gemini`
   stays under it with margin.
5. **Graceful degradation:** a slow/timed-out new source must return a partial pool, never abort the run.

### CR-2 — Verification proves existence, not **identity** 🔴
- **(a) Not a graceful drop.** `scrapeHandles` batches 10 handles into **one** run. A non-existent handle
  is usually *omitted* (run still SUCCEEDED) — fine. But if the run ends FAILED/TIMED-OUT/ABORTED, the
  **whole batch rejects** via `Promise.all` fail-fast, taking trusted graph-walk seeds down with it
  (non-quota errors don't failover). LLM-generated strings are adversarial input the batch path isn't
  isolated against.
- **(b) False positives — the biggest hole.** There is **zero name→handle reconciliation.** `inPool`
  + the dead-account gate only check *existence* and *activity*. If Gemini emits `@johnsmith` (a real but
  unrelated person) for fitness creator "John Smith", the pipeline surfaces a **verified-looking competitor
  with real metrics** — *more* misleading than a ChatGPT hallucination because it looks confirmed.

**Required mitigations (all):**
1. **Per-handle fault isolation** for A/C: scrape speculative handles in 1-handle runs *or* wrap in
   `Promise.allSettled` (never `Promise.all`) so one bad seed can't collapse the batch or the trusted
   graph-walk source running in parallel.
2. **Identity verification, not just existence:** compare the scraped account's `fullName`/`bio`/
   `businessCategoryName` against the creator the LLM intended; reject mismatches. (Existence-verification
   beats ChatGPT *only after* identity-verification is added.)
3. **Trust tiering:** tag knowledge/search candidates with a distinct `discoverySource` and a lower trust
   weight so a slip-through is visibly attributed and down-ranked, never blended in as confirmed.

### CR-3 — Security, dedup, provenance, and the no-seed case 🟠
- **Prompt-injection surface:** web-grounded/LLM-named handles get scraped and their **bios re-enter
  `buildCompetitorPrompt`**. The existing `SECURITY RULE` + `sanitizeForPrompt` defend the *ranker*, but a
  handle the LLM/web *names* is a new scrape target and a new bio source. Run every LLM/web-derived handle
  **and its scraped bio** through `sanitizeForPrompt` before it re-enters any prompt or scrape call. Add an
  identity/impersonator floor (verified flag, or follower/post-history minimum).
- **Dedup:** `discoverCompetitors` uses a *sequential* `seenHandles` set; parallel knowledge/search handles
  can be scraped 2–4× and produce duplicate candidate lines with conflicting source labels. Add
  **merge-time dedup by normalized username with documented source precedence**
  (e.g. `knowledge > hashtag > search > relatedProfiles > round3`).
- **Corpus provenance:** `Sighting` (`corpus.ts`) records no `discoverySource`, so a hallucination gets
  remembered and resurfaces via `[KNOWN]` labels. Add an append-only provenance field before A/B ship.
- **Persisted payloads:** `analysisStore` isn't persisted (no migration), but `conversationsStore`
  persists `ResultPayload`s — confirm `mode`/`discoverySource` never land in a persisted payload, else bump
  `version` + `migrate`.
- **Cost controls:** add **per-source caps** mirroring the existing round caps; a wide query otherwise
  triples Apify spend.
- **Telemetry:** keep `devLog` parity for net-new counts, with research-target data DEV-gated (C3 rule).
- **No-seed-handle bootstrap (high value):** "who's winning in fitness" with **no @handle** today returns
  empty (`sparseSeedMessage`) — there's nothing for the graph walk to seed from. A/B/C are the **only** way
  to serve this query. The plan needs a **bootstrap path** that skips Rounds 1–3 and runs seed+search
  directly from the niche, plus a niche-confirmation UX.
- **Broad mode scope:** `broad` relaxes **prompt-level** guards only — it must **never** relax `inPool` or
  the dead-account gate, or it becomes the hallucination vector.

## 7. Cross-cutting invariants (every phase must honor)

1. `inPool` and the dead-account gate are never weakened. `broad` touches prompt text only.
2. Speculative (LLM/web) sources are **fault-isolated** from trusted sources (`Promise.allSettled`).
3. Every LLM/web-derived handle passes an **identity** check before ranking; bios are `sanitizeForPrompt`'d.
4. The pipeline degrades gracefully under the 150s budget — a slow source yields a partial pool, not an abort.
5. New `discoverySource` values get explicit labels (no silent `''` fallthrough) and merge-time dedup.
6. Per-source Apify caps; `devLog` parity; research-target data DEV-only.

## 8. Phased delivery

Each phase is its own PR with ≥1 agent golden-set eval case (CLAUDE.md rule) + unit tests + green
`bun run build`/`bun run test`.

### Phase 1 — Component A (knowledge seed) + Component D (mode) + the hardening A depends on
The biggest single recall jump, **no server change**. Scope:
- New `generateNicheCandidates()` (`gemini.ts`) + `buildNicheSeedPrompt()` (`prompts.ts`).
- Seed scrape with **per-handle fault isolation**, **identity check**, **cap ≤20**, dedicated limiter (or
  raised `MAX_CONCURRENT` + caps), merge+dedup into `candidateProfiles`, tag `discoverySource:'knowledge'`.
- `discoverySource` union + `prompts.ts` label case + tests.
- `mode:'precise'|'broad'` threaded through both `analyzeCompetitors` call sites; `broad` relaxes
  prompt-level guards only.
- **No-seed-handle bootstrap** path (run seed directly from niche when `handles` is empty).
- **Acceptance:** for a real niche, results include recognizable creators ChatGPT names, all
  scrape-verified + identity-checked; no run exceeds the latency budget; `precise` output is byte-identical
  to today when no knowledge source is present.

### Phase 2 — Component B (web-recency grounding)
- Add `tools:[{googleSearch:{}}]` to the seed call via the bespoke caller (prompt-instructed JSON + parse).
- Sanitize grounded handles + bios; capture `groundingMetadata` source URLs (optional surfacing).
- **Acceptance:** seed surfaces accounts newer than the model cutoff; request-shape unit test asserts the
  `googleSearch` tool is present; no schema+grounding conflict.

### Phase 3 — Component C (IG keyword-search source)
- `ACTORS.SEARCH_SCRAPER` + `buildSearchScraperInput` + `scrapeSearchUsernames` (output field `username`).
- 4th parallel source under the concurrency budget; tag `discoverySource:'search'`; dedup + caps.
- **Acceptance:** keyword search contributes net-new verified candidates; actor-id asserted against the
  allowlist; latency budget held.

## 9. Test & eval obligations (verified)

- **Eval (`src/ai/agentLoop.eval.test.ts`):** add ≥1 `discover_competitors` case (broad-recall phrasing).
  Note: the eval is **cost-gated** (skipped without `VITE_GEMINI_API_KEY`) and can assert **routing only**
  — it cannot see `mode`/knowledge internals.
- **`src/ai/prompts.test.ts`:** label assertions for `knowledge`/`search` (scope to the single candidate
  line — the SOURCE PRIORITY block contains the same bracket strings); `precise` vs `broad` guard strings.
- **New `src/lib/apifyClient.merge.test.ts`** (mock `./apifyCore` like `apifyClient.keys.test.ts`): knowledge
  seeds that resolve are tagged + merged into `candidateProfiles`; unresolved/identity-mismatched seeds are
  dropped **before** `inPool` — the single highest-value correctness assertion.
- **`src/hooks/useAgentConversation.test.ts`:** assert `mode` reaches `analyze()` (broad phrasing → `'broad'`,
  default → `'precise'`).
- **Baseline:** `bun run test` = 67 passed / 19 skipped (the 19 are the cost-gated live evals).

## 10. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| New sources blow the 150s budget → empty pool | 🔴 High | Dedicated limiter / raise cap; hard caps; graceful partial-pool degradation (CR-1) |
| Wrong-but-real handle surfaces with real metrics | 🔴 High | Identity check beyond `inPool`; trust tiering; down-rank (CR-2) |
| One bad LLM seed fails the whole batch | 🔴 High | Per-handle isolation / `Promise.allSettled` (CR-2) |
| Attacker/impersonator bio reaches the ranker | 🟠 Med | `sanitizeForPrompt` on LLM/web handles+bios; impersonator floor (CR-3) |
| Duplicate candidates across 4 sources | 🟠 Med | Merge-time dedup by normalized username + precedence (CR-3) |
| Apify cost blowup on wide queries | 🟠 Med | Per-source caps mirroring round caps (CR-3) |
| Hallucination remembered in corpus | 🟡 Low | Append-only provenance on `Sighting` (CR-3) |
| `broad` weakens anti-hallucination | 🟡 Low | `broad` = prompt-level only; never touches `inPool`/gate (CR-3) |

## 11. Open questions

1. **Latency budget:** dedicated limiter vs raise `MAX_CONCURRENT` to 6 — what is the real Apify per-key
   concurrency headroom across the ~32-key pool?
2. **Identity check strictness:** how aggressive should name→handle matching be (exact vs fuzzy on
   `fullName`/bio) before we reject a seed? Tradeoff: strict = fewer false positives but lower recall.
3. **Bootstrap UX:** for the no-handle case, confirm the niche with the user before spending scrapes, or run
   speculatively and confirm after?
4. **Trust display:** surface knowledge/search provenance visually (DESIGN.md violet `#A78BFA` for
   AI-derived) or keep it internal-only to the ranker?
