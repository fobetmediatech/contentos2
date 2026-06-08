/**
 * The corpus the app uses — now Supabase-backed (shared team brain).
 *
 * Filename kept as corpusIdb.ts so the two consumers (corpusStore.ts, MemoryPage.tsx)
 * that `import { corpus } from './corpusIdb'` need no change. The IndexedDB impl was
 * removed in the cloud-first migration; the pure in-memory double in corpus.ts covers
 * tests. createSupabaseCorpus() does no I/O at construction, so binding it at import
 * (before Clerk has a token) is safe.
 */
import { createSupabaseCorpus } from './supabaseCorpus'
import type { CorpusRepository } from './corpus'

export const corpus: CorpusRepository = createSupabaseCorpus()
