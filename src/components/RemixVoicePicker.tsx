import { useState } from 'react'
import { useCorpusStore } from '../store/corpusStore'

/** Reports the chosen client voice up to Script Studio. */
export interface VoiceChoice {
  clientHandle?: string
  pastedScripts?: string
}

/** Dropdown of saved voice profiles + a "new voice" fallback (type @handle or paste scripts). */
export function RemixVoicePicker({ onChange }: { onChange: (v: VoiceChoice) => void }) {
  const profiles = useCorpusStore((s) => s.voiceProfiles)
  const saved = Object.values(profiles)
  const [mode, setMode] = useState<'none' | 'saved' | 'new'>('none')
  const [handle, setHandle] = useState('')
  const [pasted, setPasted] = useState('')

  const onSelect = (value: string) => {
    if (value === '') { setMode('none'); onChange({}) }
    else if (value === '__new__') { setMode('new'); onChange({ clientHandle: handle.trim() || undefined, pastedScripts: pasted.trim() || undefined }) }
    else { setMode('saved'); onChange({ clientHandle: value }) } // value === saved profile handle
  }

  return (
    <div className="flex-1 min-w-[180px]">
      <label htmlFor="remix-voice-select" className="block text-xs font-medium text-secondary mb-1.5">Client voice (optional)</label>
      <select
        id="remix-voice-select"
        onChange={(e) => onSelect(e.target.value)}
        defaultValue=""
        className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="">No client voice</option>
        {saved.map((p) => (
          <option key={p.handle} value={p.handle}>{p.displayName || `@${p.handle}`}</option>
        ))}
        <option value="__new__">New voice…</option>
      </select>

      {mode === 'new' && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={handle}
            onChange={(e) => { setHandle(e.target.value); onChange({ clientHandle: e.target.value.trim() || undefined, pastedScripts: pasted.trim() || undefined }) }}
            placeholder="@handle"
            className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <textarea
            value={pasted}
            onChange={(e) => { setPasted(e.target.value); onChange({ clientHandle: handle.trim() || undefined, pastedScripts: e.target.value.trim() || undefined }) }}
            rows={3}
            placeholder="…or paste 2–3 of their scripts, separated by a blank line"
            className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      )}
    </div>
  )
}
