import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useCreatorDirectoryStore } from '../store/creatorDirectoryStore'
import { directoryId, groupByCategory } from '../lib/creatorDirectory'

export function CreatorDirectoryEditor({ onClose }: { onClose: () => void }) {
  const entries = useCreatorDirectoryStore((s) => s.entries)
  const add = useCreatorDirectoryStore((s) => s.add)
  const remove = useCreatorDirectoryStore((s) => s.remove)

  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)

  const cleanHandle = handle.replace(/^@/, '').trim()
  const canAdd = !!name.trim() && !!cleanHandle && !!category.trim() && !busy
  const grouped = groupByCategory(entries)

  const onAdd = async () => {
    if (!canAdd) return
    setBusy(true)
    try {
      await add({
        id: directoryId(category, cleanHandle),
        category: category.trim().toLowerCase(),
        handle: cleanHandle,
        displayName: name.trim(),
      })
      setName(''); setHandle('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(var(--border-rgb),0.12)] bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-primary">Edit directory</h3>
        <button type="button" onClick={onClose} className="text-sm text-secondary hover:text-primary">Done</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name"
          className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle"
          className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="category" list="creator-categories"
          className="rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
        <datalist id="creator-categories">
          {Object.keys(grouped).map((c) => <option key={c} value={c} />)}
        </datalist>
        <button type="button" onClick={() => void onAdd()} disabled={!canAdd}
          className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-3 py-1.5 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
          <Plus size={14} /> Add
        </button>
      </div>

      <div className="max-h-56 overflow-y-auto space-y-1">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised">
            <span className="text-sm text-primary truncate">
              {e.displayName} <span className="text-muted">@{e.handle}</span> <span className="text-xs text-secondary">· {e.category}</span>
            </span>
            <button type="button" onClick={() => void remove(e.id)} aria-label={`Remove ${e.displayName}`}
              className="text-secondary hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
