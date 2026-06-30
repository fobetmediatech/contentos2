import { Link } from 'react-router-dom'
import { RefreshCw, AlertCircle, CheckCircle, Clock } from 'lucide-react'
import type { TrackedAccount, AccountSnapshot, ReelSnapshot } from '../../lib/trackingDb'
import type { FetchPhase } from '../../lib/trackingClient'

interface AccountRowProps {
  account: TrackedAccount
  latestSnapshot: AccountSnapshot | null
  prevSnapshot: AccountSnapshot | null
  latestReels: ReelSnapshot[]
  fetchPhase: FetchPhase | null
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function delta(curr: number, prev: number | undefined): string | null {
  if (prev == null) return null
  const d = curr - prev
  if (d === 0) return null
  return `${d > 0 ? '+' : ''}${fmt(d)}`
}

export function AccountRow({
  account,
  latestSnapshot,
  prevSnapshot,
  latestReels,
  fetchPhase,
}: AccountRowProps) {
  const isFetching = fetchPhase !== null && fetchPhase !== 'done' && fetchPhase !== 'error'
  const followers = latestSnapshot?.followers_count ?? null
  const followerDelta = followers != null && prevSnapshot
    ? delta(followers, prevSnapshot.followers_count)
    : null

  const reelCount = latestReels.length
  const avgViews = reelCount > 0
    ? latestReels.reduce((s, r) => s + r.views_count, 0) / reelCount
    : null
  const avgLikes = reelCount > 0
    ? latestReels.reduce((s, r) => s + r.likes_count, 0) / reelCount
    : null
  const avgCmt = reelCount > 0
    ? latestReels.reduce((s, r) => s + r.comments_count, 0) / reelCount
    : null
  const reelER =
    avgViews != null && avgViews > 0 && avgLikes != null && avgCmt != null
      ? ((avgLikes + avgCmt) / avgViews * 100).toFixed(2) + '%'
      : null

  const initials = (account.full_name ?? account.username)
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  const lastFetched = latestSnapshot
    ? new Date(latestSnapshot.fetched_at).toLocaleDateString()
    : null

  const nextFetch = account.next_fetch_at
    ? new Date(account.next_fetch_at).toLocaleDateString()
    : null

  return (
    <Link
      to={`/tracking/${account.username}`}
      className="block bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.08)] rounded-xl p-4 hover:border-[rgba(var(--border-rgb),0.16)] transition-colors"
    >
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-[rgba(var(--accent-rgb),0.15)] ring-2 ring-[rgba(var(--accent-rgb),0.25)] flex items-center justify-center text-[var(--color-accent)] font-medium text-sm">
            {initials}
          </div>
        </div>

        {/* Name + username */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-primary)] font-medium text-sm truncate">
              {account.full_name ?? `@${account.username}`}
            </span>
            {account.is_verified && (
              <span className="text-[10px] bg-[rgba(var(--accent-rgb),0.12)] text-[var(--color-accent)] px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                ✓
              </span>
            )}
          </div>
          <span className="text-[var(--color-text-muted)] text-xs font-mono">@{account.username}</span>
        </div>

        {/* Metrics */}
        <div className="hidden sm:flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <div className="text-[var(--color-text-primary)] font-mono text-sm tabular-nums">
              {followers != null ? fmt(followers) : '—'}
              {followerDelta && (
                <span className={`ml-1.5 text-xs ${followerDelta.startsWith('+') ? 'text-success' : 'text-danger'}`}>
                  {followerDelta}
                </span>
              )}
            </div>
            <div className="text-[var(--color-text-muted)] text-[10px]">followers</div>
          </div>

          <div className="text-right">
            <div className="text-[var(--color-text-primary)] font-mono text-sm tabular-nums">
              {reelER ?? '—'}
            </div>
            <div className="text-[var(--color-text-muted)] text-[10px]">view ER</div>
          </div>

          <div className="text-right">
            <div className="text-[var(--color-text-secondary)] font-mono text-xs tabular-nums">
              {lastFetched ?? '—'}
            </div>
            <div className="text-[var(--color-text-muted)] text-[10px]">last fetch</div>
          </div>

          <div className="text-right">
            <div className="text-[var(--color-text-secondary)] font-mono text-xs tabular-nums">
              {nextFetch ?? '—'}
            </div>
            <div className="text-[var(--color-text-muted)] text-[10px]">next fetch</div>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex-shrink-0 ml-2">
          {isFetching ? (
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--color-accent)] bg-[rgba(var(--accent-rgb),0.1)] px-2 py-1 rounded-full">
              <RefreshCw size={10} className="animate-spin" />
              {fetchPhase}…
            </span>
          ) : account.last_error ? (
            <span
              title={account.last_error}
              className="flex items-center gap-1 text-[10px] font-mono text-danger bg-[rgba(224,92,92,0.12)] px-2 py-1 rounded-full"
            >
              <AlertCircle size={10} />
              Can't fetch
            </span>
          ) : latestSnapshot ? (
            <CheckCircle size={14} className="text-success/60" />
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--color-text-muted)]">
              <Clock size={10} />
              Pending
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
