/**
 * Supabase-backed CorpusRepository (the shared team brain).
 *
 * Construction does ZERO I/O — every method goes through the module `supabase`
 * client, whose accessToken callback resolves the Clerk JWT lazily, so this is safe
 * to build at module import (corpusStore binds it before Clerk has a token).
 *
 * Bookkeeping (timesSeen / firstSeenAt / lastSeenAt) is derived in
 * corpus_creators_view; sightings are append-only (race-free). All dedupe/sort
 * SEMANTICS match corpus.ts so the in-memory double and this impl behave identically.
 */
import { supabase } from './supabaseClient'
import {
  SIGHTINGS_CAP,
  type CorpusRepository, type CreatorInput, type CreatorRecord,
  type ContentRecord, type Feedback, type Sighting, type CorpusSort,
} from './corpus'

const SORT_COLUMN: Record<CorpusSort, string> = {
  lastSeenAt: 'last_seen_at',
  timesSeen: 'times_seen',
  followersCount: 'followers_count',
  engagementRate: 'engagement_rate',
}

const ms = (t: string | null): number => (t ? new Date(t).getTime() : 0)

interface SightingRow {
  creator_username: string; at: string; pipeline: string; niche: string | null
  city: string | null; category: string | null; rank: number | null
  rationale: string | null; specialties: string[] | null; content_focus: string | null
  partnership_ready: boolean | null; location_confidence: string | null
}

function rowToSighting(r: SightingRow): Sighting {
  return {
    at: ms(r.at), pipeline: r.pipeline as Sighting['pipeline'],
    niche: r.niche ?? undefined, city: r.city ?? undefined,
    category: (r.category as Sighting['category']) ?? undefined,
    rank: r.rank ?? undefined, rationale: r.rationale ?? undefined,
    specialties: r.specialties ?? undefined, contentFocus: r.content_focus ?? undefined,
    partnershipReady: r.partnership_ready ?? undefined,
    locationConfidence: (r.location_confidence as Sighting['locationConfidence']) ?? undefined,
  }
}

function rowToCreator(r: Record<string, unknown>, sightings: Sighting[]): CreatorRecord {
  return {
    username: r.username as string,
    fullName: (r.full_name as string) ?? '',
    profilePicUrl: (r.profile_pic_url as string) ?? '',
    verified: !!r.verified,
    isBusinessAccount: !!r.is_business_account,
    followersCount: (r.followers_count as number) ?? 0,
    followsCount: (r.follows_count as number) ?? 0,
    postsCount: (r.posts_count as number) ?? 0,
    avgLikes: (r.avg_likes as number) ?? 0,
    avgComments: (r.avg_comments as number) ?? 0,
    engagementRate: (r.engagement_rate as number | null) ?? null,
    topHashtags: (r.top_hashtags as string[]) ?? [],
    lastPostDate: (r.last_post_date as string) ?? undefined,
    firstSeenAt: ms(r.first_seen_at as string | null),
    lastSeenAt: ms(r.last_seen_at as string | null),
    timesSeen: (r.times_seen as number) ?? 0,
    sightings,
    feedback: (r.feedback as Feedback | null) ?? undefined,
    feedbackAt: r.feedback_at ? ms(r.feedback_at as string) : undefined,
  }
}

/** Fetch recent sightings for a set of usernames, grouped + capped per creator. */
async function fetchSightings(usernames: string[]): Promise<Record<string, Sighting[]>> {
  const grouped: Record<string, Sighting[]> = {}
  if (usernames.length === 0) return grouped
  const { data, error } = await supabase
    .from('corpus_sightings')
    .select('*')
    .in('creator_username', usernames)
    .order('at', { ascending: false })
    .limit(usernames.length * SIGHTINGS_CAP)  // bound: at most cap rows per creator
  if (error) throw error
  for (const row of (data ?? []) as SightingRow[]) {
    const list = (grouped[row.creator_username] ??= [])
    if (list.length < SIGHTINGS_CAP) list.push(rowToSighting(row))
  }
  // sightings[] in the domain type is oldest→newest (mergeCreator appends); reverse the
  // desc-capped slice so order matches the in-memory impl.
  for (const u of Object.keys(grouped)) grouped[u].reverse()
  return grouped
}

export function createSupabaseCorpus(): CorpusRepository {
  // Capture `repo` so methods call repo.getMany()/repo.get() instead of `this.*` —
  // survives destructuring (const { remember } = corpus) without unbinding.
  const repo: CorpusRepository = {
    async remember(inputs: CreatorInput[]) {
      if (inputs.length === 0) return []

      // 6.4: batch all writes — 2N+2 sequential round trips → ~4 batched ops.
      const buildRow = (p: CreatorInput['profile']) => ({
        username: p.username,
        full_name: p.fullName,
        profile_pic_url: p.profilePicUrl,
        verified: p.verified,
        is_business_account: p.isBusinessAccount,
        followers_count: p.followersCount,
        follows_count: p.followsCount,
        posts_count: p.postsCount,
        avg_likes: p.avgLikes,
        avg_comments: p.avgComments,
        engagement_rate: p.engagementRate,
        top_hashtags: p.topHashtags,
        last_post_date: p.lastPostDate ?? null,
      })

      const withData = inputs.filter(({ profile: p }) => p.followersCount > 0).map(({ profile: p }) => buildRow(p))
      const withoutData = inputs.filter(({ profile: p }) => p.followersCount === 0).map(({ profile: p }) => buildRow(p))

      // hasData rows → update metrics on conflict; no-data rows → ensure row exists, never clobber.
      if (withData.length > 0) {
        const { error } = await supabase.from('corpus_creators').upsert(withData)
        if (error) throw error
      }
      if (withoutData.length > 0) {
        const { error } = await supabase.from('corpus_creators').upsert(withoutData, { ignoreDuplicates: true })
        if (error) throw error
      }

      const sightingRows = inputs.map(({ profile: p, sighting: s }) => ({
        creator_username: p.username,
        at: new Date(s.at).toISOString(),
        pipeline: s.pipeline,
        niche: s.niche ?? null,
        city: s.city ?? null,
        category: s.category ?? null,
        rank: s.rank ?? null,
        rationale: s.rationale ?? null,
        specialties: s.specialties ?? null,
        content_focus: s.contentFocus ?? null,
        partnership_ready: s.partnershipReady ?? null,
        location_confidence: s.locationConfidence ?? null,
      }))
      const { error: sErr } = await supabase.from('corpus_sightings').insert(sightingRows)
      if (sErr) throw sErr

      return repo.getMany(inputs.map((i) => i.profile.username))
    },

    async get(username: string) {
      const recs = await repo.getMany([username])
      return recs[0]
    },

    async getMany(usernames: string[]) {
      if (usernames.length === 0) return []
      const { data, error } = await supabase
        .from('corpus_creators_view')
        .select('*')
        .in('username', usernames)
      if (error) throw error
      const rows = (data ?? []) as Record<string, unknown>[]
      const sightings = await fetchSightings(rows.map((r) => r.username as string))
      return rows.map((r) => rowToCreator(r, sightings[r.username as string] ?? []))
    },

    async setFeedback(username: string, feedback: Feedback | null, at: number) {
      const { data, error } = await supabase
        .from('corpus_creators')
        .update({ feedback, feedback_at: feedback ? new Date(at).toISOString() : null })
        .eq('username', username)
        .select()
      if (error) throw error
      if (!data || (data as unknown[]).length === 0) return undefined
      return repo.get(username)
    },

    async list(opts?: { sort?: CorpusSort; limit?: number }) {
      const col = SORT_COLUMN[opts?.sort ?? 'lastSeenAt']
      let q = supabase
        .from('corpus_creators_view')
        .select('*')
        .order(col, { ascending: false, nullsFirst: false })
      if (opts?.limit != null) q = q.limit(opts.limit)
      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as Record<string, unknown>[]
      const sightings = await fetchSightings(rows.map((r) => r.username as string))
      return rows.map((r) => rowToCreator(r, sightings[r.username as string] ?? []))
    },

    async count() {
      // Count over corpus_creators (PK = username), so this is distinct creators —
      // parity with the in-memory impl's store.size (NOT a sightings count).
      const { count, error } = await supabase
        .from('corpus_creators')
        .select('*', { count: 'exact', head: true })
      if (error) throw error
      return count ?? 0
    },

    async rememberContent(records: ContentRecord[]) {
      if (records.length === 0) return
      const rows = records.map((r) => ({
        id: r.id,
        creator_username: r.creatorUsername,
        analyzed_at: new Date(r.analyzedAt).toISOString(),
        payload: r,
        updated_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('corpus_content').upsert(rows)
      if (error) throw error
    },

    async listContentFor(creatorUsername: string) {
      const { data, error } = await supabase
        .from('corpus_content')
        .select('payload')
        .eq('creator_username', creatorUsername)
        .order('analyzed_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as { payload: ContentRecord }[]).map((r) => r.payload)
    },

    async clear() {
      // Destructive on SHARED team data — never wired to a real delete. Tests use the
      // in-memory double (createMemoryCorpus) for clear() semantics.
      throw new Error('clear() is not supported on the shared Supabase corpus')
    },
  }
  return repo
}
