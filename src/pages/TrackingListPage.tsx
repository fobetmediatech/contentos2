import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BarChart2, Plus, Loader2 } from 'lucide-react'
import {
  getTrackedAccounts,
  getLatestTwoSnapshots,
  getLatestReelSnapshots,
  addTrackedAccount,
  trackingErrorMessage,
} from '../lib/trackingDb'
import { runAccountFetch } from '../lib/trackingClient'
import { useTrackingStore } from '../store/trackingStore'
import { AccountRow } from '../components/tracking/AccountRow'
import { ListRowSkeleton } from '../components/Skeleton'
import { EmptyState } from '../components/EmptyState'

export function TrackingListPage() {
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const { fetching, setFetching, clearFetching } = useTrackingStore()

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['tracked-accounts'],
    queryFn: getTrackedAccounts,
  })

  // For each account, fetch latest snapshot + latest reels (lightweight)
  const snapshotQueries = useQuery({
    queryKey: ['tracking-list-snapshots', accounts.map((a) => a.username).join(',')],
    queryFn: async () => {
      const results: Record<string, { snapshots: Awaited<ReturnType<typeof getLatestTwoSnapshots>>; reels: Awaited<ReturnType<typeof getLatestReelSnapshots>> }> = {}
      await Promise.all(
        accounts.map(async (a) => {
          const [snapshots, reels] = await Promise.all([
            getLatestTwoSnapshots(a.username),
            getLatestReelSnapshots(a.username),
          ])
          results[a.username] = { snapshots, reels }
        }),
      )
      return results
    },
    enabled: accounts.length > 0,
  })

  const addMutation = useMutation({
    mutationFn: async (username: string) => {
      const account = await addTrackedAccount(username)
      return account
    },
    onSuccess: async (account) => {
      setInput('')
      setAddError(null)
      await qc.invalidateQueries({ queryKey: ['tracked-accounts'] })
      // Auto-trigger first fetch
      setFetching(account.username, { phase: 'profile' })
      void runAccountFetch(
        account,
        (s) => setFetching(account.username, s),
      ).then(() => {
        setTimeout(() => clearFetching(account.username), 3000)
        void qc.invalidateQueries({ queryKey: ['tracked-accounts'] })
        void qc.invalidateQueries({ queryKey: ['tracking-list-snapshots'] })
      }).catch((err: unknown) => {
        setAddError(trackingErrorMessage(err, 'Fetch failed'))
      })
    },
    onError: (err: unknown) => {
      setAddError(trackingErrorMessage(err, 'Could not add account'))
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const username = input.replace(/^@/, '').trim()
    if (!username) return
    setAddError(null)
    addMutation.mutate(username)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <BarChart2 size={22} className="text-[#E07B3A]" />
            <h1 className="font-serif italic text-2xl text-[#F5EDD6]">Dashboard</h1>
          </div>
          <p className="text-[#C4A882] text-sm pl-9">
            Monitor Instagram accounts over time — followers, reel engagement, posting cadence.
          </p>
        </div>
      </div>

      {/* Add account form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7A6A54] font-mono text-sm">@</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="username"
            disabled={addMutation.isPending}
            className="w-full bg-[#2C2218] border border-[rgba(245,237,214,0.12)] rounded-xl pl-8 pr-4 py-2.5 text-[#F5EDD6] font-mono text-sm placeholder:text-[#7A6A54] focus:outline-none focus:border-[#E07B3A] transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={addMutation.isPending || !input.trim()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E07B3A] text-[#1A1410] font-medium text-sm hover:bg-[#F4A97B] transition-colors disabled:opacity-50"
        >
          {addMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Track
        </button>
      </form>

      {addError && (
        <p className="text-danger text-sm font-mono -mt-4">{addError}</p>
      )}

      {/* Account list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <ListRowSkeleton key={i} />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={BarChart2}
          title="No accounts tracked yet"
          description="Add an Instagram username above to start monitoring its followers, engagement, and top reels over time."
        />
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => {
            const data = snapshotQueries.data?.[account.username]
            const snapshots = data?.snapshots ?? []
            const reels = data?.reels ?? []
            const latest = snapshots[snapshots.length - 1] ?? null
            const prev = snapshots[snapshots.length - 2] ?? null
            const fp = fetching[account.username] ?? null
            return (
              <AccountRow
                key={account.username}
                account={account}
                latestSnapshot={latest}
                prevSnapshot={prev}
                latestReels={reels}
                fetchPhase={fp?.phase ?? null}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
