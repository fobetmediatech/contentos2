/**
 * Creator directory — team-shared curated list of top creators by category, backing
 * Script Studio's "Choose a creator" mode. Mirrors the corpus Supabase-repo pattern.
 */
import { supabase } from './supabaseClient'
import { getClerkUserId } from './clerkToken'

export interface DirectoryEntry {
  id: string          // `${category}:${handle}` (lowercased) — stable, idempotent
  category: string
  handle: string      // Instagram handle, no leading @
  displayName: string
}

/** Stable id from category + handle (both normalized). */
export function directoryId(category: string, handle: string): string {
  return `${category.trim().toLowerCase()}:${handle.replace(/^@/, '').trim().toLowerCase()}`
}

/** Pure: group entries by category, preserving input order within a category. */
export function groupByCategory(entries: DirectoryEntry[]): Record<string, DirectoryEntry[]> {
  const map: Record<string, DirectoryEntry[]> = {}
  for (const e of entries) (map[e.category] ??= []).push(e)
  return map
}

export interface CreatorDirectoryRepository {
  list(): Promise<DirectoryEntry[]>
  /** Insert the seed only when the table is empty (idempotent — safe under concurrent first-loads). Returns the final list. */
  seedIfEmpty(seed: DirectoryEntry[]): Promise<DirectoryEntry[]>
  add(entry: DirectoryEntry): Promise<void>       // upsert on id (also serves display-name edits)
  remove(id: string): Promise<void>
}

interface Row { id: string; category: string; handle: string; display_name: string }
const toEntry = (r: Row): DirectoryEntry => ({ id: r.id, category: r.category, handle: r.handle, displayName: r.display_name })

export function createSupabaseCreatorDirectory(): CreatorDirectoryRepository {
  // Capture `repo` so methods call repo.list() instead of `this.*` — survives
  // destructuring (const { list } = creatorDirectory) without unbinding.
  const repo: CreatorDirectoryRepository = {
    async list() {
      const { data, error } = await supabase
        .from('creator_directory')
        .select('id, category, handle, display_name')
        .order('category')
        .order('display_name')
      if (error) throw error
      return ((data ?? []) as Row[]).map(toEntry)
    },
    async seedIfEmpty(seed) {
      const existing = await repo.list()
      if (existing.length > 0) return existing
      const userId = await getClerkUserId()
      const rows = seed.map((e) => ({
        id: e.id, category: e.category, handle: e.handle, display_name: e.displayName, created_by: userId,
      }))
      const { error } = await supabase
        .from('creator_directory')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw error
      return repo.list()
    },
    async add(entry) {
      const userId = await getClerkUserId()
      const { error } = await supabase
        .from('creator_directory')
        .upsert(
          { id: entry.id, category: entry.category, handle: entry.handle, display_name: entry.displayName, created_by: userId },
          { onConflict: 'id' },
        )
      if (error) throw error
    },
    async remove(id) {
      const { error } = await supabase.from('creator_directory').delete().eq('id', id)
      if (error) throw error
    },
  }
  return repo
}

/** Runtime instance bound to the Supabase-backed repo. */
export const creatorDirectory = createSupabaseCreatorDirectory()
