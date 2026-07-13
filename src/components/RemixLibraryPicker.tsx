import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { corpus } from '../lib/corpusIdb'
import type { ContentRecord } from '../lib/corpus'

/** Pure: reels that have a transcript, matching the query in caption or handle. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, unit-tested directly (see .test.ts)
export function filterReels(reels: ContentRecord[], query: string): ContentRecord[] {
  const q = query.trim().toLowerCase()
  return reels.filter((r) => {
    if (!r.transcript || !r.transcript.trim()) return false
    if (!q) return true
    return (r.caption ?? '').toLowerCase().includes(q) || (r.creatorUsername ?? '').toLowerCase().includes(q)
  })
}

/** Searchable list of corpus reels; picking one seeds the remix reference (free — has transcript). */
export function RemixLibraryPicker({ onPick }: { onPick: (reel: { shortCode: string; transcript: string }) => void }) {
  const [reels, setReels] = useState<ContentRecord[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    corpus.listAllContent({ limit: 200 })
      .then((r) => alive && setReels(r))
      .catch(() => alive && setReels([]))
    return () => { alive = false }
  }, [])

  const shown = reels ? filterReels(reels, query) : []

  return (
    <div className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] p-2">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Search size={14} className="text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library by caption or @handle"
          className="flex-1 bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
        />
      </div>
      <div className="max-h-72 overflow-y-auto mt-1">
        {reels === null ? (
          <p className="text-sm text-muted px-2 py-3">Loading your library…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted px-2 py-3">No reels with a transcript match. Analyze creators in chat to fill your library.</p>
        ) : (
          shown.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick({ shortCode: r.id, transcript: r.transcript ?? '' })}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-[rgba(var(--accent-rgb),0.08)] text-left transition-colors"
            >
              {r.thumbnailUrl
                ? <img src={r.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="w-10 h-12 object-cover rounded flex-shrink-0" />
                : <div className="w-10 h-12 rounded bg-[var(--color-bg)] flex-shrink-0" />}
              <span className="min-w-0">
                <span className="block text-sm text-primary font-medium truncate">@{r.creatorUsername}</span>
                <span className="block text-xs text-secondary truncate">{r.caption || (r.transcript ?? '').slice(0, 60)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
