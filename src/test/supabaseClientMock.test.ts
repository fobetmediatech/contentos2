import { describe, it, expect } from 'vitest'
import { makeSupabaseMock } from './supabaseClientMock'

describe('makeSupabaseMock', () => {
  it('returns queued select results and records the table + filters used', async () => {
    const mock = makeSupabaseMock({
      select: [[{ username: 'a' }]],          // one queued result for a select chain
    })
    const res = await mock.client.from('corpus_creators').select('*').in('username', ['a'])
    expect(res.data).toEqual([{ username: 'a' }])
    expect(mock.calls.from).toContain('corpus_creators')
    expect(mock.calls.in).toContainEqual(['username', ['a']])
  })

  it('records upsert payloads', async () => {
    const mock = makeSupabaseMock({})
    await mock.client.from('user_state').upsert({ key: 'k', value: { state: 1 } })
    expect(mock.calls.upsert[0]).toEqual({ key: 'k', value: { state: 1 } })
  })
})
