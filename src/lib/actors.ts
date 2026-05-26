/**
 * Apify actor IDs — confirmed from real data + Apify store research.
 *
 * NOTE: Apify actor IDs use ~ as the username/name separator, NOT /
 *   apify/instagram-profile-scraper  → 404
 *   apify~instagram-profile-scraper  → 200 ✓
 *
 * Profile Scraper: apify~instagram-profile-scraper
 *   - 138K+ users, 99.7% success rate
 *   - Input: { usernames: string[] }
 *   - Output: ProfileApifyRaw[] (see transformers.ts for field map)
 *
 * Hashtag Scraper: apify~instagram-hashtag-scraper
 *   - 58K total users, maintained by Apify
 *   - Input: { hashtags: string[], resultsType: "posts", resultsLimit: number }
 *   - Output: post objects with ownerUsername field (plus engagement metrics)
 *   - Used for content-niche pool expansion: extracts post authors from
 *     hashtags that reference accounts actually post about, surfacing
 *     accounts that audience-adjacency graphs (relatedProfiles) miss.
 */
export const ACTORS = {
  PROFILE_SCRAPER: 'apify~instagram-profile-scraper',
  HASHTAG_SCRAPER: 'apify~instagram-hashtag-scraper',
} as const

/**
 * Build the input payload for the Profile Scraper actor.
 * Actor accepts an array of Instagram usernames (without @).
 */
export function buildProfileScraperInput(usernames: string[]): Record<string, unknown> {
  return {
    usernames: usernames.map((u) => u.replace(/^@/, '')),
    resultsLimit: 1, // one result per username (profile data)
  }
}

/**
 * Build the input payload for the Hashtag Scraper actor.
 *
 * @param hashtags     Plain hashtag strings without # (e.g. ['productivity', 'marketing'])
 * @param resultsLimit Max posts per hashtag (each post yields one ownerUsername candidate)
 */
export function buildHashtagScraperInput(
  hashtags: string[],
  resultsLimit: number,
): Record<string, unknown> {
  return {
    hashtags: hashtags.map((h) => h.replace(/^#/, '')), // strip # if present
    resultsType: 'posts',
    resultsLimit,
  }
}
