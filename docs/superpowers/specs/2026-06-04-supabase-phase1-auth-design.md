# Supabase Integration — Phase 1: Auth + Gated App

**Status:** Draft for review
**Date:** 2026-06-04
**Part of:** a 3-phase Supabase integration, build order **C → A → B**:
- **Phase 1 (this doc) — Auth (C):** gate the app behind login.
- **Phase 2 — Key proxy (A):** Supabase Edge Functions hold the shared API keys and proxy Apify + Gemini; keys leave the client bundle.
- **Phase 3 — Cloud data (B):** corpus + conversations + reports move to Postgres with per-user Row-Level Security.

## Goal

Gate Content OS behind a login so only operator-provisioned teammates (an invited agency team, ~dozens) can use it. Establish the Supabase Auth foundation that Phases 2 and 3 build on (Edge Functions validate the same JWT; Postgres RLS keys off `auth.uid()`).

## Non-goals (explicitly deferred)

- **No Postgres tables / RLS** — that's Phase 3. Phase 1 stores nothing app-specific in Supabase.
- **No key proxy / Edge Functions** — Phase 2. API keys stay in the env/bundle for now.
- **No in-app admin or invite UI** — teammates are provisioned from the Supabase dashboard.
- **No social login, no public sign-up, no password reset flows** — magic link only, invite-only.

## Decisions

- **Provider: Supabase Auth** (not Clerk) — native RLS + Edge Function JWT fit for Phases 2/3, one vendor, trivial login UI for a flat team.
- **Method: magic link (OTP email)** — passwordless; nothing to manage for a dozen people.
- **Provisioning: invite-only** — public sign-up disabled; operator adds teammates in the Supabase dashboard. A non-provisioned email cannot get in.

## Email delivery (DECIDED): magic link + custom SMTP (Resend)

Magic link depends on email delivery, and Supabase's built-in email is heavily rate-limited (free tier ~a few per hour) — unreliable when several teammates log in around the same time.

**Decision: configure custom SMTP via Resend** (free tier, ~15 min one-time setup) for reliable delivery. Plan work: wire Resend SMTP into Supabase Auth's email settings. Development may run against the built-in email, but custom SMTP must be in place before team rollout. (Email + password was the considered alternative; not chosen.)

## Architecture / Components

- **`src/lib/supabaseClient.ts`** — singleton `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` with `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`. Uses Supabase JS v2's default **PKCE** flow: the magic link returns with `?code=…`, which the client exchanges for a session on load (before routing runs). New dependency: `@supabase/supabase-js`.
- **`src/store/authStore.ts`** (Zustand) — `{ session, user, status: 'loading'|'signed-out'|'signed-in' }` plus actions `init()` (reads existing session + subscribes to `onAuthStateChange`), `signInWithEmail(email)`, `signOut()`. Single source of truth for auth state. `init()` is called **once** at the app's top level and is idempotent (subscribe once, unsubscribe on teardown) so React StrictMode's dev double-invoke can't register duplicate listeners. Built via a testable factory (mirrors `corpusStore`'s `makeXStore(deps)` pattern) so tests inject a fake supabase client.
- **`src/pages/LoginPage.tsx`** — DESIGN.md-compliant (chai `#1A1410`, saffron `#E07B3A`, Instrument Serif display / Outfit body / DM Mono): one email field → "Send magic link" → "check your email" confirmation. Surfaces friendly errors.
- **Auth guard in `src/App.tsx`** — while `status === 'loading'`, render a splash; if `'signed-out'`, render `<LoginPage>`; if `'signed-in'`, render the existing routed app. The magic-link return URL is handled by the Supabase client (detects the token on load → fires `onAuthStateChange`).
- **Sign-out control in `src/components/AppLayout.tsx`** — a small signed-in-as / sign-out affordance in the top nav.

## Data flow

1. App boots → `authStore.init()` → supabase client restores any persisted session → `status`.
2. `signed-out` → `LoginPage`. Email entered → `signInWithEmail` → `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })` → Supabase sends the magic link. **`emailRedirectTo: window.location.origin`** makes the link return to whichever origin requested it (prevents the classic localhost-vs-prod link bounce); that origin must also be listed in the dashboard's allowed Redirect URLs.
3. User clicks the link → returns to the app URL → client exchanges the token → `onAuthStateChange('SIGNED_IN')` → `status: 'signed-in'` → app renders.
4. Sign out → `supabase.auth.signOut()` → `onAuthStateChange('SIGNED_OUT')` → back to `LoginPage`.

## Operator setup (dashboard, one-time)

- Auth → Email/OTP provider on; **disable public sign-ups** (invite-only).
- Set **Site URL + Redirect URLs** to the deployed URL **and** `http://localhost:5173` so magic links return correctly in both.
- (Recommended) configure **custom SMTP**.
- Invite teammates by email.

## Config / env

- `.env` + Vercel env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable/anon — public, safe in the bundle).
- No secret keys client-side in Phase 1 (service_role/secret arrive in Phase 2, server-side only).

## Error handling

- Expired/invalid magic link → "That link expired — request a new one."
- Email send failure / rate limit → "Couldn't send the link, try again shortly." (the SMTP note applies.)
- Non-provisioned email → no account created (sign-up off) → "No account for this email — ask your admin for access."
- Supabase/network down → graceful login-screen error; the app stays gated, never half-open.
- Magic link opened in a *different* browser than it was requested from fails (PKCE ties the code verifier to the requesting browser's storage) → "Open the link in the same browser you requested it from." Cross-browser flow is out of scope for Phase 1.
- Never log tokens or the session to the console.

## Testing

- **Unit (`authStore.test.ts`):** status transitions on `SIGNED_IN`/`SIGNED_OUT`; `loading → signed-out` when no session; `signOut()` calls `supabase.auth.signOut()` and transitions to `signed-out`; using a fake supabase client injected via the store factory (no network).
- **Component (RTL):** `LoginPage` renders + submit calls `signInWithOtp` + shows the confirmation state; the auth guard renders `LoginPage` when signed-out and the app when signed-in (mocked session).
- **Manual:** provision a test user; full magic-link login on the preview/deployed URL; sign-out returns to login.

## Security notes

- Anon key is public by design; RLS protects data — but no app data lives in Supabase until Phase 3, so Phase 1 exposes nothing sensitive.
- **Keep Vercel Deployment Protection ON.** Phase 1 auth does NOT remove the API keys from the client bundle (the bundle loads before login) — only Phase 2 does. Deployment Protection stays until Phase 2 lands.
- Session persisted in localStorage (Supabase default) — standard for a trusted-team tool.

## What Phase 1 sets up for later

- A working Supabase client + authenticated session/JWT → Phase 2 Edge Functions validate that JWT to gate the proxy.
- `auth.uid()` available → Phase 3 RLS policies key off it.
- Otherwise the app behaves exactly as today (env keys, local data) until those phases land.
