/**
 * Single-reel case-study cache (IndexedDB via idb).
 *
 * A reel's analysis is immutable (the video doesn't change), so we cache the full
 * SingleReelResult forever, keyed by shortCode + prompt version. Re-pasting a URL is
 * then free (skips the Apify scrape + both Gemini calls). No-ops when IndexedDB is
 * unavailable (Node tests / SSR) — callers always fall back to a live run.
 *
 * Uses its own IndexedDB DB ('reel-intel-single') for cached single-reel results.
 */

import { openDB, type IDBPDatabase } from 'idb'
import type { SingleReelResult } from '../domain/reel'

// Keep in sync with SINGLE_REEL_PROMPT_VERSION in api/_lib/singleReelPrompt.ts —
// bump when the extraction/synthesis prompts change so stale entries lazily invalidate.
const SINGLE_REEL_PROMPT_VERSION = 1

const DB_NAME = 'reel-intel-single'
const STORE = 'single-reel'
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

function cacheKey(shortCode: string): string {
  return `${shortCode}@v${SINGLE_REEL_PROMPT_VERSION}`
}

/** Cached single-reel result, or undefined on miss / no IndexedDB / error. */
export async function getCachedSingleReel(shortCode: string): Promise<SingleReelResult | undefined> {
  const p = getDb()
  if (!p) return undefined
  try {
    const db = await p
    return (await db.get(STORE, cacheKey(shortCode))) as SingleReelResult | undefined
  } catch {
    return undefined
  }
}

/** Persist a single-reel result. No-ops on no IndexedDB / write error (never throws). */
export async function setCachedSingleReel(shortCode: string, result: SingleReelResult): Promise<void> {
  const p = getDb()
  if (!p) return
  try {
    const db = await p
    await db.put(STORE, result, cacheKey(shortCode))
  } catch {
    /* best-effort */
  }
}
