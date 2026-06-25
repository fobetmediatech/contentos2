/**
 * Corpus store — the React-facing view over the async corpus repository.
 *
 * The corpus itself lives in Supabase (async). Components, though, need synchronous reads:
 * a "seen before (N×)" badge on a card, a remembered-count in the nav. So this store
 * hydrates once from storage into a plain map and then mirrors every write into it, giving
 * components instant, subscribable access without each one awaiting a remote call.
 *
 * `makeCorpusStore(repo)` is a factory so tests can inject an in-memory repository; the app
 * binds the default `useCorpusStore` to the runtime (Supabase) corpus.
 */

import { create } from 'zustand'
import { corpus } from '../lib/corpusIdb'
import type { CorpusRepository, CreatorInput, CreatorRecord, ContentRecord, Feedback } from '../lib/corpus'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'

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
  /** Set (or clear, with null) the user's verdict on a remembered creator, mirroring the
   *  updated record into synchronous state so cards re-render instantly (Phase 3). */
  setFeedback: (username: string, feedback: Feedback | null, at: number) => Promise<CreatorRecord | undefined>
  /** Voice profiles keyed by handle — synchronous mirror of the corpus_voice_profiles table. */
  voiceProfiles: Record<string, VoiceProfile>
  /** Upsert a voice profile through the repo and mirror it into synchronous state. */
  setVoiceProfile: (handle: string, profile: VoiceProfile) => Promise<void>
}

// 6.5: cap the in-memory recognition mirror to the most-recently-seen creators.
// The full corpus (possibly thousands of rows) is never needed client-side at once —
// only the "seen before" badge lookup (synchronous) requires a bounded in-memory set.
// The MemoryPage calls repo.list() directly with its own pagination.
const HYDRATION_CAP = 200

function keyBy(records: CreatorRecord[]): Record<string, CreatorRecord> {
  const map: Record<string, CreatorRecord> = {}
  for (const r of records) map[r.username] = r
  return map
}

function keyVoiceProfiles(profiles: VoiceProfile[]): Record<string, VoiceProfile> {
  const map: Record<string, VoiceProfile> = {}
  for (const p of profiles) map[p.handle] = p
  return map
}

export function makeCorpusStore(repo: CorpusRepository) {
  return create<CorpusState>((set, get) => ({
    creators: {},
    count: 0,
    hydrated: false,
    voiceProfiles: {},
    hydrate: async () => {
      if (get().hydrated) return
      const [slice, total, profiles] = await Promise.all([
        repo.list({ limit: HYDRATION_CAP }),
        repo.count(),
        repo.listVoiceProfiles(),
      ])
      set({ creators: keyBy(slice), count: total, voiceProfiles: keyVoiceProfiles(profiles), hydrated: true })
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
    setFeedback: async (username, feedback, at) => {
      const updated = await repo.setFeedback(username, feedback, at)
      // Mirror only on a real update (unknown creator → repo returns undefined → state untouched).
      if (updated) set({ creators: { ...get().creators, [updated.username]: updated } })
      return updated
    },
    setVoiceProfile: async (handle, profile) => {
      await repo.upsertVoiceProfile(handle, profile)
      set({ voiceProfiles: { ...get().voiceProfiles, [handle]: profile } })
    },
  }))
}

/** The app-wide corpus store, bound to the runtime (Supabase) corpus. */
export const useCorpusStore = makeCorpusStore(corpus)
