/**
 * Corpus — the cross-search creator memory (Phase 2).
 *
 * Every completed search feeds its creators in here; the corpus dedupes them by
 * username and accumulates *sightings* over time, so a creator who shows up in three
 * different searches is remembered as one record with three sightings — that's what
 * turns this from a search box into an OS that gets smarter the more you use it.
 *
 * This file is pure logic + the in-memory implementation only — NO `idb` import — so it
 * loads in jsdom/Node and the merge semantics are unit-testable without a real database.
 * The IndexedDB implementation (and the runtime-selected default) lives in `corpusIdb.ts`.
 */

import type { NormalizedProfile } from './transformers'

export type Pipeline = 'competitor' | 'discovery'

/** The user's verdict on a creator — the Phase 3 self-training signal. `saved` = more like
 *  this; `dismissed` = not relevant. Absent = neutral (no verdict yet). */
export type Feedback = 'saved' | 'dismissed'

/** One appearance of a creator in a search result. */
export interface Sighting {
  /** Timestamp (ms) of the search that surfaced this creator. */
  at: number
  pipeline: Pipeline
  /** Niche label (competitor: AnalysisOutput.niche; discovery: DiscoveryOutput.niche). */
  niche?: string
  /** Discovery only — the target city. */
  city?: string
  category?: 'top' | 'trending'
  rank?: number
  rationale?: string
  // Discovery-specific signal (undefined for competitor sightings)
  specialties?: string[]
  contentFocus?: string
  partnershipReady?: boolean
  locationConfidence?: 'confirmed' | 'likely' | 'unknown'
}

/** A remembered creator — identity + freshest metrics + accumulated sightings. */
export interface CreatorRecord {
  username: string
  fullName: string
  profilePicUrl: string
  verified: boolean
  isBusinessAccount: boolean
  // Freshest metrics snapshot (refreshed on each non-empty sighting)
  followersCount: number
  followsCount: number
  postsCount: number
  avgLikes: number
  avgComments: number
  engagementRate: number | null
  topHashtags: string[]
  lastPostDate?: string
  // Memory bookkeeping
  firstSeenAt: number
  lastSeenAt: number
  /** Total sightings ever — NOT capped (sightings[] is capped, this count is not). */
  timesSeen: number
  sightings: Sighting[]
  /** The user's verdict (Phase 3). Absent = neutral. Survives re-sightings (mergeCreator
   *  preserves it) so a saved/dismissed call sticks even as the creator resurfaces. */
  feedback?: Feedback
  /** When the verdict was last set (ms) — drives recency for few-shot exemplar selection. */
  feedbackAt?: number
}

/** The unit fed into the corpus: a profile snapshot + the sighting that surfaced it. */
export interface CreatorInput {
  profile: NormalizedProfile
  sighting: Sighting
}

/**
 * A piece of analyzed content (currently reels) tied to a creator — the "content" half of
 * the creator/content corpus. Keyed by `id` (the reel shortCode); re-analysis upserts.
 */
export interface ContentRecord {
  id: string
  creatorUsername: string
  kind: 'reel'
  url: string
  caption?: string
  /** Reel thumbnail (Apify `displayUrl`). Instagram CDN URL — may expire; the gallery
   *  degrades to a placeholder when it fails to load. Absent when the scrape had none. */
  thumbnailUrl?: string
  /** Full spoken transcript from the single-reel analyzer. Absent when not transcribed. */
  transcript?: string
  videoViewCount: number
  likesCount: number
  commentsCount: number
  hookArchetype?: string
  openingLine?: string
  analyzedAt: number
}

/** Keep at most this many sightings per creator (the most recent), to bound record size. */
export const SIGHTINGS_CAP = 20

export type CorpusSort = 'lastSeenAt' | 'timesSeen' | 'followersCount' | 'engagementRate'

/**
 * Storage-agnostic corpus contract. The in-memory implementation (below) and the
 * IndexedDB one (corpusIdb.ts) both satisfy this — and a future Supabase one will too,
 * which is the whole point of the seam. Async throughout so the IndexedDB impl fits.
 */
export interface CorpusRepository {
  /** Fold each input into the corpus (dedupe by username); returns the merged records. */
  remember(inputs: CreatorInput[]): Promise<CreatorRecord[]>
  get(username: string): Promise<CreatorRecord | undefined>
  getMany(usernames: string[]): Promise<CreatorRecord[]>
  /** Set (feedback) or clear (null) the user's verdict on a remembered creator. Returns the
   *  updated record, or undefined when the creator isn't in the corpus (never mints one). */
  setFeedback(username: string, feedback: Feedback | null, at: number): Promise<CreatorRecord | undefined>
  list(opts?: { sort?: CorpusSort; limit?: number }): Promise<CreatorRecord[]>
  count(): Promise<number>
  /** Upsert analyzed content (reels) by id — re-analysis overwrites. */
  rememberContent(records: ContentRecord[]): Promise<void>
  /** A creator's analyzed content, most-recent first. */
  listContentFor(creatorUsername: string): Promise<ContentRecord[]>
  /** All analyzed content across every creator, most-recent first (the reel gallery feed). */
  listAllContent(opts?: { limit?: number }): Promise<ContentRecord[]>
  clear(): Promise<void>
}

/** The identity + metrics half of a record — everything except username + bookkeeping. */
type CreatorSnapshot = Omit<CreatorRecord, 'username' | 'firstSeenAt' | 'lastSeenAt' | 'timesSeen' | 'sightings'>

/** Pull the snapshot fields out of a freshly-scraped profile. */
function snapshot(p: NormalizedProfile): CreatorSnapshot {
  return {
    fullName: p.fullName,
    profilePicUrl: p.profilePicUrl,
    verified: p.verified,
    isBusinessAccount: p.isBusinessAccount,
    followersCount: p.followersCount,
    followsCount: p.followsCount,
    postsCount: p.postsCount,
    avgLikes: p.avgLikes,
    avgComments: p.avgComments,
    engagementRate: p.engagementRate,
    topHashtags: p.topHashtags,
    lastPostDate: p.lastPostDate,
  }
}

/**
 * Pure merge: fold a new sighting into an existing record (or mint a fresh one).
 *
 * - New creator → snapshot the profile, seed firstSeen/lastSeen, timesSeen = 1.
 * - Repeat creator → bump timesSeen, append the sighting (capped to the most recent
 *   SIGHTINGS_CAP), advance lastSeenAt / preserve firstSeenAt, and refresh the metrics
 *   snapshot — but ONLY from a non-empty scrape (followers > 0), so a creator that
 *   surfaces in results without a profile attached never clobbers good remembered data.
 */
export function mergeCreator(existing: CreatorRecord | undefined, incoming: CreatorInput): CreatorRecord {
  const { profile, sighting } = incoming
  const hasData = profile.followersCount > 0

  if (!existing) {
    return {
      username: profile.username,
      ...snapshot(profile),
      firstSeenAt: sighting.at,
      lastSeenAt: sighting.at,
      timesSeen: 1,
      sightings: [sighting],
    }
  }

  return {
    ...existing,
    ...(hasData ? snapshot(profile) : {}),
    firstSeenAt: Math.min(existing.firstSeenAt, sighting.at),
    lastSeenAt: Math.max(existing.lastSeenAt, sighting.at),
    timesSeen: existing.timesSeen + 1,
    sightings: [...existing.sightings, sighting].slice(-SIGHTINGS_CAP),
  }
}

/**
 * Pure: set or clear the user's feedback verdict on a record. `null` resets to neutral
 * (both fields undefined). Everything else — identity, metrics, sightings, bookkeeping — is
 * untouched, so a verdict is orthogonal to the objective memory it annotates.
 */
export function applyFeedback(record: CreatorRecord, feedback: Feedback | null, at: number): CreatorRecord {
  if (feedback === null) {
    return { ...record, feedback: undefined, feedbackAt: undefined }
  }
  return { ...record, feedback, feedbackAt: at }
}

/**
 * The verdict after a feedback button is clicked: tapping the verdict you already have clears
 * it (returns null → neutral); tapping the other one switches to it. Pure — drives the card
 * toggle so the two buttons behave like a tri-state (neutral / saved / dismissed).
 */
export function nextFeedback(current: Feedback | undefined, clicked: Feedback): Feedback | null {
  return current === clicked ? null : clicked
}

// ----- Phase 3 slice 3: preference-aware ranking -----

/**
 * Hard filter (3a): drop candidates the user has dismissed so they stop resurfacing in future
 * rankings. Generic over anything with a `username`; pure — verdicts come from the live
 * creators map. Order preserved. Callers apply this AFTER the empty-pool guard and re-check
 * the count (dismissing can shrink a thin pool — see useCompetitorAnalysis).
 */
export function dropDismissedCandidates<T extends { username: string }>(
  candidates: T[],
  creators: Record<string, CreatorRecord>,
): T[] {
  return candidates.filter((c) => creators[c.username]?.feedback !== 'dismissed')
}

/** A saved/dismissed creator distilled to the traits Gemini can actually learn from (3b). */
export interface PreferenceExemplar {
  username: string
  followersCount: number
  engagementRate: number | null
  niches: string[]
  verified: boolean
  /** True when this creator's niches overlap the current search niche — weighted heavily in
   *  the prompt; cross-niche exemplars are demoted to weak style hints. */
  sameNiche: boolean
}
export interface PreferenceExemplars {
  saved: PreferenceExemplar[]
  dismissed: PreferenceExemplar[]
}

// Niche labels are free-text Gemini output ("food bloggers" vs "food creators"), so an exact
// match almost never fires. Token overlap (minus generic filler words) is the forgiving
// heuristic that makes same-niche weighting actually trigger in practice.
const NICHE_STOPWORDS = new Set([
  'creators', 'creator', 'bloggers', 'blogger', 'content', 'accounts', 'account', 'influencers', 'influencer', 'the', 'and', 'for',
])
function nicheTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !NICHE_STOPWORDS.has(w)))
}
function nicheOverlap(a: string, b: string): boolean {
  const tb = nicheTokens(b)
  for (const t of nicheTokens(a)) if (tb.has(t)) return true
  return false
}

/** Distinct niches a creator has surfaced in (sightings' niche field, deduped). */
function creatorNiches(record: CreatorRecord): string[] {
  return Array.from(new Set(record.sightings.map((s) => s.niche).filter((n): n is string => !!n)))
}

function toExemplar(record: CreatorRecord, currentNiche: string): PreferenceExemplar {
  const niches = creatorNiches(record)
  return {
    username: record.username,
    followersCount: record.followersCount,
    engagementRate: record.engagementRate,
    niches,
    verified: record.verified,
    sameNiche: niches.some((n) => nicheOverlap(n, currentNiche)),
  }
}

/**
 * Select up to `cap` saved + `cap` dismissed exemplars for the preference prompt block (3b).
 * Ordered same-niche-first (token overlap with the current search), then most-recent by
 * feedbackAt — so the cap keeps the most relevant signal. Neutral creators are ignored.
 */
export function selectPreferenceExemplars(
  creators: CreatorRecord[],
  currentNiche: string,
  cap = 5,
): PreferenceExemplars {
  const pick = (verdict: Feedback): PreferenceExemplar[] =>
    creators
      .filter((r) => r.feedback === verdict)
      .map((r) => ({ record: r, ex: toExemplar(r, currentNiche) }))
      .sort((a, b) => {
        if (a.ex.sameNiche !== b.ex.sameNiche) return a.ex.sameNiche ? -1 : 1 // same-niche first
        return (b.record.feedbackAt ?? 0) - (a.record.feedbackAt ?? 0) // then most-recent
      })
      .slice(0, cap)
      .map((x) => x.ex)
  return { saved: pick('saved'), dismissed: pick('dismissed') }
}

/** Numeric key for a sort dimension — all dimensions sort descending. */
function sortValue(r: CreatorRecord, sort: CorpusSort): number {
  switch (sort) {
    case 'timesSeen': return r.timesSeen
    case 'followersCount': return r.followersCount
    case 'engagementRate': return r.engagementRate ?? 0
    case 'lastSeenAt':
    default: return r.lastSeenAt
  }
}

/**
 * Sort + limit a batch of records (descending on the chosen dimension). Shared by every
 * CorpusRepository implementation so memory / IndexedDB / Supabase all order identically.
 */
export function sortCreators(records: CreatorRecord[], sort: CorpusSort = 'lastSeenAt', limit?: number): CreatorRecord[] {
  const sorted = [...records].sort((a, b) => sortValue(b, sort) - sortValue(a, sort))
  return limit != null ? sorted.slice(0, limit) : sorted
}

/**
 * The "seen before" recognition badge for a creator card. Returns null for an unknown
 * creator or one seen in only a single search (no recognition to show) — otherwise a count
 * label plus the distinct niches/cities they've surfaced in, for a tooltip.
 */
export function recognition(record: CreatorRecord | undefined): { label: string; detail: string } | null {
  if (!record || record.timesSeen < 2) return null
  return { label: `Seen ${record.timesSeen}×`, detail: creatorContexts(record).join(' · ') }
}

/** The distinct niches + cities a creator has surfaced in, across all sightings. */
export function creatorContexts(record: CreatorRecord): string[] {
  return Array.from(new Set(record.sightings.flatMap((s) => [s.niche, s.city].filter((x): x is string => !!x))))
}

/**
 * In-memory CorpusRepository backed by a Map. Used in tests and in any Node runtime
 * without IndexedDB. All the dedupe semantics come from mergeCreator — this layer is
 * just storage plumbing (read → merge → write), which is exactly why it's trivial to
 * mirror with IndexedDB or Supabase later.
 */
export function createMemoryCorpus(): CorpusRepository {
  const store = new Map<string, CreatorRecord>()
  const content = new Map<string, ContentRecord>()
  return {
    async remember(inputs) {
      const out: CreatorRecord[] = []
      for (const input of inputs) {
        const merged = mergeCreator(store.get(input.profile.username), input)
        store.set(merged.username, merged)
        out.push(merged)
      }
      return out
    },
    async get(username) {
      return store.get(username)
    },
    async getMany(usernames) {
      return usernames
        .map((u) => store.get(u))
        .filter((r): r is CreatorRecord => r !== undefined)
    },
    async setFeedback(username, feedback, at) {
      const existing = store.get(username)
      if (!existing) return undefined // never mint a profileless record from a verdict alone
      const updated = applyFeedback(existing, feedback, at)
      store.set(username, updated)
      return updated
    },
    async list(opts) {
      return sortCreators([...store.values()], opts?.sort, opts?.limit)
    },
    async count() {
      return store.size
    },
    async rememberContent(records) {
      for (const r of records) content.set(r.id, r)
    },
    async listContentFor(creatorUsername) {
      return [...content.values()]
        .filter((r) => r.creatorUsername === creatorUsername)
        .sort((a, b) => b.analyzedAt - a.analyzedAt)
    },
    async listAllContent(opts) {
      const all = [...content.values()].sort((a, b) => b.analyzedAt - a.analyzedAt)
      return opts?.limit != null ? all.slice(0, opts.limit) : all
    },
    async clear() {
      store.clear()
      content.clear()
    },
  }
}
