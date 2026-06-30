/**
 * VoiceProfileCard — a voice profile on the Memory Voices tab.
 *
 * Shows handle / display name, tone chips, meta stats, and supports inline editing of all
 * qualitative fields (saved via corpusStore.setVoiceProfile). A Rebuild button is shown for
 * handle-based profiles (not pasted-script ones); it re-scrapes + re-synthesizes the profile
 * in place (onRebuild) and the corpus mirror update re-renders the card with fresh data.
 *
 * inputCls and the edit pattern mirror PaymentClientsManager.tsx.
 * Any authenticated user may edit / rebuild — no owner gate (locked decision).
 */

import { useState } from 'react'
import { useCorpusStore } from '../store/corpusStore'
import type { VoiceProfile, VoiceLanguageMode } from '../ai/prompts/voiceProfile'

const inputCls =
  'w-full bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]'

const LANG_OPTIONS: { value: VoiceLanguageMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'english', label: 'English' },
  { value: 'hinglish', label: 'Hinglish' },
]

interface Props {
  profile: VoiceProfile
  onRebuild: (handle: string) => Promise<void>
}

export default function VoiceProfileCard({ profile, onRebuild }: Props) {
  const setVoiceProfile = useCorpusStore((s) => s.setVoiceProfile)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<VoiceProfile>(profile)
  const [saving, setSaving] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const [langSaving, setLangSaving] = useState(false)

  const currentLang: VoiceLanguageMode = profile.outputLanguage ?? 'auto'
  const setLang = (mode: VoiceLanguageMode) => {
    if (mode === currentLang || langSaving) return
    setLangSaving(true)
    void setVoiceProfile(profile.handle, { ...profile, outputLanguage: mode }).finally(() => setLangSaving(false))
  }

  const rebuild = () => {
    setRebuildError(null)
    setRebuilding(true)
    void onRebuild(profile.handle)
      .catch((e) => setRebuildError((e as Error)?.message || 'Rebuild failed — try again.'))
      .finally(() => setRebuilding(false))
  }

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
      <div className="rounded-lg bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.08)] p-3 space-y-2">
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
            className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-[var(--color-bg)] font-medium disabled:opacity-50 hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(profile)
              setEditing(false)
            }}
            className="text-sm px-3 py-1.5 rounded-md border border-[rgba(var(--border-rgb),0.12)] text-muted hover:text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.08)] p-3">
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
            className="text-xs px-2 py-1 rounded-md border border-[rgba(var(--border-rgb),0.12)] text-muted hover:text-primary hover:border-[var(--color-accent)] transition-colors"
          >
            Edit
          </button>
          {!profile.fromScripts && (
            <button
              type="button"
              disabled={rebuilding}
              onClick={rebuild}
              className="text-xs px-2 py-1 rounded-md border border-[rgba(var(--border-rgb),0.12)] text-muted hover:text-primary hover:border-[var(--color-accent)] disabled:opacity-50 transition-colors"
            >
              {rebuilding ? 'Rebuilding…' : 'Rebuild'}
            </button>
          )}
        </div>
      </div>

      {rebuildError && (
        <div className="mt-2 text-xs text-[var(--color-accent)]">{rebuildError}</div>
      )}

      <div className="mt-3">
        <div className="text-[11px] font-mono uppercase tracking-wide text-muted mb-1">
          Output language
        </div>
        <div className="flex gap-1" role="group" aria-label="Repurposed output language">
          {LANG_OPTIONS.map((o) => {
            const active = currentLang === o.value
            return (
              <button
                key={o.value}
                type="button"
                disabled={langSaving}
                aria-pressed={active}
                onClick={() => setLang(o.value)}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors disabled:opacity-50 ${
                  active
                    ? 'bg-[var(--color-accent)] text-[var(--color-bg)] border-[var(--color-accent)] font-medium'
                    : 'border-[rgba(var(--border-rgb),0.12)] text-muted hover:text-primary hover:border-[var(--color-accent)]'
                }`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
        {currentLang === 'auto' && (
          <div className="text-[11px] text-muted mt-1">Auto-detects from this creator&rsquo;s reels.</div>
        )}
      </div>

      {profile.toneDescriptors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {profile.toneDescriptors.map((t, i) => (
            // Tone descriptors are AI-generated → violet tint per DESIGN.md.
            <span
              key={i}
              className="text-xs px-2 py-0.5 rounded-full bg-[rgba(var(--ai-rgb),0.10)] text-[var(--color-ai-tint)] border border-[rgba(var(--ai-rgb),0.20)]"
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
