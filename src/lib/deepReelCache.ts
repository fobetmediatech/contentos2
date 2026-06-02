/**
 * Deep-reel analysis cache (IndexedDB via idb) — Phase 2.
 *
 * Multimodal analysis of a given reel is IMMUTABLE (the video doesn't change), so we
 * cache the StoredDeepReelAnalysis forever, keyed by shortCode. This is both:
 *   - R3: re-running a report reuses cached reels -> skips the Apify video scrape +
 *     the Gemini call entirely (the expensive parts) -> near-free re-runs.
 *   - R2: the resume mechanism — a tab closed mid-run keeps its done reels; on the next
 *     run only the uncached reels re-run.
 *
 * Degrades to a no-op when indexedDB is unavailable (Node tests / SSR) — callers always
 * fall back to a live analysis, never crash.
 */

import { openDB, type IDBPDatabase } from 'idb'
import type { StoredDeepReelAnalysis } from '../store/reelAnalysisStore'

const DB_NAME = 'reel-intel'
const STORE = 'deep-analyses'
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

/** Cached deep analysis for a reel, or undefined on miss / no IndexedDB / error. */
export async function getCachedDeep(shortCode: string): Promise<StoredDeepReelAnalysis | undefined> {
  const p = getDb()
  if (!p) return undefined
  try {
    const db = await p
    return (await db.get(STORE, shortCode)) as StoredDeepReelAnalysis | undefined
  } catch {
    return undefined
  }
}

/** Persist a reel's deep analysis. No-ops on no IndexedDB / write error (never throws). */
export async function setCachedDeep(shortCode: string, analysis: StoredDeepReelAnalysis): Promise<void> {
  const p = getDb()
  if (!p) return
  try {
    const db = await p
    await db.put(STORE, analysis, shortCode)
  } catch {
    /* cache writes are best-effort */
  }
}

/** Clear the whole deep cache (e.g. a "force re-analyze" action). */
export async function clearDeepCache(): Promise<void> {
  const p = getDb()
  if (!p) return
  try {
    const db = await p
    await db.clear(STORE)
  } catch {
    /* ignore */
  }
}
