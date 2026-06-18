/**
 * Browser-side Apify orchestration for the tracking dashboard.
 * Runs two actors per fetch: instagram-profile-scraper + instagram-reel-scraper.
 * Both calls go through /api/apify (Clerk-gated server proxy).
 */
import { startRun, pollRun, fetchDataset } from './apifyCore'
import { supabase } from './supabaseClient'
import {
  insertAccountSnapshot,
  insertReelSnapshots,
  markFetchError,
  clearFetchError,
  setNextFetchAt,
  type TrackedAccount,
  type AccountSnapshot,
  type ReelSnapshot,
} from './trackingDb'

// ---------- Raw actor output types ----------

interface RawProfile {
  username?: string
  fullName?: string
  profilePicUrl?: string
  biography?: string
  verified?: boolean
  isVerified?: boolean
  isBusinessAccount?: boolean
  followersCount?: number
  postsCount?: number
  followsCount?: number
  private?: boolean
}

interface RawReel {
  url?: string
  videoUrl?: string
  shortCode?: string
  timestamp?: string
  // NB: the actor returns these counts as STRINGS (e.g. "136591"), so they are
  // typed loosely and coerced via toInt() in normalizeReel.
  likesCount?: number | string
  commentsCount?: number | string
  videoViewCount?: number | string
  playCount?: number | string
  viewCount?: number | string
  thumbnailUrl?: string
  displayUrl?: string
  ownerUsername?: string
  type?: string
}

/** Coerce an Apify count (number or numeric string) to a safe non-negative int. */
function toInt(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

// ---------- Fetch status for UI progress ----------

export type FetchPhase = 'profile' | 'reels' | 'saving' | 'done' | 'error'

export interface FetchStatus {
  phase: FetchPhase
  error?: string
}

// ---------- Normalizers ----------

// NOTE: intentionally separate from lib/transformers.ts `normalizeProfile`. That one
// builds the heavier `NormalizedProfile` domain model (ER, related handles, hashtags)
// in camelCase for the analysis pipelines; this maps directly to the snake_case
// `tracked_accounts` columns. Different output shapes — do not collapse into one.
function normalizeProfile(raw: RawProfile, username: string) {
  return {
    username,
    full_name: raw.fullName ?? null,
    profile_pic_url: raw.profilePicUrl ?? null,
    biography: raw.biography ?? null,
    is_verified: raw.verified ?? raw.isVerified ?? false,
    is_business: raw.isBusinessAccount ?? false,
  }
}

function normalizeReel(raw: RawReel, username: string, fetchedAt: string): Omit<ReelSnapshot, 'id'> {
  const reelUrl =
    raw.url ??
    (raw.shortCode ? `https://www.instagram.com/reel/${raw.shortCode}/` : '')
  return {
    username,
    fetched_at: fetchedAt,
    reel_url: reelUrl,
    thumbnail_url: raw.thumbnailUrl ?? raw.displayUrl ?? null,
    posted_at: raw.timestamp ?? null,
    views_count: toInt(raw.videoViewCount ?? raw.playCount ?? raw.viewCount),
    likes_count: toInt(raw.likesCount),
    comments_count: toInt(raw.commentsCount),
    raw_payload: raw as Record<string, unknown>,
  }
}

// ---------- Main fetch orchestrator ----------

export async function runAccountFetch(
  account: TrackedAccount,
  onStatus: (s: FetchStatus) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { username, scrape_window_days, scrape_interval_days } = account
  const fetchedAt = new Date().toISOString()

  try {
    // --- Phase 1: profile scraper ---
    onStatus({ phase: 'profile' })
    const profileInput = { usernames: [username], resultsType: 'details' }
    const profileRun = await startRun('apify~instagram-profile-scraper', profileInput, '', signal)
    await pollRun(profileRun.runId, '', signal, undefined, profileRun.keyIndex)
    const profileItems = await fetchDataset<RawProfile>(
      profileRun.datasetId, '', signal, profileRun.keyIndex,
    )

    if (!profileItems.length) {
      throw new Error('Account not found, private, or returned no data')
    }

    const rawProfile = profileItems[0]
    const profileMeta = normalizeProfile(rawProfile, username)

    const snapshotRow: Omit<AccountSnapshot, 'id'> = {
      username,
      fetched_at: fetchedAt,
      followers_count: rawProfile.followersCount ?? 0,
      posts_count: rawProfile.postsCount ?? 0,
      follows_count: rawProfile.followsCount ?? 0,
      raw_payload: rawProfile as Record<string, unknown>,
    }

    // --- Phase 2: reel scraper (best-effort) ---
    onStatus({ phase: 'reels' })
    const fromDate = new Date(Date.now() - scrape_window_days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]

    // apify~instagram-reel-scraper schema: `username` is a required string ARRAY,
    // and the date filter field is `onlyPostsNewerThan` (a YYYY-MM-DD datepicker).
    // (Earlier code sent username as a string + nonexistent from/fromDate/dateFrom/
    // maxItems fields, which the actor rejected with HTTP 400 → zero reels saved.)
    const reelInput = {
      username: [username],
      resultsLimit: 50,
      onlyPostsNewerThan: fromDate,
    }

    // A reel-scrape failure must NOT lose the profile snapshot — and must NOT
    // double-write it. Collect reels best-effort, then persist exactly once below.
    let reelRows: Omit<ReelSnapshot, 'id'>[] = []
    try {
      const reelRun = await startRun('apify~instagram-reel-scraper', reelInput, '', signal)
      await pollRun(reelRun.runId, '', signal, undefined, reelRun.keyIndex)
      const reelItems = await fetchDataset<RawReel>(
        reelRun.datasetId, '', signal, reelRun.keyIndex,
      )
      reelRows = reelItems
        .filter((r) => r.url ?? r.shortCode)
        .map((r) => normalizeReel(r, username, fetchedAt))
    } catch (reelErr) {
      // Non-fatal: leave reelRows empty; the profile snapshot still saves below.
      console.warn('[tracking] reel scraper failed:', reelErr)
    }

    // --- Phase 3: persist (account snapshot exactly once; reels only if any) ---
    onStatus({ phase: 'saving' })
    await insertAccountSnapshot(snapshotRow)
    if (reelRows.length > 0) await insertReelSnapshots(reelRows)

    // --- Schedule next run + write profile metadata back to tracked_accounts ---
    await clearFetchError(username)
    await setNextFetchAt(username, scrape_interval_days)
    await supabase
      .from('tracked_accounts')
      .update(profileMeta)
      .eq('username', username)

    onStatus({ phase: 'done' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Guard the error-record write so a logging failure can't mask the real error.
    try {
      await markFetchError(username, msg)
    } catch (markErr) {
      console.warn('[tracking] failed to record fetch error:', markErr)
    }
    onStatus({ phase: 'error', error: msg })
    throw err
  }
}
