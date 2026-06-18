import { useState } from 'react'
import { RefreshCw, Download, Trash2, Save } from 'lucide-react'
import type { TrackedAccount, AccountSnapshot, ReelSnapshot } from '../../lib/trackingDb'
import { updateAccountSettings } from '../../lib/trackingDb'
import type { FetchPhase } from '../../lib/trackingClient'

interface ControlsPanelProps {
  account: TrackedAccount
  snapshots: AccountSnapshot[]
  reels: ReelSnapshot[]
  fetchPhase: FetchPhase | null
  onFetchNow: () => void
  onRemove: (deleteHistory: boolean) => void
  onSettingsSaved: () => void
}

function downloadMd(
  account: TrackedAccount,
  snapshots: AccountSnapshot[],
  reels: ReelSnapshot[],
) {
  const date = new Date().toISOString().split('T')[0]
  const latest = snapshots[snapshots.length - 1]
  const latestReels = reels.filter((r) => r.fetched_at === reels[reels.length - 1]?.fetched_at)
  const reelCount = latestReels.length
  const avgViews = reelCount ? latestReels.reduce((s, r) => s + r.views_count, 0) / reelCount : 0
  const avgLikes = reelCount ? latestReels.reduce((s, r) => s + r.likes_count, 0) / reelCount : 0
  const avgCmt = reelCount ? latestReels.reduce((s, r) => s + r.comments_count, 0) / reelCount : 0
  const followers = latest?.followers_count ?? 0
  const reelER = avgViews > 0 ? ((avgLikes + avgCmt) / avgViews * 100).toFixed(2) : 'N/A'
  const followerER = followers > 0 ? ((avgLikes + avgCmt) / followers * 100).toFixed(2) : 'N/A'

  const reelRows = latestReels
    .map((r) => {
      const v = r.views_count
      const er = v > 0 ? ((r.likes_count + r.comments_count) / v * 100).toFixed(2) + '%' : 'N/A'
      const fEr = followers > 0 ? ((r.likes_count + r.comments_count) / followers * 100).toFixed(2) + '%' : 'N/A'
      const posted = r.posted_at ? r.posted_at.split('T')[0] : '—'
      return `| ${r.reel_url} | ${posted} | ${v.toLocaleString()} | ${r.likes_count.toLocaleString()} | ${r.comments_count.toLocaleString()} | ${er} | ${fEr} |`
    })
    .join('\n')

  const followerRows = snapshots
    .map((s) => `| ${s.fetched_at.split('T')[0]} | ${s.followers_count.toLocaleString()} |`)
    .join('\n')

  const md = `# @${account.username} — Instagram Report (${date})

## Profile
- Full name: ${account.full_name ?? '—'}
- Bio: ${account.biography ?? '—'}
- Verified: ${account.is_verified ? 'Yes' : 'No'} | Business: ${account.is_business ? 'Yes' : 'No'}
- Followers: ${(latest?.followers_count ?? 0).toLocaleString()} | Posts: ${(latest?.posts_count ?? 0).toLocaleString()} | Following: ${(latest?.follows_count ?? 0).toLocaleString()}

## Key Metrics (last ${account.scrape_window_days} days)
- Reel Engagement Rate: ${reelER}%
- Follower Engagement Rate: ${followerER}%
- Avg views / reel: ${Math.round(avgViews).toLocaleString()}
- Avg likes / reel: ${Math.round(avgLikes).toLocaleString()}
- Avg comments / reel: ${Math.round(avgCmt).toLocaleString()}

## Reels (last ${account.scrape_window_days} days)
| Reel URL | Posted | Views | Likes | Comments | Reel ER | Follower ER |
|----------|--------|-------|-------|----------|---------|-------------|
${reelRows || '| No reels data | | | | | | |'}

## Follower Trend
| Date | Followers |
|------|-----------|
${followerRows || '| No data | |'}
`

  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${account.username}-report-${date}.md`
  a.click()
  URL.revokeObjectURL(url)
}

export function ControlsPanel({
  account,
  snapshots,
  reels,
  fetchPhase,
  onFetchNow,
  onRemove,
  onSettingsSaved,
}: ControlsPanelProps) {
  const [windowDays, setWindowDays] = useState(account.scrape_window_days)
  const [intervalDays, setIntervalDays] = useState(account.scrape_interval_days)
  const [saving, setSaving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const isFetching = fetchPhase !== null && fetchPhase !== 'done' && fetchPhase !== 'error'

  async function handleSaveSettings() {
    setSaving(true)
    try {
      await updateAccountSettings(account.username, {
        scrape_window_days: windowDays,
        scrape_interval_days: intervalDays,
      })
      onSettingsSaved()
    } finally {
      setSaving(false)
    }
  }

  const phaseLabel: Record<string, string> = {
    profile: 'Scraping profile…',
    reels: 'Scraping reels…',
    saving: 'Saving…',
  }

  return (
    <div className="bg-[#2C2218] border border-[rgba(245,237,214,0.08)] rounded-xl p-5 space-y-5">
      <h3 className="text-[#F5EDD6] font-medium text-sm">Settings & Controls</h3>

      {/* Settings fields */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[#C4A882] text-xs">Scrape window (days)</label>
          <input
            type="number"
            min={1}
            max={365}
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="w-full bg-[#1A1410] border border-[rgba(245,237,214,0.12)] rounded-md px-3 py-2 text-[#F5EDD6] font-mono text-sm focus:outline-none focus:border-[#E07B3A] transition-colors"
          />
          <p className="text-[#7A6A54] text-[11px]">How far back to scrape reels</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[#C4A882] text-xs">Auto-fetch every (days)</label>
          <input
            type="number"
            min={1}
            max={30}
            value={intervalDays}
            onChange={(e) => setIntervalDays(Number(e.target.value))}
            className="w-full bg-[#1A1410] border border-[rgba(245,237,214,0.12)] rounded-md px-3 py-2 text-[#F5EDD6] font-mono text-sm focus:outline-none focus:border-[#E07B3A] transition-colors"
          />
          <p className="text-[#7A6A54] text-[11px]">Cron checks every 6 hours</p>
        </div>
      </div>

      <button
        onClick={() => void handleSaveSettings()}
        disabled={saving}
        className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md bg-[rgba(224,123,58,0.12)] text-[#E07B3A] hover:bg-[rgba(224,123,58,0.2)] transition-colors disabled:opacity-50"
      >
        <Save size={13} />
        {saving ? 'Saving…' : 'Save settings'}
      </button>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-1 border-t border-[rgba(245,237,214,0.06)]">
        <button
          onClick={onFetchNow}
          disabled={isFetching}
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md bg-[#E07B3A] text-[#1A1410] font-medium hover:bg-[#F4A97B] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? (phaseLabel[fetchPhase ?? ''] ?? 'Fetching…') : 'Fetch now'}
        </button>

        <button
          onClick={() => downloadMd(account, snapshots, reels)}
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md bg-[#2C2218] border border-[rgba(245,237,214,0.12)] text-[#C4A882] hover:text-[#F5EDD6] hover:border-[rgba(245,237,214,0.2)] transition-colors"
        >
          <Download size={13} />
          Download report
        </button>

        {!confirmRemove ? (
          <button
            onClick={() => setConfirmRemove(true)}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md text-[#7A6A54] hover:text-red-400 transition-colors ml-auto"
          >
            <Trash2 size={13} />
            Stop tracking
          </button>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[#C4A882] text-xs">Delete history too?</span>
            <button
              onClick={() => onRemove(false)}
              className="text-xs px-2.5 py-1 rounded bg-red-900/40 text-red-400 hover:bg-red-900/60 transition-colors"
            >
              Remove + keep data
            </button>
            <button
              onClick={() => onRemove(true)}
              className="text-xs px-2.5 py-1 rounded bg-red-900/60 text-red-300 hover:bg-red-900/80 transition-colors"
            >
              Remove + delete all
            </button>
            <button
              onClick={() => setConfirmRemove(false)}
              className="text-xs text-[#7A6A54] hover:text-[#C4A882] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Next scheduled fetch */}
      <p className="text-[#7A6A54] text-[11px] font-mono">
        Next auto-fetch:{' '}
        {account.next_fetch_at
          ? new Date(account.next_fetch_at).toLocaleString()
          : '—'}
      </p>
    </div>
  )
}
