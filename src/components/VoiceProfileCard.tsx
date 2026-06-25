/**
 * VoiceProfileCard — a voice profile on the Memory Voices tab.
 *
 * Shows handle / display name, tone chips, meta stats, and supports inline editing of all
 * qualitative fields (saved via corpusStore.setVoiceProfile). A Rebuild button is shown for
 * handle-based profiles (not pasted-script ones), routing the operator back to chat to kick
 * off a fresh scrape+synthesis run.
 *
 * inputCls and the edit pattern mirror PaymentClientsManager.tsx.
 * Any authenticated user may edit / rebuild — no owner gate (locked decision).
 */

import { useState } from 'react'
import { useCorpusStore } from '../store/corpusStore'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'

const inputCls =
  'w-full bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[#E07B3A]'

interface Props {
  profile: VoiceProfile
  onRebuild: (handle: string) => void
}

export default function VoiceProfileCard({ profile, onRebuild }: Props) {
  const setVoiceProfile = useCorpusStore((s) => s.setVoiceProfile)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<VoiceProfile>(profile)
  const [saving, setSaving] = useState(false)

  const patch = (p: Partial<VoiceProfile>) => setForm((f) => ({ ...f, ...p }))
  const csv = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

  const save = async () => {
    setSaving(true)
    try {
      await setVoiceProfile(profile.handle, { ...form, handle: profile.handle })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg bg-[#2A211B] border border-[rgba(245,237,214,0.08)] p-3 space-y-2">
        <div className="text-[11px] font-mono uppercase tracking-wide text-muted mb-1">
          Editing — {profile.displayName || `@${profile.handle}`}
        </div>
        <input
          className={inputCls}
          value={form.displayName}
          onChange={(e) => patch({ displayName: e.target.value })}
          placeholder="Display name"
          aria-label="Display name"
        />
        <input
          className={inputCls}
          value={form.toneDescriptors.join(', ')}
          onChange={(e) => patch({ toneDescriptors: csv(e.target.value) })}
          placeholder="Tone descriptors (comma-separated)"
          aria-label="Tone descriptors"
        />
        <input
          className={inputCls}
          value={form.vocabulary.join(', ')}
          onChange={(e) => patch({ vocabulary: csv(e.target.value) })}
          placeholder="Vocabulary (comma-separated)"
          aria-label="Vocabulary"
        />
        <input
          className={inputCls}
          value={form.hookHabits.join(', ')}
          onChange={(e) => patch({ hookHabits: csv(e.target.value) })}
          placeholder="Hook habits (comma-separated)"
          aria-label="Hook habits"
        />
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={form.formality}
          onChange={(e) => patch({ formality: e.target.value })}
          placeholder="Formality"
          aria-label="Formality"
        />
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={form.audienceAddress}
          onChange={(e) => patch({ audienceAddress: e.target.value })}
          placeholder="Audience address"
          aria-label="Audience address"
        />
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={form.sentenceRhythm}
          onChange={(e) => patch({ sentenceRhythm: e.target.value })}
          placeholder="Sentence rhythm"
          aria-label="Sentence rhythm"
        />
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={form.emotionalRegister}
          onChange={(e) => patch({ emotionalRegister: e.target.value })}
          placeholder="Emotional register"
          aria-label="Emotional register"
        />
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={form.structuralPattern}
          onChange={(e) => patch({ structuralPattern: e.target.value })}
          placeholder="Structural pattern"
          aria-label="Structural pattern"
        />
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="text-sm px-3 py-1.5 rounded-md bg-[#E07B3A] text-[#1A1410] font-medium disabled:opacity-50 hover:bg-[#C4612A] transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(profile)
              setEditing(false)
            }}
            className="text-sm px-3 py-1.5 rounded-md border border-[rgba(245,237,214,0.12)] text-muted hover:text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-[#2A211B] border border-[rgba(245,237,214,0.08)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-primary truncate">
            {profile.displayName || `@${profile.handle}`}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {profile.fromScripts ? 'From scripts' : `@${profile.handle}`}
            {' · '}
            {profile.reelCount} reel{profile.reelCount !== 1 ? 's' : ''}
            {' · '}
            consistency {profile.personaConsistencyScore}/10
          </div>
          {profile.formality && (
            <div className="text-xs text-secondary mt-1 truncate">{profile.formality}</div>
          )}
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              setForm(profile)
              setEditing(true)
            }}
            className="text-xs px-2 py-1 rounded-md border border-[rgba(245,237,214,0.12)] text-muted hover:text-primary hover:border-[#E07B3A] transition-colors"
          >
            Edit
          </button>
          {!profile.fromScripts && (
            <button
              type="button"
              onClick={() => onRebuild(profile.handle)}
              className="text-xs px-2 py-1 rounded-md border border-[rgba(245,237,214,0.12)] text-muted hover:text-primary hover:border-[#E07B3A] transition-colors"
            >
              Rebuild
            </button>
          )}
        </div>
      </div>

      {profile.toneDescriptors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {profile.toneDescriptors.map((t, i) => (
            // Tone descriptors are AI-generated → violet tint per DESIGN.md.
            <span
              key={i}
              className="text-xs px-2 py-0.5 rounded-full bg-[rgba(167,139,250,0.10)] text-[#A78BFA] border border-[rgba(167,139,250,0.20)]"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {profile.hookHabits.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-mono uppercase tracking-wide text-muted mb-1">
            Hook habits
          </div>
          <ul className="space-y-0.5">
            {profile.hookHabits.map((h, i) => (
              <li key={i} className="text-xs text-secondary">
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
