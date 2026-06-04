# Supabase Phase 1 (Auth) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate Content OS behind Supabase Auth (passwordless magic link), invite-only, so only operator-provisioned teammates can use the app.

**Architecture:** A `supabaseClient` singleton (PKCE flow) + a testable `authStore` (Zustand factory mirroring `corpusStore`'s `makeCorpusStore(repo)`) + a DESIGN.md-compliant `LoginPage` + an `AuthGate` wrapper that branches on auth status + a sign-out control in `AppLayout`. No data or API-key changes — those are Phases 2–3.

**Tech Stack:** React 19, TypeScript, Zustand, `@supabase/supabase-js` (new), Vite, vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-04-supabase-phase1-auth-design.md`

---

## Prerequisites (operator setup — before Task 1)

Not code; one-time setup. The operator does these (the implementer can do the dashboard parts via the Supabase connector once it's hooked up). Build/dev can run against the built-in email; **custom SMTP must be live before team rollout.**

- [ ] **Env** — add to `.env` and the Vercel project env: `VITE_SUPABASE_URL=https://uyygfdlvpqxclbspiiyy.supabase.co` and `VITE_SUPABASE_ANON_KEY=<new publishable/anon key>` (public; safe in the bundle).
- [ ] **Dashboard → Auth** — enable the Email (OTP/magic-link) provider; **disable public sign-ups**; set **Site URL + Redirect URLs** to the deployed URL AND `http://localhost:5173`.
- [ ] **Dashboard → SMTP** — configure custom SMTP via Resend (free tier) for reliable magic-link delivery.
- [ ] **Invite teammates** by email (Auth → Users → Invite).
- [ ] **Connector/CLI** — hook up the Supabase connector (or link the CLI) so the implementer can verify auth config.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/supabaseClient.ts` (create) | Singleton Supabase client (config; PKCE + persist + detect-session-in-URL) |
| `src/store/authStore.ts` (create) | `makeAuthStore(client)` factory + `useAuthStore`; `{session,user,status}` + `init/signInWithEmail/signOut` |
| `src/store/authStore.test.ts` (create) | Unit tests with an injected fake client |
| `src/pages/LoginPage.tsx` (create) | Magic-link login screen (email → send → confirmation), DESIGN.md tokens |
| `src/pages/LoginPage.test.tsx` (create) | RTL component tests |
| `src/components/AuthGate.tsx` (create) | Branches on status: loading splash / `LoginPage` / children |
| `src/components/AuthGate.test.tsx` (create) | RTL component tests |
| `src/App.tsx` (modify) | Wrap routes in `<AuthGate>`; call `init()` once on mount |
| `src/components/AppLayout.tsx` (modify) | Sign-out control + signed-in email in the nav |
| `.env.example` (modify) | Document the two `VITE_SUPABASE_*` vars |

DESIGN.md tokens for `LoginPage`: chai bg `#1A1410`, saffron accent `#E07B3A`/`#F4A97B`, Instrument Serif (display/italic), Outfit (body), warm neutrals — match the existing `ChatPage`/`AppLayout` classes. Read DESIGN.md before styling.

---

## Chunk 1: Auth foundation

### Task 1: Add dependency + Supabase client

**Files:** Create `src/lib/supabaseClient.ts`

- [ ] **Step 1: Install the SDK**

Run: `npm install @supabase/supabase-js`
Expected: added to `package.json` dependencies, no errors.

- [ ] **Step 2: Create the client singleton**

`src/lib/supabaseClient.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

// Public, build-time creds (safe in the bundle). PKCE flow: the magic link returns with
// ?code=…, which detectSessionInUrl exchanges for a session on load, before routing.
const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
```

(No unit test — config/singleton. It's exercised via the `authStore` tests, which inject a fake client, never this one.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/lib/supabaseClient.ts
git commit -m "feat(auth): add supabase-js + client singleton (PKCE)"
```

### Task 2: authStore (TDD)

**Files:** Create `src/store/authStore.ts`, `src/store/authStore.test.ts`

The store mirrors `makeCorpusStore(repo)`: a `makeAuthStore(client)` factory so tests inject a fake, plus a default `useAuthStore` bound to the real `supabase`. The fake client implements only the four `auth` methods used.

- [ ] **Step 1: Write the failing tests**

`src/store/authStore.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { makeAuthStore } from './authStore'

// Minimal fake of the supabase auth surface the store uses.
function makeFakeClient(initialSession: unknown = null) {
  let cb: ((event: string, session: unknown) => void) | null = null
  return {
    _emit: (event: string, session: unknown) => cb?.(event, session),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: initialSession } })),
      onAuthStateChange: vi.fn((fn: (e: string, s: unknown) => void) => {
        cb = fn
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  }
}

describe('authStore', () => {
  it('starts in loading', () => {
    const store = makeAuthStore(makeFakeClient() as never)
    expect(store.getState().status).toBe('loading')
  })

  it('init() with no session → signed-out', async () => {
    const store = makeAuthStore(makeFakeClient(null) as never)
    await store.getState().init()
    expect(store.getState().status).toBe('signed-out')
  })

  it('init() with an existing session → signed-in + user set', async () => {
    const session = { user: { id: 'u1', email: 'a@b.co' } }
    const store = makeAuthStore(makeFakeClient(session) as never)
    await store.getState().init()
    expect(store.getState().status).toBe('signed-in')
    expect(store.getState().user?.email).toBe('a@b.co')
  })

  it('reacts to SIGNED_IN / SIGNED_OUT events', async () => {
    const client = makeFakeClient(null)
    const store = makeAuthStore(client as never)
    await store.getState().init()
    client._emit('SIGNED_IN', { user: { id: 'u1', email: 'a@b.co' } })
    expect(store.getState().status).toBe('signed-in')
    client._emit('SIGNED_OUT', null)
    expect(store.getState().status).toBe('signed-out')
  })

  it('signInWithEmail calls signInWithOtp with emailRedirectTo = origin', async () => {
    const client = makeFakeClient(null)
    const store = makeAuthStore(client as never)
    await store.getState().signInWithEmail('a@b.co')
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.co',
      options: { emailRedirectTo: window.location.origin },
    })
  })

  it('signOut calls client.auth.signOut and transitions to signed-out', async () => {
    const client = makeFakeClient({ user: { id: 'u1', email: 'a@b.co' } })
    const store = makeAuthStore(client as never)
    await store.getState().init()
    await store.getState().signOut()
    expect(client.auth.signOut).toHaveBeenCalled()
    // SIGNED_OUT is normally event-driven; signOut also sets status defensively.
    expect(store.getState().status).toBe('signed-out')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/store/authStore.test.ts`
Expected: FAIL — `makeAuthStore` not exported.

- [ ] **Step 3: Implement `authStore.ts`**

`src/store/authStore.ts`:
```ts
import { create } from 'zustand'
import type { Session, User, SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

export interface AuthState {
  session: Session | null
  user: User | null
  status: AuthStatus
  init: () => Promise<void>
  signInWithEmail: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export function makeAuthStore(client: SupabaseClient) {
  let initialized = false
  return create<AuthState>((set) => ({
    session: null,
    user: null,
    status: 'loading',
    init: async () => {
      if (initialized) return // idempotent — StrictMode double-invoke safe
      initialized = true
      client.auth.onAuthStateChange((_event, session) => {
        set({ session, user: session?.user ?? null, status: session ? 'signed-in' : 'signed-out' })
      })
      const { data } = await client.auth.getSession()
      set({
        session: data.session,
        user: data.session?.user ?? null,
        status: data.session ? 'signed-in' : 'signed-out',
      })
    },
    signInWithEmail: async (email) => {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      return { error: error ? 'Could not send the magic link — try again shortly.' : null }
    },
    signOut: async () => {
      await client.auth.signOut()
      set({ session: null, user: null, status: 'signed-out' })
    },
  }))
}

export const useAuthStore = makeAuthStore(supabase)
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/store/authStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/authStore.ts src/store/authStore.test.ts
git commit -m "feat(auth): authStore (factory, init/signInWithEmail/signOut) + tests"
```

### Task 3: LoginPage (TDD)

**Files:** Create `src/pages/LoginPage.tsx`, `src/pages/LoginPage.test.tsx`. Read DESIGN.md first; match `ChatPage`/`AppLayout` token classes.

- [ ] **Step 1: Write the failing tests**

`src/pages/LoginPage.test.tsx` (RTL + jsdom — match existing `*.test.tsx` setup):
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { LoginPage } from './LoginPage'
import { useAuthStore } from '../store/authStore'

// Project convention: environment is 'node' globally, so RTL files need the jsdom pragma
// above; RTL auto-cleanup is off, so cleanup() each test; jest-dom is NOT installed, so use
// .toBeTruthy()/.toBeNull() (matching MemoryPage.test.tsx etc.), NOT .toBeInTheDocument().
afterEach(cleanup)
beforeEach(() => {
  vi.spyOn(useAuthStore.getState(), 'signInWithEmail').mockResolvedValue({ error: null })
})

describe('LoginPage', () => {
  it('renders an email field + send button', () => {
    render(<LoginPage />)
    expect(screen.getByPlaceholderText(/email/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /magic link|sign in|send/i })).toBeTruthy()
  })

  it('submitting an email calls signInWithEmail and shows the confirmation', async () => {
    render(<LoginPage />)
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: /magic link|sign in|send/i }))
    await waitFor(() => expect(useAuthStore.getState().signInWithEmail).toHaveBeenCalledWith('a@b.co'))
    expect(await screen.findByText(/check your email/i)).toBeTruthy()
  })

  it('shows an error when sending fails', async () => {
    vi.spyOn(useAuthStore.getState(), 'signInWithEmail').mockResolvedValue({ error: 'Could not send the magic link — try again shortly.' })
    render(<LoginPage />)
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: /magic link|sign in|send/i }))
    expect(await screen.findByText(/could not send/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/pages/LoginPage.test.tsx` → FAIL (no `LoginPage`).

- [ ] **Step 3: Implement `LoginPage.tsx`** — a centered card on `bg-chai`: product wordmark (Instrument Serif italic), a `<form onSubmit>` containing one email input and a **`type="submit"`** saffron "Send magic link" button (so `fireEvent.click` triggers submission), a `sent` confirmation state ("Check your email for a sign-in link"), and an inline error line. In the submit handler, call the action **at event time** — `const { error } = await useAuthStore.getState().signInWithEmail(email)` — so the test's `vi.spyOn(useAuthStore.getState(), 'signInWithEmail')` actually intercepts it (do NOT capture the action at module load). Local `useState` for email / sending / sent / error. Use the same token classes as `ChatPage` inputs/buttons (`bg-[#1A1410]`, `border-[rgba(245,237,214,0.12)]`, `bg-[#E07B3A]`, etc.).

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/pages/LoginPage.test.tsx` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/LoginPage.tsx src/pages/LoginPage.test.tsx
git commit -m "feat(auth): magic-link LoginPage + tests"
```

### Task 4: AuthGate (TDD)

**Files:** Create `src/components/AuthGate.tsx`, `src/components/AuthGate.test.tsx`. AuthGate branches on `status`: `loading` → splash; `signed-out` → `<LoginPage>`; `signed-in` → `children`. Extracted from `App` so it's testable in isolation.

- [ ] **Step 1: Write the failing tests**

`src/components/AuthGate.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AuthGate } from './AuthGate'
import { useAuthStore } from '../store/authStore'

afterEach(cleanup) // RTL auto-cleanup is off in this project; the 'APP'-absent assertions depend on it
beforeEach(() => useAuthStore.setState({ status: 'loading', session: null, user: null }))

describe('AuthGate', () => {
  it('shows a loading splash while status is loading', () => {
    useAuthStore.setState({ status: 'loading' })
    render(<AuthGate><div>APP</div></AuthGate>)
    expect(screen.queryByText('APP')).toBeNull()
  })
  it('shows LoginPage when signed-out', () => {
    useAuthStore.setState({ status: 'signed-out' })
    render(<AuthGate><div>APP</div></AuthGate>)
    expect(screen.getByPlaceholderText(/email/i)).toBeTruthy()
    expect(screen.queryByText('APP')).toBeNull()
  })
  it('renders children when signed-in', () => {
    useAuthStore.setState({ status: 'signed-in', user: { id: 'u1', email: 'a@b.co' } as never })
    render(<AuthGate><div>APP</div></AuthGate>)
    expect(screen.getByText('APP')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/components/AuthGate.test.tsx` → FAIL.

- [ ] **Step 3: Implement `AuthGate.tsx`**

```tsx
import type { ReactNode } from 'react'
import { useAuthStore } from '../store/authStore'
import { LoginPage } from '../pages/LoginPage'

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  if (status === 'loading') {
    return <div className="h-[100dvh] flex items-center justify-center bg-chai text-muted">Loading…</div>
  }
  if (status === 'signed-out') return <LoginPage />
  return <>{children}</>
}
```

- [ ] **Step 4: Run to verify pass** — PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/AuthGate.tsx src/components/AuthGate.test.tsx
git commit -m "feat(auth): AuthGate status wrapper + tests"
```

### Task 5: Wire into App + sign-out in AppLayout

**Files:** Modify `src/App.tsx`, `src/components/AppLayout.tsx`

- [ ] **Step 1: Call `init()` once + wrap routes (App.tsx)**

In `App.tsx`: add imports `import { useEffect } from 'react'`, `import { useAuthStore } from './store/authStore'`, `import { AuthGate } from './components/AuthGate'` (App.tsx currently imports nothing from `react`). Then add a top-level mount effect that calls `useAuthStore.getState().init()` once, and wrap the `<BrowserRouter>…</BrowserRouter>` in `<AuthGate>`:
```tsx
useEffect(() => { void useAuthStore.getState().init() }, [])
// …
<QueryClientProvider client={queryClient}>
  <AuthGate>
    <BrowserRouter> … existing routes … </BrowserRouter>
  </AuthGate>
</QueryClientProvider>
```
(`init()` is idempotent, so StrictMode's dev double-invoke is harmless.)

- [ ] **Step 2: Add sign-out to AppLayout**

In the nav (`src/components/AppLayout.tsx`), after the Report link, add the signed-in email (muted) + a sign-out button calling `useAuthStore.getState().signOut()`. Use a `LogOut` lucide icon, warm token classes.

- [ ] **Step 3: Verify the app still builds + renders**

Run: `npx tsc -b` (expect clean) and `npm run build` (expect clean).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/AppLayout.tsx
git commit -m "feat(auth): gate app behind AuthGate + init; sign-out in nav"
```

### Task 6: Document env + full verification

**Files:** Modify `.env.example`

- [ ] **Step 1: Document the Supabase vars** in `.env.example` (under a `# ----- Supabase (Phase 1: Auth) -----` header): `VITE_SUPABASE_URL=https://...supabase.co` and `VITE_SUPABASE_ANON_KEY=...` with a note they're public/anon.

- [ ] **Step 2: Full verification**

Run: `npx tsc -b` → clean; `npx vitest run` → all pass (incl. the new ~12 auth tests); `npm run lint` → clean; `npm run build` → clean.

- [ ] **Step 3: Manual smoke (needs env + a provisioned test user)**

Run `npm run dev`; you should see the LoginPage; enter the test email; click the magic link from the inbox; land in the app; sign out → back to login. (Magic link must be opened in the same browser.)

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs: document Supabase env vars (Phase 1 auth)"
```

---

## Done when
- App is gated: unauthenticated users see `LoginPage`; only provisioned teammates get in.
- `tsc` + lint + build clean; all auth unit/component tests pass.
- Magic-link login + sign-out work end-to-end on a real (dev or deployed) URL with SMTP configured.
- No data/key behavior changed (env keys + local storage still in use; Deployment Protection stays on until Phase 2).
