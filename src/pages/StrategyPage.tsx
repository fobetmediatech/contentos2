/**
 * StrategyPage — "Content Strategizing". A single onboarding form (mirrors Fobet's Client
 * Onboarding Input Sheet) → generates a client-ready Content Strategy Document (print → PDF).
 *
 * Only the business context the backend can't scrape is asked here; competitor metrics, niche
 * trends, and winning hooks are pulled/analysed automatically by useContentStrategy.
 */
import { Target, Loader2 } from 'lucide-react'
import { useStrategyStore } from '../store/strategyStore'
import { useContentStrategy } from '../hooks/useContentStrategy'
import { StrategyDeck } from '../components/StrategyDeck'
import { resolveDeckColors, PRESET_LABELS } from '../lib/deckThemes'
import { SAMPLE_RESULT } from '../lib/sampleStrategy'
import type { StrategyBrief, ContentLanguage, DeckPreset } from '../domain/strategy'

const inputCls =
  'w-full bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]'
const labelCls = 'block text-xs text-muted mb-1'
const eyebrow = 'text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-3 mt-6 first:mt-0'

const LANGS: { value: ContentLanguage; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish (mix)' },
]

export function StrategyPage() {
  const { brief, status, step, error, result, setBrief, setResult, reset } = useStrategyStore()
  const { generate, cancel } = useContentStrategy()
  const loadSample = () => {
    setBrief(SAMPLE_RESULT.brief)
    setResult(SAMPLE_RESULT)
  }
  const running = status === 'running'

  const set = (patch: Partial<StrategyBrief>) => setBrief({ ...brief, ...patch })
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
          <label className="block">
            <span className={labelCls}>Brand color (hex — used as deck accent)</span>
            <input className={inputCls} value={brief.brandColors} onChange={(e) => set({ brandColors: e.target.value })} placeholder="#C9A227" />
          </label>
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
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input
            className={`${inputCls} w-44`}
            value={brief.theme.bg}
            onChange={(e) => set({ theme: { ...brief.theme, bg: e.target.value } })}
            placeholder="Background hex e.g. #0A0A0A"
          />
          <input
            className={`${inputCls} w-44`}
            value={brief.theme.accent}
            onChange={(e) => set({ theme: { ...brief.theme, accent: e.target.value } })}
            placeholder="Accent hex e.g. #C9A227"
          />
          <span className="text-muted text-xs ml-1">Type custom colors to override the preset (accent also reads your brand color).</span>
        </div>
        <input
          className={`${inputCls} w-full max-w-lg mt-2`}
          value={brief.imageKeyword}
          onChange={(e) => set({ imageKeyword: e.target.value })}
          placeholder="Hero image keyword — e.g. Dubai skyline luxury (blank = no cover photo)"
        />

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
          <div className="no-print flex items-center justify-between mb-3">
            <h2 className="text-primary text-lg font-medium">Content Strategy Document</h2>
            <div className="flex items-center gap-2">
              <button onClick={reset} className="text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5">
                Clear
              </button>
              <button onClick={() => window.print()} className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-md px-4 py-1.5">
                Print / Save as PDF
              </button>
            </div>
          </div>
          <StrategyDeck result={result} colors={resolveDeckColors(brief)} imageKeyword={brief.imageKeyword} />
        </>
      )}
    </div>
  )
}
