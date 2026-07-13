import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Wand2, Loader2, Library, Link2 } from 'lucide-react'
import { useReelRemix, type TranscribeResult } from '../hooks/useReelRemix'
import { friendlyError } from '../lib/errorMessages'
import { RemixLibraryPicker } from '../components/RemixLibraryPicker'
import { RemixVoicePicker, type VoiceChoice } from '../components/RemixVoicePicker'
import { RemixResultPanel, type VariationSlot } from '../components/RemixResultPanel'
import { fieldKey, fieldLabel, applyFieldValue, type FieldRef } from '../lib/remixFields'
import { VARIATION_ANGLES } from '../ai/prompts/reelRemix'
import type { TargetLanguage } from '../ai/prompts/reelRewrite'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'

type Phase = 'input' | 'transcribing' | 'review' | 'generating' | 'result'
const VARIATION_COUNT = 3

export function ScriptStudioPage() {
  const { transcribe, generate, fromLibrary, generateVariations, regenerateField } = useReelRemix()
  const location = useLocation()
  const navigate = useNavigate()
  const abortRef = useRef<AbortController | null>(null)

  const [phase, setPhase] = useState<Phase>('input')
  const [sourceMode, setSourceMode] = useState<'url' | 'library'>('url')
  const [url, setUrl] = useState('')
  const [ref_, setRef] = useState<TranscribeResult | null>(null)
  const [transcript, setTranscript] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [language, setLanguage] = useState<TargetLanguage>('english')
  const [voiceChoice, setVoiceChoice] = useState<VoiceChoice>({})
  const [slots, setSlots] = useState<VariationSlot[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [voice, setVoice] = useState<VoiceProfile | undefined>(undefined)
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = phase === 'transcribing' || phase === 'generating'

  // Seed from a Gallery "Remix this" click (router state), then clear it so refresh doesn't re-seed.
  useEffect(() => {
    const st = location.state as { shortCode?: string; transcript?: string } | null
    if (st?.shortCode && st?.transcript) {
      void (async () => {
        const result = await fromLibrary({ shortCode: st.shortCode!, transcript: st.transcript! })
        setRef(result); setTranscript(result.transcript); setPhase('review')
      })()
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const seedFromLibrary = async (reel: { shortCode: string; transcript: string }) => {
    setError(null)
    const result = await fromLibrary(reel)
    setRef(result); setTranscript(result.transcript); setPhase('review')
  }

  const onFetch = async () => {
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController(); abortRef.current = ac
    setPhase('transcribing')
    try {
      const result = await transcribe(url.trim(), ac.signal)
      setRef(result); setTranscript(result.transcript); setPhase('review')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, (err as Error)?.message ?? 'Could not fetch that video.'))
      setPhase('input')
    }
  }

  const baseArgs = () => ({
    source: ref_!.source,
    editedTranscript: transcript,
    newTopic: newTopic.trim(),
    language,
    clientHandle: voiceChoice.clientHandle,
    pastedScripts: voiceChoice.pastedScripts ? voiceChoice.pastedScripts.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean) : undefined,
  })

  const onGenerate = async () => {
    if (!ref_ || !newTopic.trim() || !transcript.trim()) return
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController(); abortRef.current = ac
    setSlots(Array.from({ length: VARIATION_COUNT }, () => ({ status: 'pending', result: null })))
    setActiveIndex(0)
    setPhase('generating')
    try {
      const { voice: resolvedVoice } = await generateVariations(
        baseArgs(),
        {
          count: VARIATION_COUNT,
          onResult: (i, r) => setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'done', result: r } : s))),
          onError: (i) => setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'failed', result: null } : s))),
        },
        ac.signal,
      )
      if (ac.signal.aborted) return
      setVoice(resolvedVoice)
      setPhase('result')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(friendlyError(err, 'Could not generate the script.'))
      setPhase('review')
    }
  }

  const onRetry = async (i: number) => {
    if (!ref_) return
    const ac = new AbortController()
    setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'pending', result: null } : s)))
    try {
      const r = await generate({ ...baseArgs(), voice, variationAngle: VARIATION_ANGLES[i % VARIATION_ANGLES.length] }, ac.signal)
      setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'done', result: r } : s)))
    } catch {
      setSlots((prev) => prev.map((s, k) => (k === i ? { status: 'failed', result: null } : s)))
    }
  }

  const onRegenerate = async (field: FieldRef) => {
    if (!ref_ || regeneratingKey) return
    const slot = slots[activeIndex]
    if (slot.status !== 'done' || !slot.result) return
    const key = fieldKey(field)
    setRegeneratingKey(key)
    try {
      const value = await regenerateField({
        current: slot.result, source: ref_.source, fieldLabel: fieldLabel(field),
        newTopic: newTopic.trim(), language, voice,
      })
      if (value) {
        setSlots((prev) => prev.map((s, k) => (k === activeIndex && s.result ? { ...s, result: applyFieldValue(s.result, field, value) } : s)))
      }
    } catch (err) {
      setError(friendlyError(err, 'Could not regenerate that field.'))
    } finally {
      setRegeneratingKey(null)
    }
  }

  const onReset = () => {
    abortRef.current?.abort()
    setPhase('input'); setSourceMode('url'); setUrl(''); setRef(null); setTranscript('')
    setNewTopic(''); setVoiceChoice({}); setSlots([]); setActiveIndex(0); setVoice(undefined); setError(null)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-6">
        <h1 className="font-serif italic text-3xl text-primary flex items-center gap-2">
          <Wand2 size={24} className="text-[var(--color-accent)]" /> Script Studio
        </h1>
        <p className="text-secondary text-sm mt-1">
          Paste a Reel or YouTube Short, or pick one from your library, add your new idea, and get 3 scripts in its exact style.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 text-sm px-3 py-2">{error}</div>
      )}

      {/* Step 1 — Source */}
      <section className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 mb-4">
        <div className="flex items-center gap-1 mb-3">
          <button type="button" onClick={() => setSourceMode('url')} disabled={phase !== 'input'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${sourceMode === 'url' ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'}`}>
            <Link2 size={14} /> Paste URL
          </button>
          <button type="button" onClick={() => setSourceMode('library')} disabled={phase !== 'input'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${sourceMode === 'library' ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'}`}>
            <Library size={14} /> Choose from library
          </button>
        </div>

        {sourceMode === 'url' ? (
          <div className="flex gap-2">
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="instagram.com/reel/… or youtube.com/shorts/…"
              disabled={phase !== 'input' && phase !== 'transcribing'}
              className="flex-1 rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
            <button type="button" onClick={onFetch} disabled={!url.trim() || busy}
              className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5">
              {phase === 'transcribing' ? <Loader2 size={15} className="animate-spin" /> : null}
              {phase === 'transcribing' ? 'Transcribing…' : 'Fetch & Transcribe'}
            </button>
          </div>
        ) : (
          <RemixLibraryPicker onPick={(reel) => void seedFromLibrary(reel)} />
        )}
      </section>

      {/* Step 2 — Review + inputs */}
      {(phase === 'review' || phase === 'generating' || phase === 'result') && ref_ && (
        <section className="rounded-xl border border-[rgba(var(--border-rgb),0.08)] bg-surface p-4 mb-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-primary">Transcript <span className="text-muted font-normal">({ref_.platform})</span></label>
              <span className="text-xs text-muted">Edit any mis-transcribed words</span>
            </div>
            <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={6}
              className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary mb-1.5">Your new video idea</label>
            <input type="text" value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
              placeholder="e.g. how to save your first ₹1 lakh in your 20s"
              className="w-full rounded-lg bg-surface-raised border border-[rgba(var(--border-rgb),0.12)] px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <span className="block text-xs font-medium text-secondary mb-1.5">Language</span>
              <div className="inline-flex rounded-lg border border-[rgba(var(--border-rgb),0.12)] overflow-hidden">
                {(['english', 'hinglish'] as TargetLanguage[]).map((l) => (
                  <button key={l} type="button" onClick={() => setLanguage(l)}
                    className={`px-3 py-1.5 text-sm capitalize ${language === l ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)]' : 'text-secondary hover:text-primary'}`}>{l}</button>
                ))}
              </div>
            </div>
            <RemixVoicePicker onChange={setVoiceChoice} />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onGenerate} disabled={!newTopic.trim() || !transcript.trim() || busy}
              className="rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5">
              {phase === 'generating' ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {phase === 'generating' ? 'Generating…' : `Generate ${VARIATION_COUNT} scripts`}
            </button>
            <button type="button" onClick={onReset} className="text-sm text-secondary hover:text-primary">Start over</button>
          </div>
        </section>
      )}

      {/* Step 3 — Variations */}
      {(phase === 'generating' || phase === 'result') && slots.length > 0 && (
        <RemixResultPanel slots={slots} activeIndex={activeIndex} onSelect={setActiveIndex}
          regeneratingKey={regeneratingKey} onRegenerate={(f) => void onRegenerate(f)} onRetry={(i) => void onRetry(i)} />
      )}
    </div>
  )
}
