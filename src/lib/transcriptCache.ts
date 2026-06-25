/**
 * Transcript cache (IndexedDB via idb).
 *
 * Keyed by shortCode + prompt version. A cache hit means the Apify scrape + Gemini
 * upload is skipped entirely — transcript is served instantly. No-ops when IndexedDB
 * is unavailable (Node tests / SSR).
 *
 * Also checks singleReelCache as a secondary fallback: if the user has already done
 * a full analysis of this reel, the transcript is extracted from that result for free.
 */

import { openDB, type IDBPDatabase } from 'idb'
import type { TranscriptResult } from '../store/transcriptStore'
import { getCachedSingleReel } from './singleReelCache'

// Keep in sync with TRANSCRIPT_PROMPT_VERSION in api/_lib/transcriptPrompt.ts
const TRANSCRIPT_PROMPT_VERSION = 2

const DB_NAME = 'reel-intel-transcript'
const STORE = 'transcript'
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
  return `${shortCode}@v${TRANSCRIPT_PROMPT_VERSION}`
}

/**
 * Look up a transcript by shortCode. Checks the transcript-specific cache first,
 * then falls back to the full-analysis cache (singleReelCache) to avoid re-uploading
 * a video the user has already analyzed.
 */
export async function getCachedTranscript(shortCode: string): Promise<TranscriptResult | undefined> {
  // 1. Primary: transcript-specific cache
  const p = getDb()
  if (p) {
    try {
      const db = await p
      const hit = (await db.get(STORE, cacheKey(shortCode))) as TranscriptResult | undefined
      if (hit) return hit
    } catch {
      // fall through to secondary
    }
  }

  // 2. Secondary: full-analysis cache — extract transcript + segments if available
  try {
    const full = await getCachedSingleReel(shortCode)
    if (full && (full.transcript || full.segments.length > 0)) {
      return { transcript: full.transcript, segments: full.segments }
    }
  } catch {
    // fall through to miss
  }

  return undefined
}

/** Persist a transcript result. No-ops on no IndexedDB / write error (never throws). */
export async function setCachedTranscript(shortCode: string, result: TranscriptResult): Promise<void> {
  const p = getDb()
  if (!p) return
  try {
    const db = await p
    await db.put(STORE, result, cacheKey(shortCode))
  } catch {
    /* best-effort */
  }
}
