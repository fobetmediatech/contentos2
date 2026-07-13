/**
 * Creator directory store — synchronous Zustand mirror over the team-shared directory repo.
 * Mirrors makeCorpusStore: factory takes the repo (injectable in tests), hydrate-once, mirror writes.
 */
import { create } from 'zustand'
import { creatorDirectory, type CreatorDirectoryRepository, type DirectoryEntry } from '../lib/creatorDirectory'
import { DIRECTORY_SEED } from '../data/creatorDirectorySeed'

interface DirectoryState {
  entries: DirectoryEntry[]
  hydrated: boolean
  loading: boolean
  hydrate: () => Promise<void>
  add: (entry: DirectoryEntry) => Promise<void>
  remove: (id: string) => Promise<void>
}

function upsertById(entries: DirectoryEntry[], entry: DirectoryEntry): DirectoryEntry[] {
  const rest = entries.filter((e) => e.id !== entry.id)
  return [...rest, entry]
}

export function makeCreatorDirectoryStore(repo: CreatorDirectoryRepository) {
  return create<DirectoryState>((set, get) => ({
    entries: [],
    hydrated: false,
    loading: false,
    hydrate: async () => {
      if (get().hydrated || get().loading) return
      set({ loading: true })
      try {
        const list = await repo.seedIfEmpty(DIRECTORY_SEED)
        set({ entries: list, hydrated: true, loading: false })
      } catch {
        // Table missing (migration not applied) or offline → empty directory, don't crash.
        set({ entries: [], hydrated: true, loading: false })
      }
    },
    add: async (entry) => {
      await repo.add(entry)
      set({ entries: upsertById(get().entries, entry) })
    },
    remove: async (id) => {
      await repo.remove(id)
      set({ entries: get().entries.filter((e) => e.id !== id) })
    },
  }))
}

export const useCreatorDirectoryStore = makeCreatorDirectoryStore(creatorDirectory)
