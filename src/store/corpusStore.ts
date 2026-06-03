/**
 * Corpus store — the React-facing view over the async corpus repository.
 *
 * The corpus itself lives in IndexedDB (async). Components, though, need synchronous reads:
 * a "seen before (N×)" badge on a card, a remembered-count in the nav. So this store
 * hydrates once from storage into a plain map and then mirrors every write into it, giving
 * components instant, subscribable access without each one awaiting IndexedDB.
 *
 * `makeCorpusStore(repo)` is a factory so tests can inject an in-memory repository; the app
 * binds the default `useCorpusStore` to the runtime (IndexedDB) corpus.
 */

import { create } from 'zustand'
import { corpus } from '../lib/corpusIdb'
import type { CorpusRepository, CreatorInput, CreatorRecord, ContentRecord } from '../lib/corpus'

export interface CorpusState {
  /** Remembered creators keyed by username — the synchronous mirror of the corpus. */
  creators: Record<string, CreatorRecord>
  count: number
  hydrated: boolean
  /** Load the full corpus into state once (call on app mount). */
  hydrate: () => Promise<void>
  /** Persist a batch of sightings and mirror the merged records into state. */
  remember: (inputs: CreatorInput[]) => Promise<CreatorRecord[]>
  /** Persist analyzed reel content tied to creators (the corpus content half). */
  rememberContent: (records: ContentRecord[]) => Promise<void>
}

function keyBy(records: CreatorRecord[]): Record<string, CreatorRecord> {
  const map: Record<string, CreatorRecord> = {}
  for (const r of records) map[r.username] = r
  return map
}

export function makeCorpusStore(repo: CorpusRepository) {
  return create<CorpusState>((set, get) => ({
    creators: {},
    count: 0,
    hydrated: false,
    hydrate: async () => {
      const all = await repo.list()
      set({ creators: keyBy(all), count: all.length, hydrated: true })
    },
    remember: async (inputs) => {
      const merged = await repo.remember(inputs)
      const creators = { ...get().creators, ...keyBy(merged) }
      set({ creators, count: Object.keys(creators).length })
      return merged
    },
    rememberContent: async (records) => {
      // Content isn't mirrored into synchronous state (no UI reads it live yet) — straight
      // write-through to the repo. A future Memory page reads it via repo.listContentFor.
      await repo.rememberContent(records)
    },
  }))
}

/** The app-wide corpus store, bound to the runtime (IndexedDB) corpus. */
export const useCorpusStore = makeCorpusStore(corpus)
