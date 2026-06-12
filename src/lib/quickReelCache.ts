/**
 * Quick-reel analysis cache (IndexedDB via idb).
 *
 * Caches the caption-only ReelAnalysis result per reel, versioned by REEL_ANALYSIS_PROMPT_VERSION.
 * Cache key: `${shortCode}@v${REEL_ANALYSIS_PROMPT_VERSION}` — bumping the version lazily
 * invalidates stale entries without an explicit migration.
 *
 * Degrades to a no-op when IndexedDB is unavailable (Node tests / SSR).
 */

import { openDB, type IDBPDatabase } from 'idb'
import { REEL_ANALYSIS_PROMPT_VERSION } from '../ai/prompts/reelAnalysis'
import type { ReelAnalysis } from '../store/reelAnalysisStore'

const DB_NAME = 'reel-intel'
const STORE = 'quick-analyses'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === 'undefined') return null
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      },
    })
  }
  return dbPromise
}

function cacheKey(shortCode: string): string {
  return `${shortCode}@v${REEL_ANALYSIS_PROMPT_VERSION}`
}

/** Cached quick analysis for a reel, or undefined on miss / no IndexedDB / error. */
export async function getCachedQuick(shortCode: string): Promise<ReelAnalysis | undefined> {
  const p = getDb()
  if (!p) return undefined
  try {
    const db = await p
    return (await db.get(STORE, cacheKey(shortCode))) as ReelAnalysis | undefined
  } catch {
    return undefined
  }
}

/** Persist a reel's quick analysis. No-ops on no IndexedDB / write error (never throws). */
export async function setCachedQuick(shortCode: string, analysis: ReelAnalysis): Promise<void> {
  const p = getDb()
  if (!p) return
  try {
    const db = await p
    await db.put(STORE, analysis, cacheKey(shortCode))
  } catch {
    /* cache writes are best-effort */
  }
}

/** Clear the quick-analysis cache (e.g. a force-reanalyze action). */
export async function clearQuickCache(): Promise<void> {
  const p = getDb()
  if (!p) return
  try {
    const db = await p
    await db.clear(STORE)
  } catch {
    /* ignore */
  }
}
