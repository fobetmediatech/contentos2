/**
 * Contract tests for the IndexedDB-backed corpus — the layer that actually persists
 * creators in the browser. The headline test is "survives a fresh instance": it proves a
 * creator remembered by one corpus handle is still there when a brand-new handle opens the
 * same database — i.e. the data outlives a reload, which is the entire point of this stage.
 *
 * Runs against fake-indexeddb (jsdom has no IndexedDB). A fresh IDBFactory per test isolates them.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, it, expect } from 'vitest'
import { createIdbCorpus } from './corpusIdb'
import type { Sighting, ContentRecord } from './corpus'
import type { NormalizedProfile } from './transformers'

const content = (id: string, creatorUsername: string, over: Partial<ContentRecord> = {}): ContentRecord => ({
  id,
  creatorUsername,
  kind: 'reel',
  url: `https://reel/${id}`,
  videoViewCount: 1000,
  likesCount: 100,
  commentsCount: 10,
  analyzedAt: 1,
  ...over,
})

const profile = (username: string, over: Partial<NormalizedProfile> = {}): NormalizedProfile => ({
  username,
  fullName: `${username} Name`,
  biography: '',
  followersCount: 1000,
  followsCount: 100,
  postsCount: 50,
  profilePicUrl: `https://pic/${username}`,
  verified: false,
  isBusinessAccount: false,
  avgLikes: 100,
  avgComments: 10,
  engagementRate: 5,
  relatedHandles: [],
  topHashtags: ['food'],
  lastPostDate: '2026-05-01T00:00:00Z',
  ...over,
})

const sighting = (at: number, over: Partial<Sighting> = {}): Sighting => ({
  at,
  pipeline: 'competitor',
  niche: 'food',
  category: 'top',
  rank: 1,
  rationale: 'great',
  ...over,
})

beforeEach(() => {
  // Fresh in-memory IndexedDB per test so state never leaks between cases.
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
})

describe('createIdbCorpus', () => {
  it('persists and retrieves a creator', async () => {
    const c = createIdbCorpus()
    await c.remember([{ profile: profile('alice'), sighting: sighting(100) }])
    expect(await c.count()).toBe(1)
    expect((await c.get('alice'))?.followersCount).toBe(1000)
  })

  it('survives a fresh corpus instance (proves data outlives a reload)', async () => {
    const writer = createIdbCorpus()
    await writer.remember([{ profile: profile('alice'), sighting: sighting(100) }])

    // A brand-new handle to the same database — simulates the next page load.
    const reader = createIdbCorpus()
    const rec = await reader.get('alice')
    expect(rec?.username).toBe('alice')
    expect(rec?.timesSeen).toBe(1)
  })

  it('dedupes a creator across two separate remember calls', async () => {
    const c = createIdbCorpus()
    await c.remember([{ profile: profile('alice'), sighting: sighting(100, { niche: 'food' }) }])
    await c.remember([{ profile: profile('alice'), sighting: sighting(200, { niche: 'cafe' }) }])
    expect(await c.count()).toBe(1)
    const rec = await c.get('alice')
    expect(rec?.timesSeen).toBe(2)
    expect(rec?.sightings).toHaveLength(2)
  })

  it('lists by timesSeen with a limit', async () => {
    const c = createIdbCorpus()
    await c.remember([{ profile: profile('alice'), sighting: sighting(100) }])
    await c.remember([{ profile: profile('alice'), sighting: sighting(200) }])
    await c.remember([{ profile: profile('bob'), sighting: sighting(150) }])
    const top = await c.list({ sort: 'timesSeen', limit: 1 })
    expect(top.map((r) => r.username)).toEqual(['alice'])
  })

  it('clear() empties the store', async () => {
    const c = createIdbCorpus()
    await c.remember([{ profile: profile('alice'), sighting: sighting(100) }])
    expect(await c.count()).toBe(1)
    await c.clear()
    expect(await c.count()).toBe(0)
  })

  it('persists content and lists it per creator', async () => {
    const c = createIdbCorpus()
    await c.rememberContent([content('r1', 'alice'), content('r2', 'alice'), content('r3', 'bob')])
    expect((await c.listContentFor('alice')).map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(await c.listContentFor('bob')).toHaveLength(1)
  })

  it('content survives a fresh corpus instance (outlives a reload)', async () => {
    const writer = createIdbCorpus()
    await writer.rememberContent([content('r1', 'alice', { hookArchetype: 'Curiosity gap' })])
    const reader = createIdbCorpus()
    const list = await reader.listContentFor('alice')
    expect(list).toHaveLength(1)
    expect(list[0].hookArchetype).toBe('Curiosity gap')
  })

  it('clear() also empties content', async () => {
    const c = createIdbCorpus()
    await c.rememberContent([content('r1', 'alice')])
    expect(await c.listContentFor('alice')).toHaveLength(1)
    await c.clear()
    expect(await c.listContentFor('alice')).toEqual([])
  })
})
