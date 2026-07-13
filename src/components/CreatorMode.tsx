import { useEffect, useRef, useState } from 'react'
import { Wand2, Loader2, Pencil, ArrowLeft } from 'lucide-react'
import { useCreatorDirectoryStore } from '../store/creatorDirectoryStore'
import { groupByCategory, type DirectoryEntry } from '../lib/creatorDirectory'
import { useCreatorScript } from '../hooks/useCreatorScript'
import { friendlyError } from '../lib/errorMessages'
import { CreatorScriptResult } from './CreatorScriptResult'
import { CreatorDirectoryEditor } from './CreatorDirectoryEditor'
import type { TargetLanguage } from '../ai/prompts/reelRewrite'
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

export function CreatorMode() {
  const { generate } = useCreatorScript()
  const entries = useCreatorDirectoryStore((s) => s.entries)
  const hydrated = useCreatorDirectoryStore((s) => s.hydrated)
  const abortRef = useRef<AbortController | null>(null)

  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<DirectoryEntry | null>(null)
  const [idea, setIdea] = useState('')
  const [language, setLanguage] = useState<TargetLanguage>('english')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<ReelRewriteResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void useCreatorDirectoryStore.getState().hydrate() }, [])

  const onGenerate = async () => {
    if (!picked || !idea.trim()) return
    setError(null); setResult(null)
    abortRef.current?.abort()
    const ac = new AbortController(); abortRef.current = ac
    setGenerating(true)
    try {
      const r = await generate({ handle: picked.handle, idea: idea.trim(), language }, ac.signal)
      if (ac.signal.aborted) return
      setResult(r)
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, `Couldn't build @${picked.handle}'s voice — check the handle.`))
    } finally {
      setGenerating(false)
    }
  }

  const back = () => { abortRef.current?.abort(); setPicked(null); setIdea(''); setResult(null); setError(null); setGenerating(false) }

  const grouped = groupByCategory(entries)

  if (picked) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={back} className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary">
          <ArrowLeft size={14} /> All creators
        </button>
        <div className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 space-y-4">
          <div className="text-sm text-primary font-medium">{picked.displayName} <span className="text-muted">@{picked.handle}</span></div>
          <input type="text" value={idea} onChange={(e) => setIdea(e.target.value)}
            placeholder="Your video idea — e.g. why most people fail their first month at the gym"
            className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
          <div className="flex items-center gap-4">
            <div className="inline-flex rounded-lg border border-[rgba(var(--border-rgb),0.12)] overflow-hidden">
              {(['english', 'hinglish'] as TargetLanguage[]).map((l) => (
                <button key={l} type="button" onClick={() => setLanguage(l)}
                  className={`px-3 py-1.5 text-sm capitalize ${language === l ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'}`}>{l}</button>
              ))}
            </div>
            <button type="button" onClick={() => void onGenerate()} disabled={!idea.trim() || generating}
              className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5">
              {generating ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {generating ? 'Writing…' : 'Generate script'}
            </button>
          </div>
          {generating && <p className="text-xs text-muted">First time with this creator can take ~a minute while we learn their voice.</p>}
          {error && <div className="rounded-lg border border-[var(--color-error-subtle)] bg-[var(--color-error-subtle)] text-[var(--color-error)] text-sm px-3 py-2">{error}</div>}
        </div>
        {result && <CreatorScriptResult result={result} />}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-secondary">Pick a creator, then write in their voice.</span>
        <button type="button" onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary">
          <Pencil size={13} /> {editing ? 'Close editor' : 'Edit directory'}
        </button>
      </div>

      {editing && <CreatorDirectoryEditor onClose={() => setEditing(false)} />}

      {!hydrated ? (
        <p className="text-sm text-muted">Loading creators…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">No creators yet. Add some with “Edit directory”.</p>
      ) : (
        Object.keys(grouped).sort().map((category) => (
          <div key={category}>
            <h3 className="text-xs font-mono uppercase tracking-wide text-muted mb-2">{category}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {grouped[category].map((e) => (
                <button key={e.id} type="button" onClick={() => setPicked(e)}
                  className="text-left rounded-lg border border-[rgba(var(--border-rgb),0.12)] bg-surface-raised px-3 py-2 hover:border-[rgba(var(--accent-rgb),0.4)] transition-colors">
                  <span className="block text-sm text-primary font-medium truncate">{e.displayName}</span>
                  <span className="block text-xs text-secondary truncate">@{e.handle}</span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
