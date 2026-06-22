/**
 * Tests for the corpus memory layer.
 *
 * `mergeCreator` is the pure heart: given an existing record (or none) and a new
 * sighting, it produces the updated CreatorRecord — accumulate timesSeen, append the
 * sighting, advance lastSeenAt, refresh metrics from the freshest scrape. No I/O, so
 * the dedupe/merge semantics are verified here with zero storage involved.
 */

import { describe, it, expect } from 'vitest'
import { mergeCreator, createMemoryCorpus, recognition, creatorContexts, SIGHTINGS_CAP, applyFeedback, nextFeedback, dropDismissedCandidates, selectPreferenceExemplars } from './corpus'
import type { CreatorRecord, Sighting, ContentRecord } from './corpus'
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

describe('mergeCreator', () => {
  it('creates a new record from the first sighting', () => {
    const rec = mergeCreator(undefined, { profile: profile('alice'), sighting: sighting(100) })
    expect(rec.username).toBe('alice')
    expect(rec.fullName).toBe('alice Name')
    expect(rec.followersCount).toBe(1000)
    expect(rec.engagementRate).toBe(5)
    expect(rec.timesSeen).toBe(1)
    expect(rec.firstSeenAt).toBe(100)
    expect(rec.lastSeenAt).toBe(100)
    expect(rec.sightings).toHaveLength(1)
    expect(rec.sightings[0].niche).toBe('food')
  })

  it('accumulates a repeat sighting: bumps timesSeen, appends sighting, keeps firstSeenAt', () => {
    const first = mergeCreator(undefined, { profile: profile('alice'), sighting: sighting(100, { niche: 'food' }) })
    const second = mergeCreator(first, {
      profile: profile('alice'),
      sighting: sighting(200, { niche: 'cafe', pipeline: 'discovery', city: 'Pune' }),
    })
    expect(second.timesSeen).toBe(2)
    expect(second.firstSeenAt).toBe(100)
    expect(second.lastSeenAt).toBe(200)
    expect(second.sightings).toHaveLength(2)
    expect(second.sightings[1].city).toBe('Pune')
  })

  it('refreshes metrics to the latest scrape', () => {
    const first = mergeCreator(undefined, {
      profile: profile('alice', { followersCount: 1000, engagementRate: 5 }),
      sighting: sighting(100),
    })
    const second = mergeCreator(first, {
      profile: profile('alice', { followersCount: 1500, engagementRate: 7 }),
      sighting: sighting(200),
    })
    expect(second.followersCount).toBe(1500)
    expect(second.engagementRate).toBe(7)
  })

  it('keeps existing metrics when the new profile is an empty stub (followers 0)', () => {
    const first = mergeCreator(undefined, {
      profile: profile('alice', { followersCount: 1000, engagementRate: 5 }),
      sighting: sighting(100),
    })
    const second = mergeCreator(first, {
      profile: profile('alice', { followersCount: 0, avgLikes: 0, avgComments: 0, engagementRate: null }),
      sighting: sighting(200),
    })
    expect(second.followersCount).toBe(1000) // preserved — don't clobber good data
    expect(second.engagementRate).toBe(5)
    expect(second.timesSeen).toBe(2) // but the sighting still counts
  })

  it('caps sightings at SIGHTINGS_CAP, keeping the most recent', () => {
    let rec: CreatorRecord | undefined
    for (let i = 1; i <= SIGHTINGS_CAP + 5; i++) {
      rec = mergeCreator(rec, { profile: profile('alice'), sighting: sighting(i, { rank: i }) })
    }
    expect(rec!.sightings).toHaveLength(SIGHTINGS_CAP)
    expect(rec!.timesSeen).toBe(SIGHTINGS_CAP + 5) // count is not capped
    expect(rec!.sightings[rec!.sightings.length - 1].rank).toBe(SIGHTINGS_CAP + 5) // newest kept
    expect(rec!.sightings[0].rank).toBe(6) // oldest 5 dropped
  })
})

describe('createMemoryCorpus', () => {
  it('remembers creators and counts them', async () => {
    const c = createMemoryCorpus()
    await c.remember([
      { profile: profile('alice'), sighting: sighting(100) },
      { profile: profile('bob'), sighting: sighting(100) },
    ])
    expect(await c.count()).toBe(2)
    expect((await c.get('alice'))?.username).toBe('alice')
    expect(await c.get('nobody')).toBeUndefined()
  })

  it('dedupes a creator seen in two searches into one record with two sightings', async () => {
    const c = createMemoryCorpus()
    await c.remember([{ profile: profile('alice'), sighting: sighting(100, { niche: 'food' }) }])
    await c.remember([{ profile: profile('alice'), sighting: sighting(200, { niche: 'cafe' }) }])
    expect(await c.count()).toBe(1)
    const rec = await c.get('alice')
    expect(rec?.timesSeen).toBe(2)
    expect(rec?.sightings).toHaveLength(2)
  })

  it('returns merged records from remember (timesSeen reflects prior sightings)', async () => {
    const c = createMemoryCorpus()
    await c.remember([{ profile: profile('alice'), sighting: sighting(100) }])
    const merged = await c.remember([
      { profile: profile('alice'), sighting: sighting(200) },
      { profile: profile('bob'), sighting: sighting(200) },
    ])
    const byName = Object.fromEntries(merged.map((r) => [r.username, r]))
    expect(byName.alice.timesSeen).toBe(2) // already known
    expect(byName.bob.timesSeen).toBe(1) // brand new
  })

  it('lists by lastSeenAt (most-recent first) by default', async () => {
    const c = createMemoryCorpus()
    await c.remember([{ profile: profile('alice'), sighting: sighting(100) }])
    await c.remember([{ profile: profile('bob'), sighting: sighting(300) }])
    await c.remember([{ profile: profile('carol'), sighting: sighting(200) }])
    const all = await c.list()
    expect(all.map((r) => r.username)).toEqual(['bob', 'carol', 'alice'])
  })

  it('lists creators sorted by timesSeen (desc) with a limit', async () => {
    const c = createMemoryCorpus()
    await c.remember([{ profile: profile('alice'), sighting: sighting(100) }])
    await c.remember([{ profile: profile('alice'), sighting: sighting(200) }]) // alice 2x
    await c.remember([{ profile: profile('bob'), sighting: sighting(150) }]) // bob 1x
    const top = await c.list({ sort: 'timesSeen', limit: 1 })
    expect(top).toHaveLength(1)
    expect(top[0].username).toBe('alice')
  })

  it('getMany returns existing records and omits unknown usernames', async () => {
    const c = createMemoryCorpus()
    await c.remember([
      { profile: profile('alice'), sighting: sighting(100) },
      { profile: profile('bob'), sighting: sighting(100) },
    ])
    const recs = await c.getMany(['alice', 'ghost', 'bob'])
    expect(recs.map((r) => r.username).sort()).toEqual(['alice', 'bob'])
  })

  it('clear() removes everything', async () => {
    const c = createMemoryCorpus()
    await c.remember([{ profile: profile('alice'), sighting: sighting(100) }])
    expect(await c.count()).toBe(1) // guard: proves remember worked before clear
    await c.clear()
    expect(await c.count()).toBe(0)
  })
})

describe('createMemoryCorpus — content', () => {
  it('stores content and lists it per creator', async () => {
    const c = createMemoryCorpus()
    await c.rememberContent([content('r1', 'alice'), content('r2', 'alice'), content('r3', 'bob')])
    expect((await c.listContentFor('alice')).map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(await c.listContentFor('bob')).toHaveLength(1)
    expect(await c.listContentFor('nobody')).toEqual([])
  })

  it('lists ALL content across creators, newest first, respecting limit', async () => {
    const c = createMemoryCorpus()
    await c.rememberContent([
      content('r1', 'alice', { analyzedAt: 10 }),
      content('r2', 'bob', { analyzedAt: 30 }),
      content('r3', 'alice', { analyzedAt: 20 }),
    ])
    const all = await c.listAllContent()
    expect(all.map((r) => r.id)).toEqual(['r2', 'r3', 'r1']) // analyzedAt desc, across creators
    expect((await c.listAllContent({ limit: 2 })).map((r) => r.id)).toEqual(['r2', 'r3'])
  })

  it('upserts content by id — re-analyzing the same reel overwrites', async () => {
    const c = createMemoryCorpus()
    await c.rememberContent([content('r1', 'alice', { hookArchetype: 'old' })])
    await c.rememberContent([content('r1', 'alice', { hookArchetype: 'new' })])
    const list = await c.listContentFor('alice')
    expect(list).toHaveLength(1)
    expect(list[0].hookArchetype).toBe('new')
  })
})

describe('feedback (Phase 3 — self-training signal)', () => {
  it('applyFeedback sets the signal + timestamp, preserving everything else', () => {
    const rec = mergeCreator(undefined, { profile: profile('alice'), sighting: sighting(100) })
    const saved = applyFeedback(rec, 'saved', 500)
    expect(saved.feedback).toBe('saved')
    expect(saved.feedbackAt).toBe(500)
    expect(saved.username).toBe('alice')          // identity preserved
    expect(saved.timesSeen).toBe(1)               // bookkeeping untouched
    expect(saved.sightings).toEqual(rec.sightings)
  })

  it('applyFeedback(null) clears the signal back to neutral', () => {
    const rec = applyFeedback(
      mergeCreator(undefined, { profile: profile('alice'), sighting: sighting(100) }),
      'dismissed',
      500,
    )
    const cleared = applyFeedback(rec, null, 900)
    expect(cleared.feedback).toBeUndefined()
    expect(cleared.feedbackAt).toBeUndefined()
  })

  it('mergeCreator preserves feedback when the creator is seen again', () => {
    // A saved creator who resurfaces in a later search must keep their verdict —
    // re-seeing them is not a reason to forget what the user told us.
    const first = mergeCreator(undefined, { profile: profile('alice'), sighting: sighting(100) })
    const saved = applyFeedback(first, 'saved', 500)
    const reSeen = mergeCreator(saved, {
      profile: profile('alice', { followersCount: 2000 }),
      sighting: sighting(900, { niche: 'travel' }),
    })
    expect(reSeen.feedback).toBe('saved')         // verdict survives the re-sighting
    expect(reSeen.feedbackAt).toBe(500)
    expect(reSeen.timesSeen).toBe(2)              // still accumulates
    expect(reSeen.followersCount).toBe(2000)      // metrics still refresh
  })

  it('setFeedback marks a remembered creator and persists it', async () => {
    const corpus = createMemoryCorpus()
    await corpus.remember([{ profile: profile('alice'), sighting: sighting(100) }])
    const updated = await corpus.setFeedback('alice', 'saved', 500)
    expect(updated?.feedback).toBe('saved')
    expect((await corpus.get('alice'))?.feedback).toBe('saved')   // persisted
    expect((await corpus.get('alice'))?.feedbackAt).toBe(500)
  })

  it('setFeedback(null) clears a creator\'s feedback', async () => {
    const corpus = createMemoryCorpus()
    await corpus.remember([{ profile: profile('alice'), sighting: sighting(100) }])
    await corpus.setFeedback('alice', 'dismissed', 500)
    await corpus.setFeedback('alice', null, 900)
    expect((await corpus.get('alice'))?.feedback).toBeUndefined()
  })

  it('setFeedback on an unknown creator is a no-op (never mints a profileless record)', async () => {
    const corpus = createMemoryCorpus()
    const res = await corpus.setFeedback('ghost', 'saved', 500)
    expect(res).toBeUndefined()
    expect(await corpus.count()).toBe(0)
  })

  it('nextFeedback toggles the active verdict off, and switches otherwise', () => {
    // The click semantics behind the card buttons: tapping the verdict you already have
    // clears it (toggle off); tapping the other one switches.
    expect(nextFeedback(undefined, 'saved')).toBe('saved')        // neutral → set
    expect(nextFeedback('saved', 'saved')).toBeNull()             // tap active → clear
    expect(nextFeedback('saved', 'dismissed')).toBe('dismissed')  // switch verdict
    expect(nextFeedback('dismissed', 'dismissed')).toBeNull()     // tap active → clear
  })
})

describe('dropDismissedCandidates (Phase 3, 3a — hard filter)', () => {
  const creators = (): Record<string, CreatorRecord> => ({
    bob: applyFeedback(mergeCreator(undefined, { profile: profile('bob'), sighting: sighting(1) }), 'dismissed', 5),
    carol: applyFeedback(mergeCreator(undefined, { profile: profile('carol'), sighting: sighting(1) }), 'saved', 5),
    dave: mergeCreator(undefined, { profile: profile('dave'), sighting: sighting(1) }), // neutral
  })

  it('drops only dismissed candidates; keeps saved, neutral, and unknown', () => {
    const candidates = [{ username: 'alice' }, { username: 'bob' }, { username: 'carol' }, { username: 'dave' }]
    const kept = dropDismissedCandidates(candidates, creators())
    // bob (dismissed) removed; alice (unknown), carol (saved), dave (neutral) kept
    expect(kept.map((c) => c.username)).toEqual(['alice', 'carol', 'dave'])
  })

  it('empty candidate list → empty', () => {
    expect(dropDismissedCandidates([], creators())).toEqual([])
  })
})

describe('selectPreferenceExemplars (Phase 3, 3b — soft bias selection)', () => {
  const rec = (username: string, fb: 'saved' | 'dismissed', at: number, niche: string, over: Partial<NormalizedProfile> = {}): CreatorRecord =>
    applyFeedback(mergeCreator(undefined, { profile: profile(username, over), sighting: sighting(1, { niche }) }), fb, at)

  it('splits saved/dismissed, orders same-niche first then by recency', () => {
    const creators = [
      rec('a', 'saved', 100, 'food'),     // same-niche, older
      rec('b', 'saved', 300, 'fitness'),  // other-niche, newest
      rec('c', 'saved', 200, 'food'),     // same-niche, newer
      rec('d', 'dismissed', 150, 'food'),
      rec('e', 'dismissed', 50, 'travel'),
    ]
    const { saved, dismissed } = selectPreferenceExemplars(creators, 'food', 5)
    expect(saved.map((e) => e.username)).toEqual(['c', 'a', 'b'])   // food(recent→old) then other-niche
    expect(saved.find((e) => e.username === 'c')?.sameNiche).toBe(true)
    expect(saved.find((e) => e.username === 'b')?.sameNiche).toBe(false)
    expect(dismissed.map((e) => e.username)).toEqual(['d', 'e'])    // food then travel
  })

  it('respects the cap, keeping the most relevant', () => {
    const many = Array.from({ length: 8 }, (_, i) => rec(`s${i}`, 'saved', i, 'food'))
    expect(selectPreferenceExemplars(many, 'food', 5).saved).toHaveLength(5)
  })

  it('ignores neutral creators (no verdict)', () => {
    const creators = [mergeCreator(undefined, { profile: profile('neutral'), sighting: sighting(1) })]
    const { saved, dismissed } = selectPreferenceExemplars(creators, 'food', 5)
    expect(saved).toEqual([])
    expect(dismissed).toEqual([])
  })

  it('sameNiche uses token overlap, not exact match (food bloggers ~ food creators)', () => {
    const { saved } = selectPreferenceExemplars([rec('a', 'saved', 100, 'food bloggers')], 'food creators', 5)
    expect(saved[0].sameNiche).toBe(true)
  })

  it('carries the traits the prompt needs', () => {
    const { saved } = selectPreferenceExemplars(
      [rec('a', 'saved', 100, 'food', { followersCount: 50000, engagementRate: 7.2, verified: true })],
      'food',
      5,
    )
    expect(saved[0]).toMatchObject({ username: 'a', followersCount: 50000, engagementRate: 7.2, verified: true, niches: ['food'], sameNiche: true })
  })
})

describe('recognition', () => {
  const rec = (timesSeen: number, sightings: Sighting[]): CreatorRecord => ({
    username: 'alice',
    fullName: '',
    profilePicUrl: '',
    verified: false,
    isBusinessAccount: false,
    followersCount: 0,
    followsCount: 0,
    postsCount: 0,
    avgLikes: 0,
    avgComments: 0,
    engagementRate: null,
    topHashtags: [],
    firstSeenAt: 0,
    lastSeenAt: 0,
    timesSeen,
    sightings,
  })

  it('returns null for an unknown or first-time creator (no badge)', () => {
    expect(recognition(undefined)).toBeNull()
    expect(recognition(rec(1, [sighting(100)]))).toBeNull()
  })

  it('labels a repeat creator with its count and distinct search contexts', () => {
    const r = recognition(
      rec(3, [
        sighting(100, { niche: 'fitness' }),
        sighting(200, { niche: 'cafes', city: 'Pune' }),
        sighting(300, { niche: 'fitness' }),
      ]),
    )
    expect(r?.label).toBe('Seen 3×')
    expect(r?.detail).toBe('fitness · cafes · Pune')
  })

  it('creatorContexts returns distinct niches + cities across sightings', () => {
    const r = rec(3, [
      sighting(100, { niche: 'fitness' }),
      sighting(200, { niche: 'cafes', city: 'Pune' }),
      sighting(300, { niche: 'fitness' }),
    ])
    expect(creatorContexts(r)).toEqual(['fitness', 'cafes', 'Pune'])
  })

  it('creatorContexts is empty when no sighting carries a niche/city', () => {
    expect(creatorContexts(rec(1, [{ at: 1, pipeline: 'competitor' }]))).toEqual([])
  })
})
