/**
 * StrategyDeck — the client-ready Content Strategy as a themed 16:9 slide deck.
 *
 * Same data as before (StrategyResult); presentation only. Heavy on visuals: icons on every
 * section, recharts (donut/bars that fit their column), creator photos, a positioning "gap"
 * diagram, and a strategy-map flow. Slide bodies are vertically centered so no slide looks empty.
 * Colors come from `colors` (per-client) via CSS variables. Each `.deck-slide` prints as one
 * landscape PDF page (print CSS in index.css).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Target, Users, Layers, MapPin, BarChart3, Anchor, Lightbulb, PieChart as PieIcon, Volume2,
  ShieldCheck, Flag, Video, LayoutGrid, CircleDot, ArrowRight, Quote, Sparkles, TrendingUp,
  BadgeCheck, Trophy, Compass, Crosshair, Check, Megaphone, X, ChevronLeft, ChevronRight, type LucideIcon,
} from 'lucide-react'
import type { StrategyResult } from '../domain/strategy'
import { themeVars, type DeckColors } from '../lib/deckThemes'
import { CreatorAvatar, FormatMixDonut, ErBarChart, HookPatternChart } from './strategyVisuals'

const fmt = (n: number) => n.toLocaleString()

const vBg: CSSProperties = { background: 'var(--dk-bg)', color: 'var(--dk-text)' }
const vMuted: CSSProperties = { color: 'var(--dk-muted)' }
const vAccent: CSSProperties = { color: 'var(--dk-accent)' }
const vSurface: CSSProperties = { background: 'var(--dk-surface)', borderColor: 'var(--dk-divider)' }
const vChip: CSSProperties = { background: 'var(--dk-accent)', color: 'var(--dk-accent-text)' }
const vAccentBorder: CSSProperties = { borderColor: 'var(--dk-accent)' }

const PILLAR_ICONS: LucideIcon[] = [Compass, TrendingUp, Users, Trophy]
const formatIcon = (f: string): LucideIcon => (/carou/i.test(f) ? LayoutGrid : /stor/i.test(f) ? CircleDot : Video)

/** Highlighted section title with a leading icon chip. */
function Title({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 self-start mb-3 shrink-0">
      <span className="grid place-items-center rounded" style={{ ...vChip, width: 30, height: 30 }}><Icon size={17} /></span>
      <span className="text-[15px] font-bold uppercase tracking-wide px-2 py-0.5 rounded" style={vChip}>{children}</span>
    </div>
  )
}

/** A slide. Content slides pin the title at top and CENTER the body in the remaining space. */
function Slide({ icon, title, children, center }: { icon?: LucideIcon; title?: string; children: React.ReactNode; center?: boolean }) {
  return (
    <section
      className={`deck-slide relative aspect-[16/9] w-full rounded-lg overflow-hidden border px-10 py-7 flex flex-col ${center ? 'items-center justify-center text-center' : ''}`}
      style={{ ...vBg, borderColor: 'var(--dk-divider)' }}
    >
      {!center && icon && title && <Title icon={icon}>{title}</Title>}
      {center ? children : <div className="flex-1 flex flex-col justify-center min-h-0">{children}</div>}
    </section>
  )
}

export function StrategyDeck({ result, colors }: { result: StrategyResult; colors: DeckColors }) {
  const { brief, doc } = result
  const date = new Date(result.generatedAt).toLocaleDateString()
  const accounts = result.accounts.filter((a) => a.followers >= 1000).slice(0, 12)
  const whatsWorking = doc.whatsWorking?.length
    ? doc.whatsWorking
    : result.hookSummaries.flatMap((s) => s.dominantHooks.slice(0, 2).map((h) => `@${s.handle} — ${h.pattern}`)).slice(0, 6)

  // Horizontal one-slide-at-a-time deck: native scroll-snap track + arrow controls. All slides
  // stay in the DOM so print (each .deck-slide → one landscape page) is unaffected.
  const trackRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [count, setCount] = useState(0)

  useLayoutEffect(() => {
    setCount(trackRef.current?.querySelectorAll('.deck-slide').length ?? 0)
  }, [result])

  const goTo = (i: number) => {
    const el = trackRef.current
    if (!el) return
    const next = Math.max(0, Math.min(count - 1, i))
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
  }
  const onScroll = () => {
    const el = trackRef.current
    if (!el) return
    setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }

  // ←/→ keys page through the deck when it's on screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(index + 1)
      else if (e.key === 'ArrowLeft') goTo(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count])

  return (
    <div className="deck-viewport relative">
      <div ref={trackRef} onScroll={onScroll} className="deck-printable deck-scroll" style={themeVars(colors) as CSSProperties}>
      {/* Cover */}
      <Slide center>
        <div className="flex flex-col items-center">
          <span className="grid place-items-center rounded-full mb-4" style={{ ...vChip, width: 56, height: 56 }}><Sparkles size={26} /></span>
          <div className="text-[13px] font-mono uppercase tracking-[0.2em]" style={vAccent}>Content Strategy · {date}</div>
          <h1 className="font-serif italic text-5xl mt-2">{brief.brandName || 'Untitled brand'}</h1>
          <p className="text-base mt-3 max-w-2xl" style={vMuted}>{brief.primaryNiche}{brief.subNiche ? ` · ${brief.subNiche}` : ''}</p>
          <p className="text-sm mt-4 px-3 py-1.5 rounded inline-flex items-center gap-2" style={vChip}><Target size={15} /> Drives toward: {brief.offer}</p>
        </div>
      </Slide>

      {/* What we understand */}
      <Slide icon={Compass} title="What we understand">
        <div className="grid grid-cols-3 gap-4">
          {([['Niche', brief.primaryNiche, MapPin], ['Speciality', brief.subNiche, Layers], ['The offer', brief.offer, Target]] as [string, string, LucideIcon][]).map(([k, v, Ic]) => (
            <div key={k} className="rounded-lg border p-5" style={vSurface}>
              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wide" style={vAccent}><Ic size={14} /> {k}</div>
              <div className="text-[15px] mt-2">{v || '—'}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border p-5 mt-4 flex items-start gap-3" style={vSurface}>
          <Users size={18} style={vAccent} className="mt-0.5 shrink-0" />
          <div><div className="text-[11px] font-mono uppercase tracking-wide" style={vAccent}>Target audience</div><div className="text-[15px] mt-1">{brief.audience || '—'}</div></div>
        </div>
      </Slide>

      {/* Positioning + gap diagram */}
      <Slide icon={Crosshair} title="Positioning">
        <p className="text-2xl leading-snug font-serif italic">{doc.positioning}</p>
        <div className="mt-6 rounded-lg border p-5" style={vSurface}>
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wide mb-2" style={vMuted}>
            <span>Where the niche is crowded</span><span style={vAccent}>Where {brief.brandName || 'this brand'} wins</span>
          </div>
          <div className="relative h-12 flex items-center">
            <div className="h-0.5 w-full" style={{ background: 'var(--dk-divider)' }} />
            <div className="absolute left-1 flex gap-1.5">
              {accounts.slice(0, 4).map((a) => <CreatorAvatar key={a.username} url={a.profilePicUrl} name={a.fullName || a.username} size={30} colors={colors} />)}
            </div>
            <ArrowRight size={20} style={vAccent} className="absolute left-1/2 -translate-x-1/2" />
            <div className="absolute right-1 grid place-items-center rounded-full" style={{ ...vChip, width: 42, height: 42 }}><Trophy size={20} /></div>
          </div>
          <p className="text-xs mt-2" style={vMuted}>{doc.competitiveSummary}</p>
        </div>
      </Slide>

      {/* Audience insight */}
      <Slide icon={Users} title="Audience insight">
        <div className="flex items-start gap-4">
          <span className="grid place-items-center rounded-xl shrink-0" style={{ ...vChip, width: 52, height: 52 }}><Lightbulb size={28} /></span>
          <div>
            <p className="text-xl leading-relaxed">{doc.audienceInsight}</p>
            <p className="text-xs mt-4" style={vMuted}>Client-stated target: {brief.audience}</p>
          </div>
        </div>
      </Slide>

      {/* Creators we analyzed (photos) */}
      <Slide icon={Users} title="Creators we analyzed">
        <div className="grid grid-cols-4 gap-4">
          {accounts.slice(0, 8).map((a) => (
            <div key={a.username} className="flex items-center gap-3 rounded-lg border p-3" style={vSurface}>
              <CreatorAvatar url={a.profilePicUrl} name={a.fullName || a.username} size={48} colors={colors} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold truncate flex items-center gap-1">@{a.username}{a.verified && <BadgeCheck size={13} style={vAccent} />}</div>
                <div className="text-[11px] font-mono" style={vMuted}>{fmt(a.followers)} · {a.engagementRate != null ? `${a.engagementRate.toFixed(1)}%` : '—'}</div>
                <div className="text-[10px] uppercase tracking-wide" style={vAccent}>{a.source}</div>
              </div>
            </div>
          ))}
        </div>
      </Slide>

      {/* Competitive landscape (ER chart) */}
      <Slide icon={BarChart3} title="Competitive landscape">
        <p className="text-sm mb-3" style={vMuted}>{doc.competitiveSummary}</p>
        <div className="text-[11px] font-mono uppercase tracking-wide mb-1" style={vAccent}>Engagement-rate leaders</div>
        <div className="w-[70%]"><ErBarChart accounts={result.accounts} colors={colors} height={260} /></div>
      </Slide>

      {/* What's working (+ pattern chart) */}
      <Slide icon={Sparkles} title="What's working in the niche">
        <div className="grid grid-cols-2 gap-6 items-center">
          <ul className="space-y-3">
            {whatsWorking.map((w, i) => (
              <li key={i} className="flex gap-2 text-[14px]"><span style={vAccent}>▹</span><span>{w}</span></li>
            ))}
          </ul>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wide mb-1" style={vAccent}>Most-used winning hooks</div>
            <HookPatternChart hookSummaries={result.hookSummaries} colors={colors} height={250} />
          </div>
        </div>
      </Slide>

      {/* Strategy map (Audience → Pillars → Offer) */}
      <Slide icon={Compass} title="The strategy at a glance">
        <div className="grid grid-cols-[1fr_auto_1.4fr_auto_1fr] items-stretch gap-3">
          <div className="rounded-xl border p-5 text-center flex flex-col justify-center" style={vSurface}>
            <Users size={30} style={vAccent} className="mx-auto" />
            <div className="text-base font-semibold mt-2">Audience</div>
            <div className="text-[12px] mt-1.5" style={vMuted}>{brief.audience}</div>
          </div>
          <ArrowRight size={26} style={vAccent} className="self-center" />
          <div className="rounded-xl border p-4 flex flex-col justify-center" style={vSurface}>
            <div className="text-[11px] font-mono uppercase tracking-wide text-center mb-2" style={vAccent}>4 content pillars</div>
            <div className="grid grid-cols-2 gap-2">
              {doc.contentPillars.slice(0, 4).map((p, i) => {
                const Ic = PILLAR_ICONS[i % PILLAR_ICONS.length]
                return <div key={i} className="flex items-center gap-1.5 text-[12px] rounded px-2 py-1.5" style={{ border: '1px solid var(--dk-divider)' }}><Ic size={13} style={vAccent} /><span className="truncate">{p.name}</span></div>
              })}
            </div>
          </div>
          <ArrowRight size={26} style={vAccent} className="self-center" />
          <div className="rounded-xl p-5 text-center flex flex-col justify-center" style={vChip}>
            <Target size={30} className="mx-auto" />
            <div className="text-base font-semibold mt-2">The offer</div>
            <div className="text-[12px] mt-1.5">{brief.offer}</div>
          </div>
        </div>
        <p className="text-center text-sm mt-6" style={vMuted}>Every pillar exists to move the audience toward the offer.</p>
      </Slide>

      {/* Content pillars */}
      <Slide icon={Layers} title="Content pillars">
        <div className="grid grid-cols-2 gap-4">
          {doc.contentPillars.map((p, i) => {
            const Ic = PILLAR_ICONS[i % PILLAR_ICONS.length]
            return (
              <div key={i} className="rounded-lg border p-5 flex gap-3" style={vSurface}>
                <span className="grid place-items-center rounded-lg shrink-0" style={{ ...vChip, width: 40, height: 40 }}><Ic size={21} /></span>
                <div><div className="text-base font-semibold" style={vAccent}>{p.name}</div><div className="text-sm mt-1">{p.description}</div></div>
              </div>
            )
          })}
        </div>
      </Slide>

      {/* Hook formulas */}
      <Slide icon={Anchor} title="Hook formulas">
        <div className="space-y-3">
          {doc.hookFormulas.map((h, i) => (
            <div key={i} className="flex gap-3">
              <Quote size={17} style={vAccent} className="shrink-0 mt-1" />
              <div>
                <span className="font-semibold" style={vAccent}>{h.name}: </span>
                <span className="text-[15px]">{h.template}</span>
                <div className="text-xs mt-0.5" style={vMuted}>e.g. "{h.example}"</div>
              </div>
            </div>
          ))}
        </div>
      </Slide>

      {/* Content ideas */}
      <Slide icon={Lightbulb} title="Content ideas">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {doc.contentIdeas.map((idea, i) => {
            const Ic = formatIcon(idea.format)
            return (
              <div key={i} className="flex gap-2 text-[13px]">
                <span className="grid place-items-center rounded-full shrink-0 text-[11px] font-bold" style={{ ...vChip, width: 22, height: 22 }}>{i + 1}</span>
                <div>
                  <span className="font-semibold">{idea.title}</span>
                  <span className="text-[11px] font-mono inline-flex items-center gap-1 ml-1" style={vMuted}><Ic size={11} />{idea.format} · {idea.pillar}</span>
                  <div className="text-xs mt-0.5" style={vMuted}>Hook: "{idea.hook}"</div>
                </div>
              </div>
            )
          })}
        </div>
      </Slide>

      {/* Format mix & cadence (donut) */}
      <Slide icon={PieIcon} title="Format mix & cadence">
        <div className="grid grid-cols-[200px_1fr] gap-8 items-center">
          <div className="flex justify-center"><FormatMixDonut formatMix={doc.formatMix} colors={colors} size={200} /></div>
          <div className="space-y-3">
            {doc.formatMix.map((f, i) => {
              const Ic = formatIcon(f.format)
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-sm font-semibold w-28"><Ic size={16} style={vAccent} />{f.format}</span>
                  <span className="text-sm px-2 py-0.5 rounded" style={vChip}>{f.weight}</span>
                  <span className="text-xs flex-1" style={vMuted}>{f.rationale}</span>
                </div>
              )
            })}
          </div>
        </div>
        <p className="text-base mt-6 flex items-center gap-2"><CircleDot size={16} style={vAccent} /><span className="font-semibold" style={vAccent}>{doc.cadence.postsPerWeek}</span> — {doc.cadence.notes}</p>
      </Slide>

      {/* Voice & tone */}
      <Slide icon={Volume2} title="Voice & tone">
        <div className="flex items-start gap-4">
          <span className="grid place-items-center rounded-xl shrink-0" style={{ ...vChip, width: 52, height: 52 }}><Megaphone size={28} /></span>
          <p className="text-xl leading-relaxed">{doc.voiceAndTone}</p>
        </div>
      </Slide>

      {/* Guardrails */}
      <Slide icon={ShieldCheck} title="Guardrails">
        <div className="grid grid-cols-2 gap-8">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide mb-3" style={vAccent}>Do</div>
            <ul className="space-y-2 text-sm">{doc.dos.map((d, i) => (
              <li key={i} className="flex gap-2"><span className="grid place-items-center rounded-full shrink-0 mt-0.5" style={{ ...vChip, width: 18, height: 18 }}><Check size={12} /></span>{d}</li>
            ))}</ul>
          </div>
          <div>
            <div className="text-sm font-bold uppercase tracking-wide mb-3" style={vMuted}>Don't</div>
            <ul className="space-y-2 text-sm" style={vMuted}>{doc.donts.map((d, i) => (
              <li key={i} className="flex gap-2"><span className="grid place-items-center rounded-full shrink-0 mt-0.5 border" style={vAccentBorder}><X size={12} style={vAccent} /></span>{d}</li>
            ))}</ul>
          </div>
        </div>
        <p className="text-xs mt-5" style={vMuted}>Language: {brief.language}. Off-limits: {brief.offLimits || '—'}.</p>
      </Slide>

      {/* Close */}
      <Slide center>
        <div className="flex flex-col items-center">
          <span className="grid place-items-center rounded-full mb-4" style={{ ...vChip, width: 52, height: 52 }}><Flag size={24} /></span>
          <div className="text-[13px] font-mono uppercase tracking-[0.2em]" style={vAccent}>Let's build</div>
          <h2 className="font-serif italic text-4xl mt-2">{brief.brandName}</h2>
          <p className="text-sm mt-3 max-w-xl" style={vMuted}>Repeat what works, eliminate what doesn't.</p>
        </div>
      </Slide>
      </div>

      {/* Arrow controls + slide counter (screen only — hidden in print) */}
      <button
        type="button"
        onClick={() => goTo(index - 1)}
        disabled={index <= 0}
        aria-label="Previous slide"
        className="no-print absolute left-2 top-1/2 -translate-y-1/2 z-10 grid place-items-center w-11 h-11 rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/75 disabled:opacity-0 disabled:pointer-events-none transition-colors"
      >
        <ChevronLeft size={24} />
      </button>
      <button
        type="button"
        onClick={() => goTo(index + 1)}
        disabled={index >= count - 1}
        aria-label="Next slide"
        className="no-print absolute right-2 top-1/2 -translate-y-1/2 z-10 grid place-items-center w-11 h-11 rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/75 disabled:opacity-0 disabled:pointer-events-none transition-colors"
      >
        <ChevronRight size={24} />
      </button>
      {count > 1 && (
        <div className="no-print absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          <div className="font-mono text-xs text-white bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1">
            {index + 1} / {count}
          </div>
        </div>
      )}
    </div>
  )
}
