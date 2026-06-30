# Engineering Decisions & Problem-Solving Log — Content OS 2.0

> A running record of the critical engineering decisions, non-obvious problems, and the
> solutions we engineered on Content OS 2.0 — a browser-based Instagram creator-research
> SaaS (React + TypeScript + Vite, Clerk auth, Supabase/Postgres, Gemini, Apify scraping,
> Vercel serverless). Each entry is framed as **Problem → Solution → Why it matters** so it
> can be picked up and discussed in a technical interview.
>
> _Last updated: 2026-06-24_

---

## 1. Security & Architecture

### 1.1 Moving API keys server-side (no secrets in the browser)
- **Problem:** Gemini and Apify keys were originally usable from the client. Anything shipped to the browser is extractable from the JS bundle — so the keys were effectively public, and any user could drain credits or abuse the APIs.
- **Solution:** Introduced a thin **serverless proxy layer** (Vercel functions under `api/`). Every external call now routes through a function that (a) verifies a **Clerk JWT** before doing anything, (b) reads keys from `process.env` only (never `VITE_`-prefixed, so they never reach the bundle), and (c) enforces **model/actor allowlists** so the proxy can't be turned into an open relay.
- **Why it matters:** Textbook *principle of least privilege* + *secure-by-default*. The browser only ever holds three public values (Clerk publishable key, Supabase URL, Supabase anon key); everything sensitive is gated behind authentication on the server.

### 1.2 Resilient API-key pooling — rotation, failover, and cooldown
- **Problem:** A single Apify/Gemini key hits hard limits fast: **429** (rate-limited) under concurrent team use, or **402 / 403 "usage hard limit"** when a free-tier account's monthly credit runs out. Any of these would fail the entire scrape/rank pipeline.
- **Solution:** A **pool of keys** with per-request shuffling and **reactive failover** — on a retryable status (`429`, `402`, or a `403` whose body matches a usage-limit regex), the request rolls to the next key instead of failing. Exhausted keys get a **15-minute cooldown** so they're skipped, and a subtle concurrency bug was fixed along the way: the original picker keyed off `Date.now()/1000 % n`, which handed *every* parallel pick within the same wall-clock second the **same** key — defeating the pool under `pLimit(3)`. Replaced with a persisted incrementing round-robin index.
- **Why it matters:** Turns a brittle single-point-of-failure into a self-healing system, and the `Date.now()` bug is a great example of a concurrency pitfall that only shows up under parallelism.

### 1.3 Row-Level Security as the *real* authorization boundary
- **Problem:** UI-level checks ("hide the button if not allowed") are cosmetic — they're trivially bypassed by hitting the API directly.
- **Solution:** Authorization is enforced in **Postgres via RLS policies**, not just the UI. Team-shared tables (the creator corpus) are readable by any authenticated user; private tables (`user_state`) are scoped to the owner via `auth.jwt()->>'sub'`; and finance data is gated by a Postgres `is_finance()` function used directly inside the RLS policy (`using (is_finance()) with check (is_finance())`).
- **Why it matters:** Defense in depth — even if the client is compromised or someone crafts a raw request, the database itself refuses unauthorized reads/writes.

### 1.4 Role-gated payments — and making self-elevation *impossible*
- **Problem:** Payment data must be visible only to a "finance" role. The naive version stores a role flag the client can write — which means a user could grant themselves access.
- **Solution:** Roles live in a `member_roles` table, but the table is **locked from the application**: `revoke insert, update, delete ... from authenticated`. Clients can *read* roles (to render the UI) but can **never write** them — grants happen only through a privileged path. The UI gate (`useIsFinance`) is purely for UX; the RLS policy on the payments table is the real lock.
- **Why it matters:** Demonstrates separating "what the UI shows" from "what the system enforces," and designing so that the most dangerous operation (privilege escalation) is structurally impossible from the client.

### 1.5 Self-serve access management that survives a team handoff
- **Problem:** After the engineering team leaves, a non-technical admin still needs to grant/revoke finance access — but the role table is deliberately *locked from the app* (so nobody can self-elevate), and granting requires mapping an **email → Clerk user ID**, which is only possible with a server-side secret key. So the very design that makes the system secure also makes it un-administrable by a non-engineer.
- **Solution:** A "Team Access" panel reachable from the account menu (admin-only), built on a layered authorization model that keeps the lock *and* enables self-service:
  - **`SECURITY DEFINER` Postgres functions** (`admin_grant_finance`, `admin_revoke_finance`) run with the table owner's privilege so they *can* write the locked `member_roles` table — but each **self-checks `is_admin()` as its first statement**, so only admins can mutate roles. The grant function **hardcodes `role = 'finance'`**, so this path can *never* mint another admin (admins stay seeded by SQL only). Every function **pins `search_path`** to close the classic `SECURITY DEFINER` hijack vector.
  - The **email→Clerk-ID lookup is a server endpoint** (it needs the secret key) that is **admin-gated *before* the lookup** — done by forwarding the caller's session token to the same `is_admin()` check — so it can't be abused as a user-enumeration oracle. It also handles the 0 / 1 / many email-match cases explicitly instead of silently picking one.
  - **No new master secret** was introduced: the same Clerk session token already drives both our JWT gate and Supabase RLS, so the server reuses it; the DB functions provide the privilege escalation instead of a Supabase service-role key.
- **The break-glass ("cheat code"):** a hidden key sequence (Konami) opens a recovery popup; the code typed in is verified **server/DB-side against a bcrypt hash held in a no-policy RLS-locked config table** (unreadable via the API), is **throttled** after repeated wrong guesses, and is **rotatable** with one SQL line. Deliberately *not* a password baked into the client bundle (which would be trivially extractable). It grants a **time-limited (3-minute) admin** to the **currently-signed-in** user (so the action has an identity + is logged) — temporary *by design*, so a leaked code can't become a permanent backdoor. This is modeled with an `expires_at` column that `is_admin()` checks (`expires_at is null or expires_at > now()`); seeded admins are permanent (`null`), and the grant is written with an upsert that **never downgrades an existing permanent admin** to the 3-minute window. The temporary nature is enforced where it counts — in the DB-level `is_admin()` used by every privileged function — not just in the UI.
- **Why it matters:** Resolves a real tension — "locked-down enough that no one can self-elevate" vs. "operable by a non-engineer after handoff" — without weakening either side. Strong talking points on **where privilege and secrets can safely live** (DB-enforced authorization vs. client checks), avoiding an **enumeration oracle**, and designing a **secure break-glass** over a convenient-but-leaky one.

---

## 2. AI / LLM Pipeline Engineering

### 2.1 Two orthogonal discovery signals (audience-adjacency vs. content-niche)
- **Problem:** Instagram's `relatedProfiles` is an **audience-adjacency** signal ("people who watch this also watch…") — it pulls in creators who share an audience but not necessarily the *niche*, contaminating the candidate pool the AI ranks.
- **Solution:** Combine `relatedProfiles` (audience-adjacency, scraped over multiple rounds) with a **content-niche signal**: take the reference accounts' *own* top hashtags, scrape recent posts under those hashtags, and pull the authors. Each candidate is **tagged with its discovery source**, and the merge order is deliberately content-niche-first so the LLM's top-down context bias reinforces the higher-confidence candidates.
- **Why it matters:** A clean example of using **two independent signals to cancel out each other's weaknesses**, plus prompt-ordering as a cheap lever on LLM behavior.

### 2.2 Grounding the LLM — hallucination filter + dead-account gate
- **Problem:** (a) LLMs occasionally "return" plausible-looking accounts that were never in the scraped set. (b) Stuffing the model with inactive/empty accounts wastes context tokens and degrades ranking.
- **Solution:** A **hallucination filter** intersects the model's output against the known scraped handles (normalizing a stray leading `@` so real results aren't dropped on a formatting quirk) — anything fabricated is discarded. A **dead-account gate** drops accounts with 0 posts or a last post >180 days old *before* they ever reach the model.
- **Why it matters:** "Never surface a fact the system can't back with data" is a core trust principle for AI products — and trimming the input is a concrete, measurable way to improve both cost and output quality.

### 2.3 Reliably reaching N results — accumulate-across-re-runs cache
- **Problem:** A single scrape rarely yields a full, clean set of N relevant competitors (sparse niches, dismissed accounts, filtering). Re-running from scratch wastes scraping credits and risks showing duplicates.
- **Solution:** A **per-conversation cache** (IndexedDB) that accumulates relevant results across "Start over" re-runs toward a target (e.g., 5 established + 5 growing). Each run **excludes already-shown accounts, targets only the per-category gap, caps the model's output per category, and merges carried-over results with new ones into a single re-ranked set** — so progress compounds and nothing repeats. Degrades to a no-op when IndexedDB is unavailable.
- **Why it matters:** Reframes "get 10 results" from a one-shot problem into an **idempotent, incremental accumulation** — and the cache-keying + dedup logic is exactly the kind of state-management nuance interviewers probe.

### 2.4 Context-window-safe synthesis (digest + token-budgeted map-reduce)
- **Problem:** Synthesizing patterns across many long reel transcripts can blow past the model's context window.
- **Solution:** A pure **reel-digest** step compresses each reel, and a **token-budgeted chunk planner** groups digests into batches that fit the budget, then a **map-reduce** synthesis (summarize chunks → combine) produces the final analysis. Includes a regression test for the oversized-single-item edge case.
- **Why it matters:** Demonstrates handling the hard ceiling of LLM context with a classic distributed-computing pattern (map-reduce) adapted to token budgets.

### 2.5 Human-in-the-loop: two-phase mutation with a mid-run clarification pause
- **Problem:** The system often can't tell which sub-niche the user actually wants until *after* it has seen the candidate pool — but you don't want to throw away the expensive scrape to ask.
- **Solution:** Split the pipeline into **two mutations**: phase 1 scrapes + generates a clarification question and **pauses** in a `clarifying` state; phase 2 fires when the user answers, injecting their choice into the ranking prompt. A Zustand store **bridges state across the pause** (holding the in-flight discovery data), with guards so a conversation switch mid-pause can't strand a permanent spinner.
- **Why it matters:** Shows designing an **async, resumable, human-in-the-loop** flow and the careful state-machine reasoning needed to make pausing/resuming safe.

### 2.6 Latest-wins steering in the conversational agent loop
- **Problem:** In a chat-driven agent, a user often sends a new instruction while a previous long-running operation (a 2-minute scrape) is still going. The stale result must not clobber the new intent.
- **Solution:** An `AbortController`-based **supersession** mechanism: each run links an internal timeout with an external signal, and on completion checks `wasSuperseded()` — if a newer turn started, the old run **silently no-ops** instead of writing stale results.
- **Why it matters:** "Latest-wins" concurrency control is a real-world UX correctness problem (race conditions between user intent and async work), handled cleanly here.

---

## 3. Data Modeling & State

### 3.1 Correct domain boundaries — a "paying client" is not a "tracked account"
- **Problem:** Payments initially referenced the analytics Dashboard's `tracked_accounts` (Instagram handles). But a **paying company is a different entity** from a tracked Instagram account — you can bill a client you don't track, and track an account you don't bill. Conflating them is a domain-modeling error that leaks across features.
- **Solution:** Gave Payments its **own standalone `payment_clients` table** (company name + billing details, finance-only RLS) and repointed the payments foreign key from `account_username` → `payment_client_id`. The main Calendar (which legitimately *does* schedule posts for tracked accounts) was left untouched.
- **Why it matters:** Recognizing when two things that *look* similar are actually distinct domain entities — and drawing the boundary deliberately — is exactly the modeling judgment that keeps systems from rotting.

### 3.2 Multi-currency correctness — consolidated totals with live FX + graceful fallback
- **Problem:** Summary totals naively added raw amounts across currencies — `400,000 INR + 16,000 AED` was being shown as `416,000`, which is meaningless (you can't add different units).
- **Solution:** Per-payment rows keep their **original currency**; only the top summary **converts each payment to INR** before summing. Rates come from a **free, no-key FX service**, cached ~12h via the data layer, with a **built-in fallback rate table** so the total never breaks if the service is unreachable (the UI even labels whether it used live vs. approximate rates). Conversion is explicitly *current-rate, at-a-glance* — a documented, deliberate simplification vs. accounting-grade per-date rates.
- **Why it matters:** Unit-correctness, **graceful degradation** (never let a third-party outage break a core number), and being explicit about the precision/complexity tradeoff are all strong signals of careful engineering.

### 3.3 Versioned persisted stores (no silent data loss)
- **Problem:** Persisted client state (chat history, analysis results) is serialized to storage. Changing a store's shape can silently corrupt or drop a returning user's data on rehydrate.
- **Solution:** **Every persisted store carries a `version` and a `migrate(state, version)`** function; persisted result `kind` discriminants are treated as **frozen contracts**. Shape changes bump the version and handle the old shape explicitly.
- **Why it matters:** Schema evolution for client-persisted state is an under-appreciated source of production bugs; versioned migrations are the disciplined fix.

### 3.4 Component reuse — generalizing a domain-specific picker
- **Problem:** A searchable account dropdown built for the Calendar was needed in Payments too — but Payments selects *clients* (uuid + name), not *accounts* (username + handle).
- **Solution:** Generalized the component from an account-specific `AccountPicker` to an **items-based `SearchablePicker`** (`{ value, label }[]`), so each caller maps its own domain rows to generic items. One combobox, two domains, identical behavior preserved for the existing Calendar.
- **Why it matters:** Knowing *when* to generalize (the second use case) rather than prematurely abstracting — and doing it without regressing the original — is practical DRY judgment.

---

## 4. Tooling, Ops & Engineering Discipline

### 4.1 Migrations-as-code (reproducible schema)
- **Problem:** Database changes applied ad-hoc in a dashboard are invisible, unordered, and impossible for a teammate to reproduce on a fresh database.
- **Solution:** Every schema change is written as a **timestamped SQL migration file** committed to the repo — even though they're applied manually — so the database structure has a single source of truth and a clear, ordered history alongside the code that depends on it.
- **Why it matters:** Treating schema as versioned code (not clicks in a UI) is the difference between a reproducible system and tribal knowledge.

### 4.2 Secrets-exposure incident response (blast-radius-first)
- **Problem:** A live set of credentials (DB service-role key, auth secret, dozens of scraper tokens) was accidentally exposed.
- **Solution:** Worked the incident methodically — **verified the secrets were never committed to git** (only a placeholder `.env.example` is tracked; real env files are gitignored), inspected env files with **values masked** so nothing leaked further, and produced a **rotation plan ordered by blast radius** (the RLS-bypassing `service_role` key first, then the auth secret, then spend-capable API tokens). Also noted the non-obvious fact that rotating a token doesn't reset its account's usage.
- **Why it matters:** Calm, prioritized incident response — and reasoning about blast radius — is exactly what you want to demonstrate around security.

### 4.3 Diagnosing a tooling incompatibility (local dev on a new bundler)
- **Problem:** The standard local emulator for the serverless functions broke on the project's bundler version, blocking local development.
- **Solution:** Diagnosed it as a bundler-version incompatibility, fell back to the plain dev server, and **clearly characterized the limitation** — the `api/` functions don't run under the plain server, so anything depending on them (the key-gated proxies) must be tested on a preview deploy instead of locally.
- **Why it matters:** Knowing the *boundaries* of your local environment — and not chasing ghosts when something "works in prod but not locally" — saves enormous time.

### 4.4 An adversarial design review that caught a handoff landmine
- **Problem:** Before building the access-management feature, we ran a deliberate engineering/security review of the design.
- **Solution:** The review surfaced a **latent landmine**: roles are keyed to Clerk user IDs, and migrating the auth provider from its development to production instance would **change every user ID**, silently orphaning all role grants (and locking everyone out of payments) — precisely the kind of failure that would strike *after* the team left. That reframed an implementation detail into a sequencing decision (settle the auth instance *before* seeding roles), plus pinning `search_path` on `SECURITY DEFINER` functions and gating the lookup endpoint to avoid an enumeration oracle.
- **Why it matters:** Reviewing for **failure modes that only appear later** (especially around a handoff) — and treating security-sensitive code to its own scrutiny — is senior-level instinct.

### 4.5 When a security hardening hid the very function it needed
- **Problem:** The break-glass recovery silently failed — the API returned a `404`, the UI showed "incorrect code." But the recovery code *was* correct (a direct SQL check confirmed the hash matched). The real error, surfaced from the response body, was `42883: function crypt(text, text) does not exist`.
- **Root cause:** `SECURITY DEFINER` functions should pin `search_path` (a hardening we'd deliberately added, `pg_catalog, public`). But Supabase installs extension functions — including `pgcrypto`'s `crypt()` — into a separate **`extensions` schema**, not `public`. So the very hardening that made the function safe also made `crypt()` unresolvable *inside* it. It worked in the SQL editor only because that session's `search_path` happens to include `extensions`.
- **Solution:** Add `extensions` to the function's `search_path` (`pg_catalog, public, extensions`) — keeping the hardening while granting the one extra schema the function legitimately needs. A misleading HTTP `404` (PostgREST maps the undefined-function error code to 404) was the red herring that initially pointed at a schema-cache problem; reading the actual response `message`/`code` is what pinpointed it.
- **Why it matters:** A clean example of a **security measure with a sharp edge**, and of **debugging by the actual error code, not the HTTP status** — the difference between chasing a phantom cache issue and fixing the one-word root cause.

### 4.6 Integrating onto a moving `main` alongside teammates
- **Problem:** The Team Access feature was built on a branch while a teammate concurrently shipped two mobile-layout PRs — and **both touched the same file**: they reworked `AppLayout.tsx`'s nav for responsiveness, while we added the admin-only "Team Access" item to the account menu in that same component.
- **Solution:** Synced the feature branch onto the updated `main` *before* merging, then **verified the integration rather than trusting the green checkmark** — inspected the merged `AppLayout.tsx` for leftover conflict markers and confirmed *both* changes survived (the responsive nav classes *and* the Team Access menu item), with the full suite (697 tests) green on the combined tree. Schema migrations were applied in timestamped order so the DB matched the merged code.
- **Why it matters:** "It auto-merged with no conflicts and the build passed" is **not** the same as "both features still work" — when two changes live in the same region of a file, a clean merge can still drop or scramble intent. Explicitly checking the combined result is the discipline that stops a feature from quietly vanishing during integration.

---

_This is a living document — new decisions get appended as the project evolves._
