// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
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
