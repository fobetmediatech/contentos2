/**
 * StrategyPage — "Content Strategizing". A single onboarding form (mirrors Fobet's Client
 * Onboarding Input Sheet) → generates a client-ready Content Strategy Document (print → PDF).
 *
 * Only the business context the backend can't scrape is asked here; competitor metrics, niche
 * trends, and winning hooks are pulled/analysed automatically by useContentStrategy.
 */
import { useEffect } from 'react'
import { Target, Loader2, Save, Users, ArrowRight, Check, Shuffle } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useStrategyStore } from '../store/strategyStore'
import { useContentStrategy } from '../hooks/useContentStrategy'
import { StrategyDeck } from '../components/StrategyDeck'
import { resolveDeckColors, PRESET_LABELS } from '../lib/deckThemes'
import { listSavedClients, saveClient } from '../lib/strategyRepo'
import { SAMPLE_RESULT } from '../lib/sampleStrategy'
import type { StrategyBrief, ContentLanguage, DeckPreset } from '../domain/strategy'

const relDate = (ms: number) => {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const inputCls =
  'w-full bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]'
const labelCls = 'block text-xs text-muted mb-1'
const eyebrow = 'text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-3 mt-6 first:mt-0'

// A curated on-brand palette (saffron/warm-first, then a spread of hues) so a client's deck
// accent is one click away — no one remembers hex codes.
const PALETTE = [
  '#E07B3A', '#C9A227', '#D97706', '#DC2626', '#DB2777', '#7C3AED',
  '#2563EB', '#0891B2', '#059669', '#65A30D', '#F59E0B', '#E5E7EB',
]
const isHex = (v: string) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim())
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)]

/**
 * Color picker: native OS palette (paint-style) + preset swatches + a randomize button.
 * `clearable` adds a "Preset" option — an empty value means "inherit the deck preset" (used by
 * the deck-theme overrides, where blank ≠ a color).
 */
function ColorField({
  label, value, onChange, clearable,
}: { label: string; value: string; onChange: (v: string) => void; clearable?: boolean }) {
  const hasColor = isHex(value)
  const color = hasColor ? value.trim() : '#E07B3A'
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex items-center gap-2 flex-wrap">
        <label
          className="relative w-9 h-9 rounded-md border border-[rgba(var(--border-rgb),0.16)] cursor-pointer overflow-hidden shrink-0"
          style={{ background: hasColor ? color : 'var(--color-surface-raised)' }}
          title="Pick a custom color"
        >
          {!hasColor && (
            <span className="absolute inset-0 grid place-items-center text-muted text-[9px] font-mono pointer-events-none">auto</span>
          )}
          <input
            type="color"
            value={color}
            onChange={(e) => onChange(e.target.value)}
            className="absolute -inset-1 opacity-0 cursor-pointer"
            aria-label={label}
          />
        </label>
        <div className="flex items-center gap-1">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              title={c}
              aria-label={`Use ${c}`}
              className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                hasColor && color.toLowerCase() === c.toLowerCase()
                  ? 'ring-2 ring-offset-2 ring-offset-[var(--color-surface)] ring-[var(--color-accent)]'
                  : 'border border-[rgba(var(--border-rgb),0.2)]'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
        {clearable && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Use the deck preset color"
            className={`text-xs rounded-md px-2 py-1.5 border transition-colors ${
              !hasColor
                ? 'bg-[rgba(var(--accent-rgb),0.16)] border-[var(--color-accent)] text-[var(--color-accent-light)]'
                : 'border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary'
            }`}
          >
            Preset
          </button>
        )}
        <button
          type="button"
          onClick={() => onChange(randomColor())}
          title="Randomize"
          className="flex items-center gap-1 text-xs text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-2 py-1.5"
        >
          <Shuffle size={13} /> Random
        </button>
        <span className="font-mono text-xs text-muted">{hasColor ? color.toUpperCase() : 'Preset'}</span>
      </div>
    </div>
  )
}

const LANGS: { value: ContentLanguage; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish (mix)' },
]

export function StrategyPage() {
  const { brief, status, step, error, result, setBrief, setResult, reset } = useStrategyStore()
  const { generate, cancel } = useContentStrategy()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const loadSample = () => {
    setBrief(SAMPLE_RESULT.brief)
    setResult(SAMPLE_RESULT)
  }
  const running = status === 'running'

  // Shared "saved clients" list (team-wide, Supabase-backed).
  const { data: savedClients = [] } = useQuery({ queryKey: ['client_strategies'], queryFn: listSavedClients })
  const save = useMutation({
    mutationFn: saveClient,
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['client_strategies'] })
      navigate(`/strategy/${saved.id}`)
    },
  })

  const set = (patch: Partial<StrategyBrief>) => setBrief({ ...brief, ...patch })

  // Seed a random brand/accent color on first load so nobody hunts for a hex code. Only when the
  // field is still empty — never clobbers a color the user (or a saved brief) already set.
  useEffect(() => {
    if (!brief.brandColors.trim()) set({ brandColors: randomColor() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setHandle = (key: 'competitors' | 'aspirational', i: number, v: string) => {
    const next = [...brief[key]]
    next[i] = v
    set({ [key]: next } as Partial<StrategyBrief>)
  }

  const canGenerate = brief.brandName.trim() && brief.offer.trim() && !running

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-5 no-print">
        <h1 className="font-serif italic text-3xl text-primary flex items-center gap-2">
          <Target size={24} className="text-[var(--color-accent)]" /> Content Strategizing
        </h1>
        <p className="text-secondary text-sm mt-1">
          Fill the onboarding sheet — ContentOS pulls competitor metrics, niche trends, and winning hooks
          automatically and writes a complete strategy deck.
        </p>
        {import.meta.env.DEV && (
          <button
            onClick={loadSample}
            className="mt-2 text-xs text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
          >
            Load sample deck (dev only — for previewing the format locally)
          </button>
        )}
      </header>

      {/* Saved clients — the shared, persistent list. Click one to view its strategy + files. */}
      {savedClients.length > 0 && (
        <div className="no-print mb-5">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-2">
            <Users size={13} /> Saved clients
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {savedClients.map((c) => (
              <Link
                key={c.id}
                to={`/strategy/${c.id}`}
                className="group flex items-start justify-between gap-2 bg-surface border border-[rgba(var(--border-rgb),0.08)] hover:border-[var(--color-accent)] rounded-lg p-3 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-primary text-sm font-medium truncate">{c.brandName}</div>
                  {c.offer && <div className="text-muted text-xs truncate mt-0.5">{c.offer}</div>}
                  <div className="text-muted text-[11px] font-mono mt-1">{relDate(c.createdAt)}</div>
                </div>
                <ArrowRight size={15} className="text-muted group-hover:text-[var(--color-accent)] shrink-0 mt-0.5 transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Onboarding form */}
      <div className="no-print bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-5 mb-5">
        <div className={eyebrow}>A · Basic information</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>Client / brand name *</span>
            <input className={inputCls} value={brief.brandName} onChange={(e) => set({ brandName: e.target.value })} placeholder="What we call them on screen" />
          </label>
          <label className="block">
            <span className={labelCls}>Primary niche</span>
            <input className={inputCls} value={brief.primaryNiche} onChange={(e) => set({ primaryNiche: e.target.value })} placeholder="e.g. Real estate + Dubai consultancy" />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>Sub-niche / exact speciality</span>
            <input className={inputCls} value={brief.subNiche} onChange={(e) => set({ subNiche: e.target.value })} placeholder="e.g. Visas, schools, compliance, real estate" />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>What exactly are we selling? *</span>
            <input className={inputCls} value={brief.offer} onChange={(e) => set({ offer: e.target.value })} placeholder="The exact offer all content drives toward" />
          </label>
          <div className="sm:col-span-2">
            <span className={labelCls}>Content language</span>
            <div className="flex gap-2">
              {LANGS.map((l) => (
                <button
                  key={l.value}
                  onClick={() => set({ language: l.value })}
                  className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${
                    brief.language === l.value
                      ? 'bg-[rgba(var(--accent-rgb),0.16)] border-[var(--color-accent)] text-[var(--color-accent-light)]'
                      : 'border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={eyebrow}>B · Target audience</div>
        <textarea className={`${inputCls} resize-none`} rows={2} value={brief.audience} onChange={(e) => set({ audience: e.target.value })} aria-label="Target audience" placeholder="Age, income, biggest problem, what they want" />

        <div className={eyebrow}>C · Competitors & aspirational accounts</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <span className={labelCls}>Direct competitors (handles)</span>
            <div className="space-y-2">
              {brief.competitors.map((h, i) => (
                <input key={i} className={inputCls} value={h} onChange={(e) => setHandle('competitors', i, e.target.value)} aria-label={`Direct competitor ${i + 1}`} placeholder={`@competitor ${i + 1}`} />
              ))}
            </div>
          </div>
          <div>
            <span className={labelCls}>Aspirational accounts (style to replicate)</span>
            <div className="space-y-2">
              {brief.aspirational.map((h, i) => (
                <input key={i} className={inputCls} value={h} onChange={(e) => setHandle('aspirational', i, e.target.value)} aria-label={`Aspirational account ${i + 1}`} placeholder={`@aspirational ${i + 1}`} />
              ))}
            </div>
          </div>
        </div>

        <div className={eyebrow}>D · Brand & restrictions</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <ColorField label="Brand color (used as deck accent)" value={brief.brandColors} onChange={(v) => set({ brandColors: v })} />
          </div>
          <label className="block">
            <span className={labelCls}>Topics / styles they dislike</span>
            <input className={inputCls} value={brief.dislikes} onChange={(e) => set({ dislikes: e.target.value })} placeholder="e.g. no cringe skits" />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>Off-limits topics (legal / sensitivities)</span>
            <input className={inputCls} value={brief.offLimits} onChange={(e) => set({ offLimits: e.target.value })} placeholder="e.g. nothing negative about Dubai" />
          </label>
        </div>

        <div className={eyebrow}>Deck theme</div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(PRESET_LABELS) as DeckPreset[]).map((p) => (
            <button
              key={p}
              onClick={() => set({ theme: { ...brief.theme, preset: p } })}
              className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${
                brief.theme.preset === p
                  ? 'bg-[rgba(var(--accent-rgb),0.16)] border-[var(--color-accent)] text-[var(--color-accent-light)]'
                  : 'border-[rgba(var(--border-rgb),0.12)] text-secondary hover:text-primary'
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <ColorField label="Background (override preset)" value={brief.theme.bg} onChange={(v) => set({ theme: { ...brief.theme, bg: v } })} clearable />
          <ColorField label="Accent (override brand color)" value={brief.theme.accent} onChange={(v) => set({ theme: { ...brief.theme, accent: v } })} clearable />
        </div>
        <p className="text-muted text-xs mt-1.5">Leave on “Preset” to inherit the theme; pick a color to override it.</p>

        <div className="flex items-center gap-3 mt-5">
          {running ? (
            <button onClick={cancel} className="bg-surface-raised text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] text-sm font-medium rounded-md px-4 py-2">
              Cancel
            </button>
          ) : (
            <button
              onClick={() => generate(brief)}
              disabled={!canGenerate}
              className="flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 text-white text-sm font-medium rounded-md px-5 py-2 transition-colors"
            >
              <Target size={15} /> Generate strategy
            </button>
          )}
          {running && (
            <span className="flex items-center gap-2 text-secondary text-sm">
              <Loader2 size={15} className="animate-spin" /> {step}
            </span>
          )}
          {error && <span className="text-danger text-sm">{error}</span>}
        </div>
      </div>

      {/* Result */}
      {result && status !== 'running' && (
        <>
          <div className="no-print flex items-start justify-between mb-1 gap-3 flex-wrap">
            <h2 className="text-primary text-lg font-medium">Content Strategy Document</h2>
            <div className="flex items-center gap-2">
              {save.isError && <span className="text-danger text-xs">Couldn’t save — try again.</span>}
              <button onClick={reset} className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5">
                Clear
              </button>
              <button onClick={() => window.print()} className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5">
                Print / Save as PDF
              </button>
              <button
                onClick={() => save.mutate(result)}
                disabled={save.isPending}
                className="flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-md px-4 py-1.5 disabled:opacity-50"
              >
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : save.isSuccess ? <Check size={14} /> : <Save size={14} />}
                Save as client
              </button>
            </div>
          </div>
          <p className="no-print text-muted text-xs mb-3">
            <button onClick={() => save.mutate(result)} className="text-[var(--color-accent)] hover:underline">Save as client</button>
            {' '}to keep it in the shared list and attach reference files (brief, brand kit, screenshots) on the client’s page.
          </p>
          <StrategyDeck result={result} colors={resolveDeckColors(brief)} />
        </>
      )}
    </div>
  )
}
