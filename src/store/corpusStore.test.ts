/**
 * Tests for the corpus store — the React-facing view over the (async) corpus repository.
 * It hydrates once from storage, then mirrors writes into a synchronous map so components
 * can render "seen before" badges and a remembered-count without awaiting IndexedDB.
 *
 * makeCorpusStore(repo) takes any CorpusRepository, so we drive it with an in-memory one.
 */

import { describe, it, expect } from 'vitest'
import { makeCorpusStore } from './corpusStore'
import { createMemoryCorpus } from '../lib/corpus'
import type { CreatorInput } from '../lib/corpus'
import type { NormalizedProfile } from '../lib/transformers'

const input = (username: string, at: number): CreatorInput => ({
  profile: {
    username,
    fullName: `${username} Name`,
    biography: '',
    followersCount: 1000,
    followsCount: 100,
    postsCount: 50,
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    avgLikes: 100,
    avgComments: 10,
    engagementRate: 5,
    relatedHandles: [],
    topHashtags: [],
  } as NormalizedProfile,
  sighting: { at, pipeline: 'competitor', niche: 'food' },
})

describe('corpusStore', () => {
  it('hydrate loads existing creators from the repo into synchronous state', async () => {
    const repo = createMemoryCorpus()
    await repo.remember([input('alice', 100), input('bob', 100)])
    const store = makeCorpusStore(repo)
    expect(store.getState().hydrated).toBe(false)
    await store.getState().hydrate()
    expect(store.getState().count).toBe(2)
    expect(store.getState().creators.alice.username).toBe('alice')
    expect(store.getState().hydrated).toBe(true)
  })

  it('remember writes through to the repo and updates state', async () => {
    const repo = createMemoryCorpus()
    const store = makeCorpusStore(repo)
    await store.getState().remember([input('alice', 100)])
    expect(store.getState().count).toBe(1)
    expect(store.getState().creators.alice.timesSeen).toBe(1)
    expect(await repo.count()).toBe(1) // genuinely persisted, not just local state
  })

  it('remember reflects dedupe — timesSeen grows, count stays', async () => {
    const repo = createMemoryCorpus()
    const store = makeCorpusStore(repo)
    await store.getState().remember([input('alice', 100)])
    await store.getState().remember([input('alice', 200)])
    expect(store.getState().count).toBe(1)
    expect(store.getState().creators.alice.timesSeen).toBe(2)
  })

  it('rememberContent writes reel content through to the repo', async () => {
    const repo = createMemoryCorpus()
    const store = makeCorpusStore(repo)
    await store.getState().rememberContent([
      { id: 'r1', creatorUsername: 'alice', kind: 'reel', url: 'u', videoViewCount: 1, likesCount: 1, commentsCount: 1, analyzedAt: 1 },
    ])
    expect(await repo.listContentFor('alice')).toHaveLength(1)
  })
})
