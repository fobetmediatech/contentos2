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
  // REEL_SCRAPER scrapes a PROFILE to LIST reels (caption + metrics + permalink).
  // It does NOT download videos. Despite the name it is the generic instagram-scraper.
  REEL_SCRAPER: 'apify~instagram-scraper',
  // REEL_VIDEO_SCRAPER is a DIFFERENT actor that, given DIRECT reel URLs, can
  // download each reel's video (includeDownloadedVideo) to a stable Apify URL.
  // Use it ONLY with direct /reel/<shortcode>/ URLs (profile scrapes get IG-blocked).
  REEL_VIDEO_SCRAPER: 'apify~instagram-reel-scraper',
  // SEARCH_SCRAPER finds ACCOUNTS by keyword (searchType:'user'). Same underlying actor as
  // REEL_SCRAPER (apify~instagram-scraper) — already on the server allowlist — multiplexed by
  // input: `search` + `searchType` does account search; `directUrls` does profile/posts. The two
  // input shapes are mutually exclusive (never pass both). Output rows carry `username`.
  SEARCH_SCRAPER: 'apify~instagram-scraper',
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
 * Build the input payload for the Reel Scraper actor.
 *
 * @param handle  Instagram handle (with or without @)
 * @param limit   Max number of posts/reels to retrieve
 */
export function buildReelScraperInput(handle: string, limit: number): Record<string, unknown> {
  return {
    directUrls: [`https://www.instagram.com/${handle.replace(/^@/, '')}/`],
    resultsType: 'posts',
    resultsLimit: limit,
  }
}

/**
 * Build the input payload for the Reel VIDEO Scraper actor (apify~instagram-reel-scraper).
 *
 * Pass DIRECT reel URLs (the `username` field accepts reel URLs, processed individually).
 * `includeDownloadedVideo` makes the actor store each reel's video as a stable, public
 * api.apify.com record (Phase-0 spike: 200 video/mp4, CORS-*, no token, retained days).
 *
 * @param reelUrls  Direct /reel/<shortcode>/ permalink URLs (from scrapeTopReels)
 */
export function buildReelVideoScraperInput(reelUrls: string[]): Record<string, unknown> {
  return {
    username: reelUrls,
    includeDownloadedVideo: true,
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

/**
 * Build the input for analyzing ONE reel by direct URL (apify~instagram-reel-scraper).
 *
 * Same actor as buildReelVideoScraperInput but for a single permalink — returns the
 * reel's metadata AND a stable api.apify.com downloaded-video URL (includeDownloadedVideo).
 */
export function buildSingleReelInput(reelUrl: string): Record<string, unknown> {
  return {
    username: [reelUrl],
    includeDownloadedVideo: true,
  }
}

/**
 * Build the input for the keyword/account Search Scraper (apify~instagram-scraper, searchType:'user').
 *
 * `search` + `searchType:'user'` returns ACCOUNTS matching the keyword (rows carry `username`).
 * Do NOT pass `directUrls` here — `search` and `directUrls` are mutually exclusive in this actor.
 *
 * @param keyword       The niche/keyword to search accounts for (e.g. "fitness coach")
 * @param searchLimit   Max accounts to return (kept small — this is one serial Apify run)
 */
export function buildSearchScraperInput(keyword: string, searchLimit: number): Record<string, unknown> {
  return {
    search: keyword,
    searchType: 'user',
    searchLimit,
    resultsType: 'details',
  }
}
