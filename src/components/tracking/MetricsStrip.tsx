import type { AccountSnapshot, ReelSnapshot } from '../../lib/trackingDb'
import { InfoPopover } from './InfoPopover'

interface MetricsStripProps {
  latestSnapshot: AccountSnapshot | null
  latestReels: ReelSnapshot[]
}

interface MetricInfo {
  title: string
  formula?: string
  significance: string
}

interface MetricCardProps {
  label: string
  value: string
  sub?: string
  info?: MetricInfo
}

function MetricCard({ label, value, sub, info }: MetricCardProps) {
  return (
    <div className="bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.08)] rounded-xl px-4 py-3 flex flex-col gap-1">
      {/* min-h reserves two lines so single- and two-line labels keep their
          values aligned across the strip (uniform card titles). */}
      <div className="flex items-start justify-between gap-1 min-h-[2.25rem]">
        <span className="text-[var(--color-text-muted)] text-xs font-medium font-mono uppercase tracking-wider leading-tight">
          {label}
        </span>
        {info && (
          <InfoPopover title={info.title} formula={info.formula} significance={info.significance} />
        )}
      </div>
      <span className="text-[var(--color-text-primary)] text-xl font-mono tabular-nums font-medium">{value}</span>
      {sub && <span className="text-[var(--color-text-muted)] text-[11px] font-mono">{sub}</span>}
    </div>
  )
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

export function MetricsStrip({ latestSnapshot, latestReels }: MetricsStripProps) {
  const followers = latestSnapshot?.followers_count ?? null

  // Aggregate reel metrics from latest batch
  const reelCount = latestReels.length
  const avgViews =
    reelCount > 0
      ? latestReels.reduce((s, r) => s + r.views_count, 0) / reelCount
      : null
  const avgLikes =
    reelCount > 0
      ? latestReels.reduce((s, r) => s + r.likes_count, 0) / reelCount
      : null
  const avgComments =
    reelCount > 0
      ? latestReels.reduce((s, r) => s + r.comments_count, 0) / reelCount
      : null

  const reelER =
    avgViews != null && avgViews > 0 && avgLikes != null && avgComments != null
      ? (avgLikes + avgComments) / avgViews
      : null

  const followerER =
    followers != null && followers > 0 && avgLikes != null && avgComments != null
      ? (avgLikes + avgComments) / followers
      : null

  const likeViewsRatio =
    avgViews != null && avgViews > 0 && avgLikes != null
      ? avgLikes / avgViews
      : null

  const na = '—'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      <MetricCard
        label="Followers"
        value={followers != null ? fmt(followers) : na}
        info={{
          title: 'Followers',
          significance:
            'Current follower count from the most recent profile scrape. The headline reach number for the account.',
        }}
      />
      <MetricCard
        label="View ER"
        value={reelER != null ? pct(reelER) : na}
        info={{
          title: 'View Engagement Rate',
          formula: '(avg likes + avg comments) ÷ avg views',
          significance:
            'Engagement relative to reach — how compelling the reels are to the people who actually saw them. A strong hook and watch-worthy content push this up.',
        }}
      />
      <MetricCard
        label="Follower ER"
        value={followerER != null ? pct(followerER) : na}
        info={{
          title: 'Follower Engagement Rate',
          formula: '(avg likes + avg comments) ÷ followers',
          significance:
            'Engagement relative to audience size — how active the following is. A loyal, engaged audience keeps this high even as the account grows.',
        }}
      />
      <MetricCard
        label="Avg Views"
        value={avgViews != null ? fmt(Math.round(avgViews)) : na}
        sub="per reel"
        info={{
          title: 'Average Views per Reel',
          formula: 'mean(views) across scraped reels',
          significance: 'Typical reach of a reel in the current scrape window.',
        }}
      />
      <MetricCard
        label="Avg Likes"
        value={avgLikes != null ? fmt(Math.round(avgLikes)) : na}
        sub="per reel"
        info={{
          title: 'Average Likes per Reel',
          formula: 'mean(likes) across scraped reels',
          significance: 'Typical likes a reel earns — a baseline read on resonance.',
        }}
      />
      <MetricCard
        label="Avg Comments"
        value={avgComments != null ? fmt(Math.round(avgComments)) : na}
        sub="per reel"
        info={{
          title: 'Average Comments per Reel',
          formula: 'mean(comments) across scraped reels',
          significance:
            'Typical comments a reel earns. Comments are higher-effort than likes, so this signals deeper engagement.',
        }}
      />
      <MetricCard
        label="Like/Views"
        value={likeViewsRatio != null ? pct(likeViewsRatio) : na}
        sub="ratio"
        info={{
          title: 'Like-to-View Ratio',
          formula: 'avg likes ÷ avg views',
          significance:
            'Share of viewers who liked — a quick read on how well content resonates beyond simply being seen.',
        }}
      />
    </div>
  )
}
