/**
 * supabaseCorpus maps the CorpusRepository contract onto the corpus tables/view.
 * Tested against the chainable Supabase mock (no live DB). Asserts the right
 * tables/filters are used and rows map back to camelCase CreatorRecords.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeSupabaseMock } from '../test/supabaseClientMock'

// Each test installs its own mock before importing the module under test.
let mock: ReturnType<typeof makeSupabaseMock>
vi.mock('./supabaseClient', () => ({ supabase: new Proxy({}, { get: (_t, p) => (mock.client as Record<string | symbol, unknown>)[p] }) }))

import { createSupabaseCorpus } from './supabaseCorpus'

beforeEach(() => { mock = makeSupabaseMock({}) })

const creatorRow = (over: Record<string, unknown> = {}) => ({
  username: 'foodie', full_name: 'Foodie', profile_pic_url: 'p', verified: true,
  is_business_account: false, followers_count: 1000, follows_count: 10, posts_count: 50,
  avg_likes: 100, avg_comments: 5, engagement_rate: 0.1, top_hashtags: ['#food'],
  last_post_date: null, feedback: null, feedback_at: null,
  times_seen: 3, first_seen_at: '2026-06-01T00:00:00Z', last_seen_at: '2026-06-03T00:00:00Z',
  ...over,
})

describe('supabaseCorpus construction', () => {
  it('does no I/O at construction', () => {
    createSupabaseCorpus()
    expect(mock.calls.from).toHaveLength(0) // nothing queried until a method runs
  })
})

describe('getMany', () => {
  it('uses a single .in() query on the view and maps rows to CreatorRecords', async () => {
    mock = makeSupabaseMock({ select: [[creatorRow()], []] }) // creators, then sightings
    const corpus = createSupabaseCorpus()
    const recs = await corpus.getMany(['foodie'])
    expect(mock.calls.from).toContain('corpus_creators_view')
    expect(mock.calls.in).toContainEqual(['username', ['foodie']])
    expect(recs[0].username).toBe('foodie')
    expect(recs[0].timesSeen).toBe(3)
    expect(recs[0].followersCount).toBe(1000)
    expect(typeof recs[0].firstSeenAt).toBe('number') // timestamptz → ms
  })
})

describe('setFeedback', () => {
  it('returns undefined when no creator row is updated', async () => {
    // The impl reads `data` from the trailing .select(), so the "no rows" result is
    // queued under `select` (not `update`): .update().eq().select() resolves [].
    mock = makeSupabaseMock({ select: [[]] })
    const corpus = createSupabaseCorpus()
    const out = await corpus.setFeedback('ghost', 'saved', 123)
    expect(mock.calls.update[0]).toMatchObject({ feedback: 'saved' })
    expect(out).toBeUndefined()
  })
})

describe('clear', () => {
  it('throws (destructive on shared data)', async () => {
    const corpus = createSupabaseCorpus()
    await expect(corpus.clear()).rejects.toThrow()
  })
})
