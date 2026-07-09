/**
 * StrategyDeck - client-ready proposal deck for the Content Strategizing workflow.
 *
 * The generated ContentStrategyDoc now follows the Fobet-style proposal arc: agency proof,
 * client understanding, diagnosis, category tension, strategy system, execution, KPIs,
 * deliverables, team, commercials, and close. All slides remain mounted for print-to-PDF.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowRight, BadgeCheck, BarChart3, Check, ChevronLeft, ChevronRight, CircleDot,
  ClipboardList, Compass, DollarSign, Flag, LayoutGrid, Lightbulb, Megaphone,
  PieChart as PieIcon, ShieldCheck, Sparkles, Target, TrendingUp, Trophy,
  Users, Video, X, type LucideIcon,
} from 'lucide-react'
import type { StrategyResult } from '../domain/strategy'
import { themeVars, type DeckColors } from '../lib/deckThemes'
import { CreatorAvatar, FormatMixDonut, HookPatternChart } from './strategyVisuals'

const fmt = (n: number) => n.toLocaleString()

const vBg: CSSProperties = { background: 'var(--dk-bg)', color: 'var(--dk-text)' }
const vMuted: CSSProperties = { color: 'var(--dk-muted)' }
const vAccent: CSSProperties = { color: 'var(--dk-accent)' }
const vSurface: CSSProperties = { background: 'var(--dk-surface)', borderColor: 'var(--dk-divider)' }
const vChip: CSSProperties = { background: 'var(--dk-accent)', color: 'var(--dk-accent-text)' }
const vFill: CSSProperties = { background: 'var(--dk-fill)', color: 'var(--dk-fill-text)' }
const vAccentBorder: CSSProperties = { borderColor: 'var(--dk-accent)' }

// The reference deck opens the proposal and closes the commercials on solid black slides.
const DARK_BG = '#0A0A0A'
const DARK_TEXT = '#F5EDD6'
const DARK_MUTED = '#B8B0A8'

const PILLAR_ICONS: LucideIcon[] = [Compass, TrendingUp, Users, Trophy]
const formatIcon = (f: string): LucideIcon => (/carou/i.test(f) ? LayoutGrid : /stor/i.test(f) ? CircleDot : Video)
const list = (items: string[] | undefined, fallback: string[] = []) => (items?.length ? items : fallback)

function Title({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="self-start mb-4 shrink-0">
      <div className="flex items-center gap-2">
        <Icon size={18} style={vAccent} />
        <h3 className="text-xl font-bold tracking-tight uppercase" style={{ color: 'var(--dk-text)' }}>{children}</h3>
      </div>
      <div className="mt-1.5 h-[3px] w-14 rounded-full" style={{ background: 'var(--dk-accent)' }} />
    </div>
  )
}

function Slide({ icon, title, children, center, dark }: { icon?: LucideIcon; title?: string; children: React.ReactNode; center?: boolean; dark?: boolean }) {
  const surface = dark ? { background: DARK_BG, color: DARK_TEXT } : vBg
  return (
    <section
      className={`deck-slide relative aspect-[16/9] w-full rounded-lg overflow-hidden border px-10 py-7 flex flex-col ${center ? 'items-center justify-center text-center' : ''}`}
      style={{ ...surface, borderColor: dark ? 'rgba(255,255,255,0.12)' : 'var(--dk-divider)' }}
    >
      {!center && icon && title && <Title icon={icon}>{title}</Title>}
      {center ? children : <div className="flex-1 flex flex-col justify-center min-h-0">{children}</div>}
    </section>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border p-4 text-center" style={vSurface}>
      <div className="font-mono text-2xl" style={vAccent}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide mt-1" style={vMuted}>{label}</div>
    </div>
  )
}

function BulletList({ items, icon: Icon = Check }: { items: string[]; icon?: LucideIcon }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-[14px] leading-snug">
          <span className="grid place-items-center rounded-full shrink-0 mt-0.5" style={{ ...vChip, width: 18, height: 18 }}><Icon size={11} /></span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function StrategyDeck({ result, colors }: { result: StrategyResult; colors: DeckColors }) {
  const { brief, doc } = result
  const date = new Date(result.generatedAt).toLocaleDateString()
  const accounts = result.accounts.filter((a) => a.followers >= 1000).slice(0, 12)
  const topAccounts = accounts.slice(0, 8)
  const whatsWorking = list(
    doc.whatsWorking,
    result.hookSummaries.flatMap((s) => s.dominantHooks.slice(0, 2).map((h) => `@${s.handle} - ${h.pattern}`)).slice(0, 6),
  )
  const clientUnderstanding = doc.clientUnderstanding || `${brief.brandName || 'This brand'} operates in ${brief.primaryNiche || 'its category'}${brief.subNiche ? `, with a focus on ${brief.subNiche}` : ''}. The content system must build trust while moving the right audience toward ${brief.offer || 'the offer'}.`
  const currentFlaw = doc.currentMarketingFlaw || 'The likely risk is sounding like the rest of the category: product-first, feature-led, and not memorable enough to build trust before the sales conversation.'
  const tension = doc.categoryTension?.headline || `${brief.primaryNiche || 'This category'} has a trust gap. That gap is the content opportunity.`
  const tensionBullets = list(doc.categoryTension?.bullets, [
    'People need confidence before they act, especially when the decision carries money, reputation, or lifestyle risk.',
    'Most competitors explain the offer, but few make the audience feel understood.',
    'The winning page will translate expertise into repeatable, human-led content.',
  ])
  const benchmarks = doc.benchmarks?.length ? doc.benchmarks : topAccounts.slice(0, 3).map((a) => ({
    name: `@${a.username}`,
    metric: `${fmt(a.followers)} followers${a.engagementRate != null ? ` / ${a.engagementRate.toFixed(1)}% ER` : ''}`,
    lesson: 'Use focused positioning and repeatable hooks to make expertise easier to remember.',
  }))
  const hhh = doc.heroHubHygiene?.length ? doc.heroHubHygiene : [
    { name: 'Hero', role: 'WHAT + WHY', description: doc.positioning || 'Big narrative content that reframes the category and gives the audience a reason to care.', examples: whatsWorking.slice(0, 3) },
    { name: 'Hub', role: 'WHEN', description: 'Situational content that meets the audience inside real moments of doubt, desire, or decision.', examples: doc.contentIdeas.slice(0, 3).map((i) => i.title) },
    { name: 'Hygiene', role: 'HOW', description: 'Educational content that makes the ecosystem easier to understand and reduces buying friction.', examples: doc.contentPillars.slice(0, 3).map((p) => p.name) },
  ]
  const roadmap = doc.executionRoadmap?.length ? doc.executionRoadmap : [
    { phase: 'Step 1', title: 'Strategy & Governance', description: 'Define the category narrative, monthly priorities, content pillars, and review rituals.' },
    { phase: 'Step 2', title: 'Creative & Production', description: 'Turn the strategy into scripts, formats, creator-led shoots, edits, and publishing assets.' },
    { phase: 'Step 3', title: 'Publishing & Optimisation', description: 'Ship consistently, read retention and engagement signals, then double down on the strongest IPs.' },
  ]
  const creatorFormats = list(doc.creatorFirstFormats, ['Talking head formats', 'Storytelling with location changes', 'Stitch/reaction content', 'Point-of-view content', 'Mixed media + voiceover', 'Carousel explainers'])
  const operatingRhythm = list(doc.operatingRhythm, ['Monthly content calendar', 'Weekly hook and retention review', 'Engagement signal tracking', 'Continuous testing of IPs and formats', 'Prune weak ideas and scale winners'])
  const kpis = doc.kpiFramework ?? { leading: [], mid: [], lag: [] }
  const successGoals = doc.successGoals?.length ? doc.successGoals : [
    { metric: 'Follower base', target: 'Qualified audience growth over 6 months' },
    { metric: 'Organic views', target: 'Consistent monthly reach from repeatable formats' },
    { metric: 'Engagement rate', target: 'Healthy saves, shares, comments, and DMs' },
    { metric: 'Brand search', target: 'More direct demand for the brand and offer' },
  ]
  const deliverables = doc.monthlyDeliverables?.length ? doc.monthlyDeliverables : [
    { platform: 'Instagram', format: 'Face-led brand reels', frequency: doc.cadence.postsPerWeek || 'Weekly' },
    { platform: 'Instagram', format: 'Carousels', frequency: '2-3 per week' },
    { platform: 'Instagram', format: 'Stories', frequency: 'Daily' },
  ]
  const team = doc.teamSystem?.length ? doc.teamSystem : [
    { role: 'Content Strategist', responsibility: 'Category research, strategy, calendar planning, and weekly optimisation.' },
    { role: 'Content Writer', responsibility: 'Hooks, scripts, captions, and narrative development.' },
    { role: 'Video Editor', responsibility: 'Short-form edits, retention pacing, and post-production.' },
    { role: 'Growth Analyst', responsibility: 'Performance tracking, trend monitoring, and growth recommendations.' },
  ]
  const commercials = doc.commercials ?? { monthlyRetainer: '', lineItems: [], longTermValue: [] }
  const lineItems = commercials.lineItems?.length ? commercials.lineItems : [
    { label: 'Strategy, scripting, production guidance, publishing, and optimisation', amount: 'To be discussed' },
  ]
  const longTermValue = list(commercials.longTermValue, [
    'A durable content library that keeps creating trust after publishing.',
    'A clearer category position that makes the brand easier to remember.',
    'Higher inbound trust by educating before selling.',
  ])

  const trackRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [count, setCount] = useState(0)

  useLayoutEffect(() => {
    setCount(trackRef.current?.querySelectorAll('.deck-slide').length ?? 0)
  }, [result])

  // Force landscape 16:9 print pages ONLY while the deck is on screen. A CSS named @page
  // (`@page deck-page`) is silently ignored by Chrome's print path — the deck printed onto
  // portrait Letter, so every 13.333in-wide slide was clipped on the right and left the bottom
  // of the page blank. A global @page reliably sets the size/orientation and drops the browser
  // header/footer (margin: 0); we inject it on mount and remove it on unmount so the portrait
  // report export elsewhere in the app is unaffected.
  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-deck-print', '')
    style.textContent = '@media print { @page { size: 13.333in 7.5in; margin: 0; } }'
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

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
        <Slide center>
          <div className="flex flex-col items-center">
            <div className="text-[13px] font-mono uppercase tracking-[0.2em]" style={vAccent}>Fobet Media Content Marketing Division</div>
            <h1 className="font-serif italic text-5xl mt-4">Content Strategy Proposal</h1>
            <p className="text-base mt-3 max-w-2xl" style={vMuted}>For {brief.brandName || 'your brand'} - {brief.primaryNiche || 'category growth'}{brief.subNiche ? ` / ${brief.subNiche}` : ''}</p>
            <p className="text-sm mt-4 px-3 py-1.5 rounded inline-flex items-center gap-2" style={vChip}><Target size={15} /> Built to drive: {brief.offer || 'the offer'}</p>
            <div className="text-[11px] font-mono uppercase tracking-[0.18em] mt-5" style={vMuted}>{date}</div>
          </div>
        </Slide>

        <Slide icon={Sparkles} title="Who we are">
          <div className="grid grid-cols-3 gap-4">
            <Metric value="50M+" label="Monthly organic views" />
            <Metric value="2.1M+" label="Creator audience scaled" />
            <Metric value="100%" label="Organic influence system" />
          </div>
          <p className="text-2xl leading-snug font-serif italic mt-6">We build social presence for leaders and brands using a tested creator playbook: strategy, scripting, production, distribution, and performance review.</p>
        </Slide>

        <Slide icon={Trophy} title="Proof of playbook">
          <div className="grid grid-cols-3 gap-4">
            {['Riya Upreti', 'Dr. Siddhant Bhargava', 'Rajneesh Upreti'].map((name, i) => (
              <div key={name} className="rounded-lg border p-5" style={vSurface}>
                <div className="font-serif italic text-2xl" style={vAccent}>{['2.1M', '644K', '290K'][i]}</div>
                <div className="text-base font-semibold mt-2">{name}</div>
                <div className="text-xs mt-2" style={vMuted}>Scaled through content systems, repeatable hooks, and organic distribution.</div>
              </div>
            ))}
          </div>
        </Slide>

        <Slide icon={Megaphone} title="What we do">
          <div className="grid grid-cols-3 gap-4">
            {[
              ['Instagram as a service', 'Thumb-stopping reels, carousels, stories, and trends that grow reach and revenue.'],
              ['Distribution as a service', 'Channel creation, creator selection, content ideation, publishing, and scaling.'],
              ['360 degree social capital', 'A multi-platform ecosystem across video, social storytelling, PR, and community signals.'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-2xl p-5" style={vFill}>
                <div className="text-lg font-bold">{title}</div>
                <p className="text-sm mt-3 opacity-90">{body}</p>
              </div>
            ))}
          </div>
          <p className="text-center font-bold text-lg mt-6">Stop chasing attention. <span style={vAccent}>Create your own.</span></p>
        </Slide>

        <Slide center dark>
          <div className="text-[13px] font-mono uppercase tracking-[0.25em]" style={{ color: DARK_MUTED }}>Our proposal for</div>
          <h2 className="font-serif italic text-6xl mt-3" style={vAccent}>{brief.brandName || 'Your Brand'}</h2>
        </Slide>

        <Slide icon={Compass} title="What we understand of you">
          <p className="text-2xl leading-snug font-serif italic">{clientUnderstanding}</p>
          <div className="grid grid-cols-3 gap-4 mt-6">
            {([['Niche', brief.primaryNiche], ['Speciality', brief.subNiche], ['Offer', brief.offer]] as [string, string][]).map(([k, v]) => (
              <div key={k} className="rounded-lg border p-4" style={vSurface}>
                <div className="text-[11px] font-mono uppercase tracking-wide" style={vAccent}>{k}</div>
                <div className="text-sm mt-2">{v || '-'}</div>
              </div>
            ))}
          </div>
        </Slide>

        <Slide icon={X} title="The flaw with the current marketing strategy">
          <p className="text-3xl leading-snug font-serif italic">{currentFlaw}</p>
          <div className="grid grid-cols-2 gap-4 mt-6">
            <BulletList icon={X} items={['Product-first content becomes interchangeable.', 'Trust is stated, not translated into memorable human proof.', 'A single page cannot multiply one strong idea into a distribution system.', 'Hooks often explain the offer before creating emotional urgency.']} />
            <div className="rounded-lg border p-5" style={vSurface}>
              <div className="text-[11px] font-mono uppercase tracking-wide" style={vAccent}>Strategic correction</div>
              <p className="text-lg mt-2">{doc.positioning || 'Build a human-led content system that makes the brand the most trusted voice in its category.'}</p>
            </div>
          </div>
        </Slide>

        <Slide icon={Lightbulb} title="The tension in this category">
          <p className="text-2xl leading-snug font-serif italic mb-5">{tension}</p>
          <BulletList items={tensionBullets} />
        </Slide>

        <Slide icon={Users} title="The benchmark">
          <div className="grid grid-cols-2 gap-4">
            {benchmarks.slice(0, 4).map((b, i) => (
              <div key={i} className="rounded-lg border p-4" style={vSurface}>
                <div className="text-lg font-semibold" style={vAccent}>{b.name}</div>
                <div className="text-[11px] font-mono uppercase tracking-wide mt-1" style={vMuted}>{b.metric}</div>
                <p className="text-sm mt-3">{b.lesson}</p>
              </div>
            ))}
          </div>
          <p className="text-sm mt-5" style={vMuted}>The lesson: build one clear brand handle, strong human presence, and focused content lanes that compound over time.</p>
        </Slide>

        <Slide icon={BarChart3} title="Creators we analyzed">
          <div className="grid grid-cols-4 gap-4">
            {topAccounts.map((a) => (
              <div key={a.username} className="flex items-center gap-3 rounded-lg border p-3" style={vSurface}>
                <CreatorAvatar url={a.profilePicUrl} name={a.fullName || a.username} size={48} colors={colors} />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold truncate flex items-center gap-1">@{a.username}{a.verified && <BadgeCheck size={13} style={vAccent} />}</div>
                  <div className="text-[11px] font-mono" style={vMuted}>{fmt(a.followers)} - {a.engagementRate != null ? `${a.engagementRate.toFixed(1)}%` : '-'}</div>
                  <div className="text-[10px] uppercase tracking-wide" style={vAccent}>{a.source}</div>
                </div>
              </div>
            ))}
          </div>
        </Slide>

        <Slide icon={Sparkles} title="What is working in the niche">
          <div className="grid grid-cols-2 gap-6 items-center">
            <BulletList items={whatsWorking} />
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wide mb-1" style={vAccent}>Most-used winning hooks</div>
              <HookPatternChart hookSummaries={result.hookSummaries} colors={colors} height={250} />
            </div>
          </div>
        </Slide>

        <Slide icon={Compass} title="Our content strategy">
          <div className="grid grid-cols-3 gap-4">
            {hhh.slice(0, 3).map((row) => (
              <div key={row.name} className="rounded-2xl p-5" style={vFill}>
                <div className="text-2xl font-bold uppercase tracking-wide">{row.name}</div>
                <div className="text-[11px] font-mono uppercase tracking-wide mt-1 opacity-70">{row.role}</div>
                <p className="text-sm mt-3">{row.description}</p>
                <ul className="mt-3 space-y-1.5 text-xs opacity-80">
                  {row.examples.slice(0, 3).map((e, i) => <li key={i}>- {e}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Slide>

        <Slide icon={Target} title="Strategy map">
          <div className="grid grid-cols-[1fr_auto_1.4fr_auto_1fr] items-stretch gap-3">
            <div className="rounded-xl border p-5 text-center flex flex-col justify-center" style={vSurface}>
              <Users size={30} style={vAccent} className="mx-auto" />
              <div className="text-base font-semibold mt-2">Audience</div>
              <div className="text-[12px] mt-1.5" style={vMuted}>{brief.audience}</div>
            </div>
            <ArrowRight size={26} style={vAccent} className="self-center" />
            <div className="rounded-xl border p-4 flex flex-col justify-center" style={vSurface}>
              <div className="text-[11px] font-mono uppercase tracking-wide text-center mb-2" style={vAccent}>Content pillars</div>
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
        </Slide>

        <Slide icon={ClipboardList} title="Execution & logistical roadmap">
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(roadmap.length, 4)}, minmax(0, 1fr))` }}>
            {roadmap.slice(0, 4).map((r, i) => (
              <div key={i} className="rounded-2xl p-5 flex flex-col" style={vFill}>
                <div className="text-[11px] font-mono uppercase tracking-wide opacity-70">{r.phase}</div>
                <div className="font-bold text-base mt-1">{r.title}</div>
                <div className="text-sm mt-2 opacity-90">{r.description}</div>
              </div>
            ))}
          </div>
        </Slide>

        <Slide icon={Video} title="Creator first content">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide mb-3" style={vAccent}>Content formats to expect</div>
              <BulletList items={creatorFormats} />
            </div>
            <div>
              <div className="text-sm font-bold uppercase tracking-wide mb-3" style={vAccent}>Operating rhythm</div>
              <BulletList items={operatingRhythm} />
            </div>
          </div>
        </Slide>

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
          <p className="text-base mt-6 flex items-center gap-2"><CircleDot size={16} style={vAccent} /><span className="font-semibold" style={vAccent}>{doc.cadence.postsPerWeek}</span> - {doc.cadence.notes}</p>
        </Slide>

        <Slide icon={BarChart3} title="Measuring performance and success">
          <div className="grid grid-cols-3 gap-4">
            {[
              ['Leading indicators', list(kpis.leading, ['Organic reach', 'Organic views', 'Average view duration'])],
              ['Mid indicators', list(kpis.mid, ['Shares, saves, likes, comments', 'DM volume', 'Profile visits'])],
              ['Lag indicators', list(kpis.lag, ['Follower growth rate', 'Brand search increase', 'Assisted website/app traffic'])],
            ].map(([title, items]) => (
              <div key={title as string} className="rounded-2xl p-5" style={vFill}>
                <div className="text-base font-bold">{title as string}</div>
                <ul className="text-sm mt-3 space-y-2 opacity-90">{(items as string[]).map((x, i) => <li key={i}>- {x}</li>)}</ul>
              </div>
            ))}
          </div>
        </Slide>

        <Slide icon={Trophy} title="Goals for success">
          <div className="grid grid-cols-2 gap-4">
            {successGoals.slice(0, 6).map((g, i) => (
              <div key={i} className="rounded-lg border p-5" style={vSurface}>
                <div className="text-[11px] font-mono uppercase tracking-wide" style={vMuted}>{g.metric}</div>
                <div className="text-xl font-serif italic mt-2" style={vAccent}>{g.target}</div>
              </div>
            ))}
          </div>
        </Slide>

        <Slide icon={ClipboardList} title="Monthly deliverables">
          <div className="rounded-lg border overflow-hidden" style={vSurface}>
            <div className="grid grid-cols-[1fr_1.5fr_1fr] gap-3 px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={vFill}>
              <div>Platform</div><div>Format</div><div>Frequency</div>
            </div>
            {deliverables.map((d, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.5fr_1fr] gap-3 p-4 border-b last:border-b-0" style={{ borderColor: 'var(--dk-divider)' }}>
                <div className="font-semibold">{d.platform}</div>
                <div className="text-sm" style={vMuted}>{d.format}</div>
                <div className="text-sm font-mono" style={vAccent}>{d.frequency}</div>
              </div>
            ))}
          </div>
        </Slide>

        <Slide icon={Users} title="Team & execution system">
          <div className="grid grid-cols-2 gap-4">
            {team.slice(0, 6).map((member, i) => (
              <div key={i} className="rounded-lg border p-4" style={vSurface}>
                <div className="font-semibold" style={vAccent}>{member.role}</div>
                <p className="text-sm mt-2">{member.responsibility}</p>
              </div>
            ))}
          </div>
        </Slide>

        <Slide icon={DollarSign} title="Commercials" dark>
          <div className="grid grid-cols-[0.9fr_1.3fr] gap-8 items-start">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wide" style={{ color: DARK_MUTED }}>Monthly retainer</div>
              <div className="font-serif italic text-5xl mt-2" style={vAccent}>{commercials.monthlyRetainer || 'To be discussed'}</div>
              <div className="mt-6 space-y-2">
                {lineItems.map((item, i) => (
                  <div key={i} className="flex justify-between gap-4 text-sm border-b pb-2" style={{ borderColor: 'rgba(255,255,255,0.14)' }}>
                    <span>{item.label}</span>
                    <span className="font-mono shrink-0" style={vAccent}>{item.amount}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wide mb-3" style={vAccent}>Expected long-term brand value</div>
              <ul className="space-y-2.5 text-sm" style={{ color: DARK_TEXT }}>
                {longTermValue.map((v, i) => (
                  <li key={i} className="flex gap-2"><span style={vAccent}>*</span><span>{v}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </Slide>

        <Slide icon={ShieldCheck} title="Guardrails">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide mb-3" style={vAccent}>Do</div>
              <BulletList items={doc.dos} />
            </div>
            <div>
              <div className="text-sm font-bold uppercase tracking-wide mb-3" style={vMuted}>Don't</div>
              <ul className="space-y-2 text-sm" style={vMuted}>{doc.donts.map((d, i) => (
                <li key={i} className="flex gap-2"><span className="grid place-items-center rounded-full shrink-0 mt-0.5 border" style={vAccentBorder}><X size={12} style={vAccent} /></span>{d}</li>
              ))}</ul>
            </div>
          </div>
          <p className="text-xs mt-5" style={vMuted}>Language: {brief.language}. Off-limits: {brief.offLimits || '-'}.</p>
        </Slide>

        <Slide center>
          <div className="flex flex-col items-center">
            <span className="grid place-items-center rounded-full mb-4" style={{ ...vChip, width: 52, height: 52 }}><Flag size={24} /></span>
            <div className="text-[13px] font-mono uppercase tracking-[0.2em]" style={vAccent}>Let's chat</div>
            <h2 className="font-serif italic text-4xl mt-2">{brief.brandName || 'Your brand'}</h2>
            <p className="text-sm mt-3 max-w-xl" style={vMuted}>Stop chasing attention. Create your own.</p>
          </div>
        </Slide>
      </div>

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
