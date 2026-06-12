/**
 * MemoryPage — browse the entire creator/content corpus (Phase 2 payoff).
 *
 * Surfaces what the OS has remembered across ALL searches: every creator, where they were
 * seen, their freshest metrics, and the reel hooks stored for them. Reads the corpus only
 * (no Apify), so it works even with scraping quota exhausted. The nav's 🧠 count links here.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Brain, BadgeCheck, ChevronDown, ChevronUp, History } from 'lucide-react'
import { useCorpusStore } from '../store/corpusStore'
import { corpus } from '../lib/corpusIdb'
import { sortCreators, creatorContexts } from '../lib/corpus'
import type { CorpusSort, CreatorRecord, ContentRecord, Feedback } from '../lib/corpus'
import { FeedbackControl } from '../components/FeedbackControl'

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

const SORTS: { key: CorpusSort; label: string }[] = [
  { key: 'lastSeenAt', label: 'Most recent' },
  { key: 'timesSeen', label: 'Most seen' },
  { key: 'engagementRate', label: 'Highest ER' },
  { key: 'followersCount', label: 'Most followers' },
]

type VerdictFilter = 'all' | Feedback
const VERDICTS: { key: VerdictFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'saved', label: 'Saved' },
  { key: 'dismissed', label: 'Dismissed' },
]

export function MemoryPage() {
  // Select the stable record; derive the sorted list in render (never sort inside the
  // selector — that returns a fresh array each call and loops useSyncExternalStore).
  const creators = useCorpusStore((s) => s.creators)
  const [sort, setSort] = useState<CorpusSort>('lastSeenAt')
  const [verdict, setVerdict] = useState<VerdictFilter>('all')
  const list = useMemo(() => sortCreators(Object.values(creators), sort), [creators, sort])
  const filtered = useMemo(
    () => (verdict === 'all' ? list : list.filter((r) => r.feedback === verdict)),
    [list, verdict],
  )

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Brain size={20} className="text-[#E07B3A]" />
        <h1 className="font-serif italic text-2xl text-[#F5EDD6] tracking-tight">Memory</h1>
      </div>
      <p className="text-sm text-[#C4A882] mb-5">
        {list.length} creator{list.length !== 1 ? 's' : ''} remembered across your searches.
      </p>

      {list.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-[#7A6A54]">Nothing remembered yet — run a search and creators show up here.</p>
          <Link to="/" className="inline-block mt-3 text-sm text-[#E07B3A] hover:underline">
            Start a search →
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  sort === s.key
                    ? 'bg-[rgba(224,123,58,0.12)] text-[#F4A97B] border-[rgba(224,123,58,0.3)]'
                    : 'bg-[#2C2218] text-[#C4A882] border-[rgba(245,237,214,0.08)] hover:border-[rgba(245,237,214,0.15)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Verdict filter (Phase 3) — review what you've saved or dismissed. */}
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            {VERDICTS.map((v) => (
              <button
                key={v.key}
                onClick={() => setVerdict(v.key)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  verdict === v.key
                    ? 'bg-[rgba(224,123,58,0.12)] text-[#F4A97B] border-[rgba(224,123,58,0.3)]'
                    : 'bg-[#2C2218] text-[#7A6A54] border-[rgba(245,237,214,0.08)] hover:border-[rgba(245,237,214,0.15)]'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-[#7A6A54] py-8 text-center">No {verdict} creators yet.</p>
          ) : (
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
              {filtered.map((r) => (
                <MemoryCreatorCard key={r.username} record={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MemoryCreatorCard({ record }: { record: CreatorRecord }) {
  const [expanded, setExpanded] = useState(false)
  const [content, setContent] = useState<ContentRecord[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const next = !expanded
    setExpanded(next)
    if (next && content === null && !loading) {
      setLoading(true)
      try {
        setContent(await corpus.listContentFor(record.username))
      } catch {
        setContent([])
      } finally {
        setLoading(false)
      }
    }
  }

  const contexts = creatorContexts(record)
  const er = record.engagementRate
  const initials = (record.fullName || record.username)
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const dismissed = record.feedback === 'dismissed'

  return (
    <div className={`bg-[#2C2218] border border-[rgba(245,237,214,0.08)] rounded-xl p-4 ${dismissed ? 'opacity-60 hover:opacity-100' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="relative w-12 h-12 rounded-full bg-[#3D3025] flex items-center justify-center flex-shrink-0 text-[#C4A882] font-semibold text-sm overflow-hidden">
          <span>{initials}</span>
          {record.profilePicUrl && (
            <img
              src={record.profilePicUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-[#F5EDD6] text-sm">@{record.username}</span>
            {record.verified && <BadgeCheck size={14} className="text-[#C4A882] flex-shrink-0" />}
            {record.timesSeen >= 2 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[rgba(224,123,58,0.12)] text-[#F4A97B] border border-[rgba(224,123,58,0.20)]">
                <History size={10} />
                Seen {record.timesSeen}×
              </span>
            )}
          </div>
          {record.fullName && record.fullName !== record.username && (
            <p className="text-xs text-[#C4A882] mt-0.5 truncate">{record.fullName}</p>
          )}
          <p className="text-xs text-[#7A6A54] mt-0.5 tabular-nums">
            {formatCount(record.followersCount)} followers
            {er !== null ? ` · ${er.toFixed(1)}% ER` : ''}
          </p>
          {contexts.length > 0 && (
            <p className="text-xs text-[#7A6A54] mt-1">
              <span className="text-[#5C4A30]">Seen in:</span> {contexts.join(' · ')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={toggle}
          className="flex items-center gap-1 text-xs text-[#E07B3A] hover:underline"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? 'Hide reels' : 'Show reels'}
        </button>
        <FeedbackControl username={record.username} />
      </div>

      {expanded && (
        <div className="mt-2">
          {loading ? (
            <p className="text-xs text-[#7A6A54]">Loading…</p>
          ) : content && content.length > 0 ? (
            <div className="grid gap-2 grid-cols-1">
              {content.map((c) => (
                <div key={c.id} className="bg-[#1A1410] rounded-lg p-2.5 border border-[rgba(245,237,214,0.06)]">
                  <p className="text-xs text-[#7A6A54] font-mono">{formatCount(c.videoViewCount)} views</p>
                  {c.openingLine && <p className="text-xs text-[#F5EDD6] mt-1 leading-snug italic">"{c.openingLine}"</p>}
                  {c.hookArchetype && (
                    // Hook archetype is Gemini-classified → violet tint per DESIGN.md.
                    <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20">
                      {c.hookArchetype}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#7A6A54]">No reels analyzed for this creator yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
