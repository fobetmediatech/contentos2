/**
 * tracking-cron — Supabase Edge Function (Deno).
 *
 * Invoked by the GitHub Action (.github/workflows/tracking-cron.yml) on a fixed
 * 6-hourly schedule. Finds every tracked account whose `next_fetch_at <= now()`
 * and runs the profile + reel scrapers for it, writing time-series snapshots.
 *
 * This is the SERVER-SIDE scrape path. It is deliberately separate from the
 * browser path in src/lib/trackingClient.ts (which runs on "Add" / "Fetch now"
 * through the Clerk-gated /api/apify proxy + browser keyRotator). The browser
 * keyRotator (which reads browser/Zustand state) must NOT be ported here — this
 * file implements its own self-contained round-robin + failover over APIFY_KEYS.
 *
 * Auth:   Authorization: Bearer <TRACKING_CRON_SECRET>
 * Secrets (set via `supabase secrets set`):
 *   - TRACKING_CRON_SECRET   shared secret matching the GitHub Action
 *   - APIFY_KEYS             comma-separated Apify API tokens (rotated + failed
 *                            over). APIFY_TOKEN (single) is accepted as a fallback.
 * Auto-injected by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   (service role bypasses RLS — the cron has no Clerk JWT).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Cap accounts processed per invocation so two synchronous Apify runs each can't
// blow the Edge wall-clock limit. Remaining due accounts are picked up next tick.
const MAX_ACCOUNTS_PER_RUN = 10
// Per-actor synchronous-run timeout (ms). Apify allows up to 300s; we stay well under.
const ACTOR_TIMEOUT_MS = 90_000
// HTTP statuses worth failing over to the next key (auth / quota / transient).
// 4xx like 400/404 are NOT here — they won't change across keys, so we surface them.
const ROTATE_STATUSES = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504])

/** Round-robin cursor over a pool of Apify tokens, shared across one invocation. */
interface KeyRing {
  keys: string[]
  i: number
}

interface RawProfile {
  fullName?: string
  profilePicUrl?: string
  biography?: string
  verified?: boolean
  isVerified?: boolean
  isBusinessAccount?: boolean
  followersCount?: number
  postsCount?: number
  followsCount?: number
}

interface RawReel {
  url?: string
  shortCode?: string
  timestamp?: string
  // The actor returns these counts as STRINGS — coerced via toInt() below.
  likesCount?: number | string
  commentsCount?: number | string
  videoViewCount?: number | string
  playCount?: number | string
  viewCount?: number | string
  thumbnailUrl?: string
  displayUrl?: string
}

/** Coerce an Apify count (number or numeric string) to a safe non-negative int. */
function toInt(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

interface TrackedAccount {
  username: string
  scrape_window_days: number
  scrape_interval_days: number
}

/**
 * Run an Apify actor synchronously, rotating through the key ring with failover.
 * Each call advances the shared cursor (so load spreads across accounts/actors),
 * and on a quota/auth/transient failure it retries with the next key. A response
 * that is a JSON error object (e.g. "Monthly usage hard limit exceeded" returned
 * with a 200) also triggers failover. Permanent client errors (400/404) surface
 * immediately — trying other keys would just waste them.
 */
async function apifyRunSync<T>(
  actorId: string,
  input: Record<string, unknown>,
  ring: KeyRing,
): Promise<T[]> {
  let lastErr = 'no keys configured'
  for (let attempt = 0; attempt < ring.keys.length; attempt++) {
    const token = ring.keys[ring.i % ring.keys.length]
    ring.i++ // advance round-robin for the next call/attempt
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ACTOR_TIMEOUT_MS)
    let permanent: string | null = null
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: ctrl.signal,
        },
      )
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) return data as T[]
        // e.g. { error: { type: "platform-feature-disabled", message: "Monthly usage hard limit exceeded" } }
        lastErr =
          (data && typeof data === 'object' && (data.error?.message as string)) ||
          'non-array response'
      } else if (ROTATE_STATUSES.has(res.status)) {
        lastErr = `HTTP ${res.status}`
      } else {
        permanent = `HTTP ${res.status} ${res.statusText}`
      }
    } catch (e) {
      lastErr =
        e instanceof Error
          ? e.name === 'AbortError'
            ? `timeout after ${ACTOR_TIMEOUT_MS}ms`
            : e.message
          : String(e)
    } finally {
      clearTimeout(timer)
    }
    if (permanent) throw new Error(`Apify ${actorId} failed: ${permanent}`)
  }
  throw new Error(`Apify ${actorId}: all ${ring.keys.length} key(s) failed (${lastErr})`)
}

function normalizeReel(raw: RawReel, username: string, fetchedAt: string) {
  const reelUrl =
    raw.url ?? (raw.shortCode ? `https://www.instagram.com/reel/${raw.shortCode}/` : '')
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

async function fetchOneAccount(
  supabase: ReturnType<typeof createClient>,
  account: TrackedAccount,
  ring: KeyRing,
) {
  const { username, scrape_window_days, scrape_interval_days } = account
  const fetchedAt = new Date().toISOString()
  // On both success and failure we advance next_fetch_at by the interval so a
  // broken account backs off instead of being re-scraped every 6h forever.
  const nextFetchAt = new Date(
    Date.now() + scrape_interval_days * 24 * 60 * 60 * 1000,
  ).toISOString()

  try {
    // --- Profile ---
    const profileItems = await apifyRunSync<RawProfile>(
      'apify~instagram-profile-scraper',
      { usernames: [username], resultsType: 'details' },
      ring,
    )
    if (!profileItems.length) {
      throw new Error('Account not found, private, or returned no data')
    }
    const raw = profileItems[0]

    // --- Reels (best-effort) ---
    const fromDate = new Date(Date.now() - scrape_window_days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]
    let reelRows: ReturnType<typeof normalizeReel>[] = []
    try {
      const reelItems = await apifyRunSync<RawReel>(
        'apify~instagram-reel-scraper',
        // username must be a string ARRAY; date filter is `onlyPostsNewerThan`.
        { username: [username], resultsLimit: 50, onlyPostsNewerThan: fromDate },
        ring,
      )
      reelRows = reelItems
        .filter((r) => r.url ?? r.shortCode)
        .map((r) => normalizeReel(r, username, fetchedAt))
    } catch (reelErr) {
      console.warn(`[tracking-cron] reel scrape failed for ${username}:`, reelErr)
    }

    // --- Persist (account snapshot once; reels only if any) ---
    const { error: snapErr } = await supabase.from('account_snapshots').insert({
      username,
      fetched_at: fetchedAt,
      followers_count: raw.followersCount ?? 0,
      posts_count: raw.postsCount ?? 0,
      follows_count: raw.followsCount ?? 0,
      raw_payload: raw,
    })
    if (snapErr) throw snapErr
    if (reelRows.length > 0) {
      const { error: reelErr } = await supabase.from('reel_snapshots').insert(reelRows)
      if (reelErr) throw reelErr
    }

    // --- Profile metadata + clear error + schedule next ---
    const { error: updErr } = await supabase
      .from('tracked_accounts')
      .update({
        full_name: raw.fullName ?? null,
        profile_pic_url: raw.profilePicUrl ?? null,
        biography: raw.biography ?? null,
        is_verified: raw.verified ?? raw.isVerified ?? false,
        is_business: raw.isBusinessAccount ?? false,
        last_error: null,
        last_error_at: null,
        next_fetch_at: nextFetchAt,
      })
      .eq('username', username)
    if (updErr) throw updErr

    return { username, ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[tracking-cron] fetch failed for ${username}:`, msg)
    await supabase
      .from('tracked_accounts')
      .update({ last_error: msg, last_error_at: fetchedAt, next_fetch_at: nextFetchAt })
      .eq('username', username)
    return { username, ok: false, error: msg }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const cronSecret = Deno.env.get('TRACKING_CRON_SECRET')
  const auth = req.headers.get('Authorization')
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Prefer the rotated pool (APIFY_KEYS); fall back to a single APIFY_TOKEN.
  const apifyKeys = (Deno.env.get('APIFY_KEYS') ?? Deno.env.get('APIFY_TOKEN') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!apifyKeys.length || !supabaseUrl || !serviceKey) {
    return new Response('Server misconfigured: missing APIFY_KEYS / Supabase env', {
      status: 500,
    })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // Accounts due now, oldest-due first so nothing starves under the per-run cap.
  const { data: due, error } = await supabase
    .from('tracked_accounts')
    .select('username, scrape_window_days, scrape_interval_days')
    .lte('next_fetch_at', new Date().toISOString())
    .order('next_fetch_at', { ascending: true })
    .limit(MAX_ACCOUNTS_PER_RUN)
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const accounts = (due ?? []) as TrackedAccount[]
  // One shared ring across the whole invocation so rotation continues account to
  // account (not just within a single account's two scrapes).
  const ring: KeyRing = { keys: apifyKeys, i: 0 }
  // Sequential: two synchronous scrapes per account would otherwise contend for
  // both the Apify rate limit and the Edge wall-clock budget.
  const results = []
  for (const account of accounts) {
    results.push(await fetchOneAccount(supabase, account, ring))
  }

  return new Response(
    JSON.stringify({
      processed: results.length,
      capped: accounts.length === MAX_ACCOUNTS_PER_RUN,
      results,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
