/**
 * supabaseStorage is an async PersistStorage<T> over user_state.value (jsonb).
 * getItem returns the { state, version } envelope object (or null); setItem upserts
 * it; removeItem deletes by key. user_id is server-defaulted from the JWT, so the
 * client only sends { key, value }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeSupabaseMock } from '../test/supabaseClientMock'

let mock: ReturnType<typeof makeSupabaseMock>
vi.mock('../lib/supabaseClient', () => ({ supabase: new Proxy({}, { get: (_t, p) => (mock.client as Record<string | symbol, unknown>)[p] }) }))

import { supabaseStorage } from './supabaseStorage'

beforeEach(() => { mock = makeSupabaseMock({}) })

describe('supabaseStorage', () => {
  it('getItem returns the stored envelope object for the key, or null', async () => {
    mock = makeSupabaseMock({ maybeSingle: [{ value: { state: { a: 1 }, version: 0 } }] })
    const got = await supabaseStorage.getItem('contentos-conversations')
    expect(mock.calls.from).toContain('user_state')
    expect(mock.calls.eq).toContainEqual(['key', 'contentos-conversations'])
    expect(got).toEqual({ state: { a: 1 }, version: 0 })
  })

  it('getItem returns null when there is no row', async () => {
    mock = makeSupabaseMock({ maybeSingle: [null] })
    expect(await supabaseStorage.getItem('missing')).toBeNull()
  })

  it('setItem upserts { key, value } (no user_id — server-defaulted)', async () => {
    await supabaseStorage.setItem('contentos-reels', { state: { x: 2 }, version: 0 })
    expect(mock.calls.upsert[0]).toEqual({ key: 'contentos-reels', value: { state: { x: 2 }, version: 0 } })
  })

  it('removeItem deletes by key', async () => {
    await supabaseStorage.removeItem('contentos-reels')
    expect(mock.calls.delete.length).toBe(1)
    expect(mock.calls.eq).toContainEqual(['key', 'contentos-reels'])
  })
})
