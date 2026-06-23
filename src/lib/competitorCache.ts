/**
 * Competitor profile cache (IndexedDB via idb) — per-conversation shown-set.
 *
 * After each competitor analysis run, the shown profiles (username → category) are written
 * here. On the next run for the same handles in the same conversation, those usernames are
 * excluded from the Gemini ranking step (so only fresh profiles surface), and the per-category
 * counts drive how many MORE established (top) / growing (trending) accounts to fetch.
 *
 * Cache is keyed by conversationId + sorted/normalized input handles. Starting a new
 * conversation resets the slate — by design, per user requirement.
 *
 * Degrades to a no-op when IndexedDB is unavailable (Node tests / SSR) — callers
 * always fall back to existing behavior, never crash.
 */

import { openDB, type IDBPDatabase } from 'idb'
import { devLog } from './devLog'

const DB_NAME = 'competitor-intel'
const STORE = 'shown-profiles'
const VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === 'undefined') return null
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      },
    })
  }
  return dbPromise
}

function cacheKey(conversationId: string, handles: string[]): string {
  const normalized = handles
    .map((h) => h.toLowerCase().replace(/^@/, ''))
    .sort()
    .join(',')
  return `${conversationId}::${normalized}`
}

export type ShownCategory = 'top' | 'trending'

/**
 * Returns the map of lowercased username → category already shown in previous runs for this
 * conversationId + handle-set combination. Returns {} on cache miss, IDB unavailability, any
 * read error, OR a legacy string[] entry (pre-category) — callers treat it as "no prior history".
 */
export async function getShownProfiles(
  conversationId: string,
  handles: string[],
): Promise<Record<string, ShownCategory>> {
  const p = getDb()
  if (!p) return {}
  try {
    const db = await p
    const stored = await db.get(STORE, cacheKey(conversationId, handles))
    // Legacy entries were string[] (pre-category). Ignore them safely (treat as empty).
    if (!stored || Array.isArray(stored) || typeof stored !== 'object') return {}
    return stored as Record<string, ShownCategory>
  } catch (err) {
    devLog('[competitorCache] read error', err)
    return {}
  }
}

/**
 * Merges shown `{ username, category }` entries into the map for this conversationId + handle
 * combination. Successive runs accumulate. No-ops on IDB unavailability or write error.
 */
export async function addShownProfiles(
  conversationId: string,
  handles: string[],
  entries: { username: string; category: ShownCategory }[],
): Promise<void> {
  const p = getDb()
  if (!p) return
  try {
    const db = await p
    const key = cacheKey(conversationId, handles)
    const prev = await getShownProfiles(conversationId, handles)
    const merged = { ...prev }
    for (const e of entries) merged[e.username.toLowerCase()] = e.category
    await db.put(STORE, merged, key)
  } catch (err) {
    devLog('[competitorCache] write error', err)
  }
}
