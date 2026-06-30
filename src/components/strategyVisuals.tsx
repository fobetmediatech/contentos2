/**
 * Visual elements for the Content Strategy deck — creator avatars (proxied IG photos with an
 * initials fallback) and theme-aware recharts (format-mix donut, engagement-rate bars, hook-pattern
 * bars). The bar charts use ResponsiveContainer so they fill their column and never overflow a slide;
 * the donut stays fixed-size (it's intrinsically square).
 */
import { useState } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, LabelList, ResponsiveContainer } from 'recharts'
import type { AnalyzedAccount, ContentStrategyDoc } from '../domain/strategy'
import type { CreatorHookSummary } from '../ai/prompts/creatorHookSummary'
import { shades, type DeckColors } from '../lib/deckThemes'

export function CreatorAvatar({ url, name, size = 56, colors }: { url?: string; name: string; size?: number; colors: DeckColors }) {
  const [failed, setFailed] = useState(false)
  const initials = (name || '?').replace(/^@/, '').slice(0, 2).toUpperCase()
  const src = url ? `/api/image-proxy?u=${encodeURIComponent(url)}` : ''
  const ring = `2px solid ${colors.accent}`
  if (!src || failed) {
    return (
      <div
        className="rounded-full flex items-center justify-center font-bold shrink-0"
        style={{ width: size, height: size, background: colors.surface, color: colors.accent, fontSize: size * 0.32, border: ring }}
      >
        {initials}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size, border: ring }}
    />
  )
}

/** Donut of the recommended format split. */
export function FormatMixDonut({ formatMix, colors, size = 196 }: { formatMix: ContentStrategyDoc['formatMix']; colors: DeckColors; size?: number }) {
  const data = formatMix.map((f) => ({ name: f.format, value: parseFloat(f.weight) || 0 })).filter((d) => d.value > 0)
  if (data.length === 0) return null
  const palette = shades(colors.accent, data.length)
  return (
    <PieChart width={size} height={size}>
      <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={size * 0.28} outerRadius={size * 0.46} stroke="none">
        {data.map((_, i) => <Cell key={i} fill={palette[i]} />)}
      </Pie>
    </PieChart>
  )
}

/** Horizontal bars of engagement rate for the strongest analyzed accounts. Fills its column width. */
export function ErBarChart({ accounts, colors, height = 240 }: { accounts: AnalyzedAccount[]; colors: DeckColors; height?: number }) {
  const data = accounts
    .filter((a) => a.engagementRate != null)
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
    .slice(0, 7)
    .map((a) => ({ name: `@${a.username}`, er: Number((a.engagementRate ?? 0).toFixed(2)) }))
  if (data.length === 0) return null
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 40 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={128} tick={{ fill: colors.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Bar dataKey="er" fill={colors.accent} radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false}>
            <LabelList dataKey="er" position="right" formatter={(v) => `${String(v)}%`} fill={colors.text} fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Horizontal bars of the most common winning hook patterns (aggregated from HookMap). Fills its column. */
export function HookPatternChart({ hookSummaries, colors, height = 240 }: { hookSummaries: CreatorHookSummary[]; colors: DeckColors; height?: number }) {
  const agg = new Map<string, number>()
  for (const s of hookSummaries) for (const h of s.dominantHooks) agg.set(h.pattern, (agg.get(h.pattern) ?? 0) + h.count)
  const data = [...agg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([pattern, count]) => ({ name: pattern.length > 24 ? pattern.slice(0, 22) + '…' : pattern, count }))
  if (data.length === 0) return null
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={150} tick={{ fill: colors.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <Bar dataKey="count" fill={colors.accent} radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false}>
            <LabelList dataKey="count" position="right" fill={colors.text} fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
