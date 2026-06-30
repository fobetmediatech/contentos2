import { useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, AlertCircle, LineChart } from 'lucide-react'
import {
  getTrackedAccount,
  getAccountSnapshots,
  getReelSnapshots,
  removeTrackedAccount,
} from '../lib/trackingDb'
import { runAccountFetch } from '../lib/trackingClient'
import { useTrackingStore } from '../store/trackingStore'
import { MetricsStrip } from '../components/tracking/MetricsStrip'
import { TrendChart } from '../components/tracking/TrendChart'
import { ExpandableChartCard } from '../components/tracking/ExpandableChartCard'
import { ControlsPanel } from '../components/tracking/ControlsPanel'
import { EmptyState } from '../components/EmptyState'
import type { AccountSnapshot, ReelSnapshot } from '../lib/trackingDb'

// ---------- Chart data derivation ----------

interface ReelBatch {
  fetchedAt: string
  reels: ReelSnapshot[]
  followers: number
}

function buildChartData(
  snapshots: AccountSnapshot[],
  allReels: ReelSnapshot[],
  trackingStart?: string,
) {
  // Group reels by fetched_at
  const reelsByBatch: Record<string, ReelSnapshot[]> = {}
  for (const r of allReels) {
    const k = r.fetched_at
    if (!reelsByBatch[k]) reelsByBatch[k] = []
    reelsByBatch[k].push(r)
  }

  const batches: ReelBatch[] = snapshots.map((s) => ({
    fetchedAt: s.fetched_at,
    reels: reelsByBatch[s.fetched_at] ?? [],
    followers: s.followers_count,
  }))

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const followerData = batches.map((b) => ({
    date: fmtDate(b.fetchedAt),
    value: b.followers as number | null,
  }))
  // Prepend a zero baseline marking when tracking began, so even the very first
  // fetch renders as a line (0 → current) instead of a lone point. The chart's
  // info popover explains that the 0 is the tracking-start baseline.
  if (followerData.length > 0 && trackingStart) {
    followerData.unshift({ date: fmtDate(trackingStart), value: 0 })
  }

  const reelERData = batches.map((b) => {
    const n = b.reels.length
    if (n === 0) return { date: fmtDate(b.fetchedAt), value: null }
    const avgL = b.reels.reduce((s, r) => s + r.likes_count, 0) / n
    const avgC = b.reels.reduce((s, r) => s + r.comments_count, 0) / n
    const avgV = b.reels.reduce((s, r) => s + r.views_count, 0) / n
    return {
      date: fmtDate(b.fetchedAt),
      value: avgV > 0 ? Number(((avgL + avgC) / avgV * 100).toFixed(2)) : null,
    }
  })

  const followerERData = batches.map((b) => {
    const n = b.reels.length
    if (n === 0 || b.followers === 0) return { date: fmtDate(b.fetchedAt), value: null }
    const avgL = b.reels.reduce((s, r) => s + r.likes_count, 0) / n
    const avgC = b.reels.reduce((s, r) => s + r.comments_count, 0) / n
    return {
      date: fmtDate(b.fetchedAt),
      value: Number(((avgL + avgC) / b.followers * 100).toFixed(2)),
    }
  })

  const reelsPostedData = batches.map((b) => ({
    date: fmtDate(b.fetchedAt),
    value: b.reels.length,
  }))

  return { followerData, reelERData, followerERData, reelsPostedData }
}

// ---------- Page ----------

export function TrackingAccountPage() {
  const { username } = useParams<{ username: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { fetching, setFetching, clearFetching } = useTrackingStore()

  const { data: account, isLoading: loadingAccount } = useQuery({
    queryKey: ['tracked-account', username],
    queryFn: () => getTrackedAccount(username!),
    enabled: !!username,
  })

  const { data: snapshots = [] } = useQuery({
    queryKey: ['account-snapshots', username],
    queryFn: () => getAccountSnapshots(username!),
    enabled: !!username,
  })

  const { data: allReels = [] } = useQuery({
    queryKey: ['reel-snapshots', username],
    queryFn: () => getReelSnapshots(username!),
    enabled: !!username,
  })

  const latestSnapshot = snapshots[snapshots.length - 1] ?? null
  const latestFetchedAt = allReels[allReels.length - 1]?.fetched_at
  const latestReels = latestFetchedAt
    ? allReels.filter((r) => r.fetched_at === latestFetchedAt)
    : []

  const fetchState = username ? fetching[username] ?? null : null
  const isFetching = fetchState !== null && fetchState.phase !== 'done' && fetchState.phase !== 'error'

  // Memoized above the early returns to keep hook order stable (Rules of Hooks).
  const { followerData, reelERData, followerERData, reelsPostedData } = useMemo(
    () => buildChartData(snapshots, allReels, account?.added_at),
    [snapshots, allReels, account?.added_at],
  )

  function handleFetchNow() {
    if (!account || isFetching) return
    setFetching(account.username, { phase: 'profile' })
    void runAccountFetch(account, (s) => setFetching(account.username, s))
      .then(() => {
        setTimeout(() => clearFetching(account.username), 3000)
        void qc.invalidateQueries({ queryKey: ['tracked-account', username] })
        void qc.invalidateQueries({ queryKey: ['account-snapshots', username] })
        void qc.invalidateQueries({ queryKey: ['reel-snapshots', username] })
        void qc.invalidateQueries({ queryKey: ['tracked-accounts'] })
        void qc.invalidateQueries({ queryKey: ['tracking-list-snapshots'] })
      })
      .catch(() => {
        void qc.invalidateQueries({ queryKey: ['tracked-account', username] })
      })
  }

  async function handleRemove(deleteHistory: boolean) {
    if (!username) return
    await removeTrackedAccount(username, deleteHistory)
    void qc.invalidateQueries({ queryKey: ['tracked-accounts'] })
    navigate('/tracking')
  }

  function handleSettingsSaved() {
    void qc.invalidateQueries({ queryKey: ['tracked-account', username] })
    void qc.invalidateQueries({ queryKey: ['tracked-accounts'] })
  }

  if (loadingAccount) {
    return (
      <div className="flex items-center justify-center py-24 text-[#8B7D6B]">
        <Loader2 size={20} className="animate-spin mr-3" />
        <span className="font-mono text-sm">Loading…</span>
      </div>
    )
  }

  if (!account) {
    return (
      <div className="max-w-4xl mx-auto py-24 text-center space-y-4">
        <AlertCircle size={32} className="mx-auto text-[#8B7D6B]" />
        <p className="text-[#C4A882]">Account not found in tracking list.</p>
        <button
          onClick={() => navigate('/tracking')}
          className="text-[#E07B3A] text-sm hover:underline"
        >
          ← Back to tracking
        </button>
      </div>
    )
  }

  const initials = (account.full_name ?? account.username)
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <button
        onClick={() => navigate('/tracking')}
        className="flex items-center gap-2 text-[#8B7D6B] text-sm hover:text-[#C4A882] transition-colors"
      >
        <ArrowLeft size={14} />
        All accounts
      </button>

      {/* Profile header */}
      <div className="bg-[#2C2218] border border-[rgba(245,237,214,0.08)] rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-[rgba(224,123,58,0.15)] ring-2 ring-[rgba(224,123,58,0.3)] flex items-center justify-center text-[#E07B3A] font-medium text-xl flex-shrink-0">
            {initials}
          </div>

          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[#F5EDD6] font-semibold text-lg leading-tight">
                {account.full_name ?? `@${account.username}`}
              </h1>
              {account.is_verified && (
                <span className="text-[10px] bg-[rgba(224,123,58,0.12)] text-[#E07B3A] px-2 py-0.5 rounded font-mono">
                  Verified
                </span>
              )}
              {account.is_business && (
                <span className="text-[10px] bg-[rgba(196,168,130,0.1)] text-[#C4A882] px-2 py-0.5 rounded font-mono">
                  Business
                </span>
              )}
              {isFetching && (
                <span className="text-[10px] text-[#E07B3A] font-mono animate-pulse">
                  {fetchState?.phase}…
                </span>
              )}
            </div>

            <p className="text-[#8B7D6B] font-mono text-sm">@{account.username}</p>

            {account.biography && (
              <p className="text-[#C4A882] text-sm leading-relaxed line-clamp-2">
                {account.biography}
              </p>
            )}

            {account.last_error && (
              <p className="flex items-center gap-1.5 text-red-400 text-xs font-mono">
                <AlertCircle size={11} />
                {account.last_error}
              </p>
            )}

            <div className="flex gap-4 pt-1">
              {[
                { label: 'Followers', value: latestSnapshot?.followers_count },
                { label: 'Posts', value: latestSnapshot?.posts_count },
                { label: 'Following', value: latestSnapshot?.follows_count },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <div className="text-[#F5EDD6] font-mono text-sm tabular-nums">
                    {value != null ? value.toLocaleString() : '—'}
                  </div>
                  <div className="text-[#8B7D6B] text-[10px]">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Metrics strip */}
      <MetricsStrip latestSnapshot={latestSnapshot} latestReels={latestReels} />

      {/* Empty state */}
      {snapshots.length === 0 && (
        <EmptyState
          icon={LineChart}
          title="No data yet"
          description="Run the first fetch to pull this account's followers, engagement, and top reels. Come back anytime to track how they change."
          action={{ label: isFetching ? 'Fetching…' : 'Fetch now', onClick: handleFetchNow }}
          compact
        />
      )}

      {/* Charts — each expands to a modal on click */}
      {snapshots.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ExpandableChartCard
            title="Follower Count Over Time"
            info={{
              title: 'Follower Count Over Time',
              significance:
                'Follower count at each fetch. The line starts at 0 — that baseline marks when tracking began, so the climb to the current count shows growth since you started monitoring.',
            }}
          >
            <TrendChart
              data={followerData}
              label="Followers"
              color="#E07B3A"
              formatter={(v) => v.toLocaleString()}
              axisFormatter={(v) =>
                v >= 1_000_000
                  ? `${(v / 1_000_000).toFixed(1)}M`
                  : v >= 1_000
                    ? `${Math.round(v / 1_000)}K`
                    : `${v}`
              }
            />
          </ExpandableChartCard>

          <ExpandableChartCard
            title="View Engagement Rate (%)"
            info={{
              title: 'View Engagement Rate',
              formula: '(avg likes + avg comments) ÷ avg views × 100',
              significance:
                'Per-fetch engagement relative to reach. Trending up means content is resonating with viewers over time.',
            }}
          >
            <TrendChart
              data={reelERData}
              label="View ER"
              color="#C4A882"
              formatter={(v) => `${v.toFixed(2)}%`}
              emptyMessage="No reel data yet"
            />
          </ExpandableChartCard>

          <ExpandableChartCard
            title="Follower Engagement Rate (%)"
            info={{
              title: 'Follower Engagement Rate',
              formula: '(avg likes + avg comments) ÷ followers × 100',
              significance:
                'Per-fetch engagement relative to audience size. Holding steady as followers grow signals a healthy, active audience.',
            }}
          >
            <TrendChart
              data={followerERData}
              label="Follower ER"
              color="#F4A97B"
              formatter={(v) => `${v.toFixed(2)}%`}
              emptyMessage="No reel data yet"
            />
          </ExpandableChartCard>

          <ExpandableChartCard
            title="Reels Posted Per Window"
            info={{
              title: 'Reels Posted Per Window',
              significance:
                'How many reels were captured in each scrape window — a read on posting cadence and consistency.',
            }}
          >
            <TrendChart
              data={reelsPostedData}
              label="Reels"
              color="#E07B3A"
              type="bar"
              emptyMessage="No reel data yet"
            />
          </ExpandableChartCard>
        </div>
      )}

      {/* Controls */}
      <ControlsPanel
        account={account}
        snapshots={snapshots}
        reels={allReels}
        fetchPhase={fetchState?.phase ?? null}
        onFetchNow={handleFetchNow}
        onRemove={(deleteHistory) => void handleRemove(deleteHistory)}
        onSettingsSaved={handleSettingsSaved}
      />
    </div>
  )
}
