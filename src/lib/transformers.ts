/**
 * Transforms raw Apify Profile Scraper output into normalized profile data.
 *
 * Field map confirmed from real dataset:
 * dataset_instagram-profile-scraper_2026-05-26_08-32-28-324.json
 */

// ----- Raw Apify shape (subset of fields we use) -----

export interface ApifyPost {
  likesCount: number | null
  commentsCount: number | null
  timestamp: string
  isPinned?: boolean
  productType?: string
  /** Confirmed field name from Apify Instagram Profile Scraper output (plain strings, no # prefix) */
  hashtags?: string[]
}

export interface ApifyRelatedProfile {
  username: string
  is_private: boolean
}

export interface ApifyProfileRaw {
  username: string
  fullName: string
  biography: string
  followersCount: number
  followsCount: number
  postsCount: number
  profilePicUrl: string
  verified: boolean
  isBusinessAccount: boolean
  private: boolean
  latestPosts: ApifyPost[]
  relatedProfiles: ApifyRelatedProfile[]
}

// ----- Normalized shape used by AI + UI -----

/**
 * Which pipeline path discovered this profile.
 * Set by apifyClient.ts after each scrape batch — NOT by normalizeProfile itself.
 *
 * 'input'          → reference account supplied by the user (not a candidate)
 * 'hashtag'        → found via content-niche path: posts using reference account hashtags
 * 'relatedProfiles' → found via audience-adjacency: Instagram relatedProfiles graph (Round 2)
 * 'round3'         → found via audience-adjacency: relatedProfiles of R2 candidates (deeper hop)
 */
export type DiscoverySource = 'input' | 'relatedProfiles' | 'hashtag' | 'round3'

export interface NormalizedProfile {
  username: string
  fullName: string
  biography: string
  followersCount: number
  followsCount: number
  postsCount: number
  profilePicUrl: string
  verified: boolean
  isBusinessAccount: boolean

  // Computed engagement metrics
  avgLikes: number
  avgComments: number
  /** null when followers < 100 (not enough audience to be meaningful) */
  engagementRate: number | null

  // For Round 2 scraping — public related accounts only
  relatedHandles: string[]

  /** Top 10 hashtags by post frequency, stopwords removed. Empty array when no posts or no hashtags. */
  topHashtags: string[]

  /**
   * Date of the most recent post (max timestamp across Apify latestPosts —
   * pinned posts sit at the head of the array out of chronological order,
   * so [0] is not reliable). Undefined when the profile has no posts with a
   * parseable timestamp or Apify did not return latestPosts.
   * Used by the dead account gate in apifyClient.ts to filter inactive profiles.
   */
  lastPostDate?: string

  /**
   * Which discovery path found this profile.
   * Set by apifyClient.ts — undefined on input profiles (they are in inputProfiles, not candidateProfiles).
   * Used by buildCompetitorPrompt to label candidates as [CONTENT-NICHE] or [AUDIENCE-ADJACENT].
   */
  discoverySource?: DiscoverySource
}

// ----- Hashtag stopwords -----
// Generic noise hashtags that signal platform behaviour, not content niche.
// Filtering these out prevents "fyp" or "viral" from dominating the niche signal
// and leaving Gemini with meaningful subject-matter tags only.
const HASHTAG_STOPWORDS = new Set([
  'fyp', 'viral', 'reels', 'trending', 'explore',
  'instagood', 'love', 'follow', 'like', 'instagram',
  'explorepage', 'foryou', 'foryoupage', 'reelsinstagram',
])

// ----- ER outlier threshold -----
// DM-bait posts ("Comment 'Details' for link") inflate comments artificially.
// Exclude posts where commentsCount > 5% of followersCount in a single post.
// Real data: @mehakmarketing had 6,335 comments on 101K followers (6.2%) — outlier.
const DM_BAIT_THRESHOLD = 0.05

/**
 * Compute engagement rate from a profile's latest posts.
 * Returns null if fewer than 3 valid posts (not enough signal).
 */
function computeER(posts: ApifyPost[], followersCount: number): { avgLikes: number; avgComments: number; engagementRate: number | null } {
  if (followersCount < 100) {
    return { avgLikes: 0, avgComments: 0, engagementRate: null }
  }

  const dmBaitCap = followersCount * DM_BAIT_THRESHOLD

  const validPosts = posts.filter((p) => {
    const comments = p.commentsCount ?? 0
    // Exclude posts with suspiciously inflated comments (DM-bait)
    return comments <= dmBaitCap
  })

  // Need at least 3 posts for a stable average
  const postsToUse = validPosts.length >= 3 ? validPosts : posts

  if (postsToUse.length === 0) {
    return { avgLikes: 0, avgComments: 0, engagementRate: null }
  }

  const totalLikes = postsToUse.reduce((sum, p) => sum + (p.likesCount ?? 0), 0)
  const totalComments = postsToUse.reduce((sum, p) => sum + (p.commentsCount ?? 0), 0)
  const n = postsToUse.length

  const avgLikes = Math.round(totalLikes / n)
  const avgComments = Math.round(totalComments / n)
  const engagementRate = ((avgLikes + avgComments) / followersCount) * 100

  return { avgLikes, avgComments, engagementRate }
}

/**
 * Normalize a single raw Apify profile into the shape the app uses.
 */
export function normalizeProfile(raw: ApifyProfileRaw): NormalizedProfile {
  const { avgLikes, avgComments, engagementRate } = computeER(
    raw.latestPosts ?? [],
    raw.followersCount ?? 0,
  )

  const relatedHandles = (raw.relatedProfiles ?? [])
    .filter((r) => !r.is_private && typeof r.username === 'string' && r.username.length > 0)
    .map((r) => r.username)

  // Count hashtag frequency across all posts, then return top 10 by frequency.
  // Stopwords and duplicates are filtered; the result is an empty array when
  // latestPosts is missing or no posts contain hashtags (handled gracefully by prompt).
  const hashtagFreq: Record<string, number> = {}
  for (const post of raw.latestPosts ?? []) {
    for (const tag of (post.hashtags ?? [])) {
      if (typeof tag !== 'string') continue
      const t = tag.toLowerCase().replace(/^#/, '')
      if (t && !HASHTAG_STOPWORDS.has(t)) {
        hashtagFreq[t] = (hashtagFreq[t] ?? 0) + 1
      }
    }
  }
  const topHashtags = Object.entries(hashtagFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag]) => tag)

  // Most recent post date: max timestamp across latestPosts. NOT latestPosts[0] —
  // Instagram places pinned posts at the head of the array out of chronological
  // order, so [0] can be a year-old pinned post on an active account, which would
  // get the creator wrongly dropped by the dead-account gate in apifyClient.
  let lastPostDate: string | undefined
  let lastPostTime = -Infinity
  for (const post of raw.latestPosts ?? []) {
    if (!post.timestamp) continue
    const t = new Date(post.timestamp).getTime()
    if (Number.isFinite(t) && t > lastPostTime) {
      lastPostTime = t
      lastPostDate = post.timestamp
    }
  }

  return {
    username: raw.username ?? '',
    fullName: raw.fullName ?? '',
    biography: raw.biography ?? '',
    followersCount: raw.followersCount ?? 0,
    followsCount: raw.followsCount ?? 0,
    postsCount: raw.postsCount ?? 0,
    profilePicUrl: raw.profilePicUrl ?? '',
    verified: raw.verified ?? false,
    isBusinessAccount: raw.isBusinessAccount ?? false,
    avgLikes,
    avgComments,
    engagementRate,
    relatedHandles,
    topHashtags,
    lastPostDate,
  }
}

/**
 * Normalize an array of raw profiles.
 */
export function normalizeProfiles(raws: ApifyProfileRaw[]): NormalizedProfile[] {
  return raws.map(normalizeProfile).filter((p) => p.username.length > 0)
}
