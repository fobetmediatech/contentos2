/**
 * IndexedDB-backed corpus + the runtime-selected default `corpus` instance.
 *
 * Split out from corpus.ts so the pure logic + memory impl stay free of the `idb` import
 * (and thus load anywhere — jsdom, Node test scripts). Every dedupe/sort rule is reused
 * from corpus.ts; this file is ONLY the IndexedDB plumbing (open, read, merge, write).
 */

import { openDB, type IDBPDatabase } from 'idb'
import {
  mergeCreator,
  applyFeedback,
  sortCreators,
  createMemoryCorpus,
  type CorpusRepository,
  type CreatorRecord,
  type ContentRecord,
} from './corpus'

const DB_NAME = 'contentos-corpus'
const STORE = 'creators'
const CONTENT_STORE = 'content'
const DB_VERSION = 2

function openCorpusDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    // Idempotent upgrades — each guarded by a contains() check, so a fresh DB and a v1→v2
    // upgrade both arrive at the same schema (creators + content with a by-creator index).
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by username → a put() with the same username upserts (dedupe for free).
        db.createObjectStore(STORE, { keyPath: 'username' })
      }
      if (!db.objectStoreNames.contains(CONTENT_STORE)) {
        // Keyed by id (reel shortCode); indexed by creator so listContentFor is a range query.
        const cs = db.createObjectStore(CONTENT_STORE, { keyPath: 'id' })
        cs.createIndex('byCreator', 'creatorUsername')
      }
    },
  })
}

export function createIdbCorpus(): CorpusRepository {
  // Open lazily and once per instance — constructing the corpus opens no connection.
  let dbp: Promise<IDBPDatabase> | null = null
  const db = () => (dbp ??= openCorpusDb())

  return {
    async remember(inputs) {
      const d = await db()
      const tx = d.transaction(STORE, 'readwrite')
      const out: CreatorRecord[] = []
      for (const input of inputs) {
        const existing = (await tx.store.get(input.profile.username)) as CreatorRecord | undefined
        const merged = mergeCreator(existing, input)
        await tx.store.put(merged)
        out.push(merged)
      }
      await tx.done
      return out
    },
    async get(username) {
      return (await db()).get(STORE, username) as Promise<CreatorRecord | undefined>
    },
    async getMany(usernames) {
      const d = await db()
      const recs = await Promise.all(
        usernames.map((u) => d.get(STORE, u) as Promise<CreatorRecord | undefined>),
      )
      return recs.filter((r): r is CreatorRecord => r !== undefined)
    },
    async setFeedback(username, feedback, at) {
      const d = await db()
      const tx = d.transaction(STORE, 'readwrite')
      const existing = (await tx.store.get(username)) as CreatorRecord | undefined
      if (!existing) {
        await tx.done
        return undefined // never mint a profileless record from a verdict alone
      }
      const updated = applyFeedback(existing, feedback, at)
      await tx.store.put(updated)
      await tx.done
      return updated
    },
    async list(opts) {
      const all = (await (await db()).getAll(STORE)) as CreatorRecord[]
      return sortCreators(all, opts?.sort, opts?.limit)
    },
    async count() {
      return (await db()).count(STORE)
    },
    async rememberContent(records) {
      if (records.length === 0) return
      const d = await db()
      const tx = d.transaction(CONTENT_STORE, 'readwrite')
      for (const r of records) await tx.store.put(r)
      await tx.done
    },
    async listContentFor(creatorUsername) {
      const list = (await (await db()).getAllFromIndex(CONTENT_STORE, 'byCreator', creatorUsername)) as ContentRecord[]
      return list.sort((a, b) => b.analyzedAt - a.analyzedAt)
    },
    async clear() {
      const d = await db()
      await Promise.all([d.clear(STORE), d.clear(CONTENT_STORE)])
    },
  }
}

/**
 * The corpus the app uses. IndexedDB in the browser; in-memory in a Node runtime without
 * IndexedDB (the test:* scripts) so imports never explode. Unit tests that need real
 * persistence semantics construct createIdbCorpus() directly against fake-indexeddb.
 */
export const corpus: CorpusRepository =
  typeof indexedDB !== 'undefined' ? createIdbCorpus() : createMemoryCorpus()
