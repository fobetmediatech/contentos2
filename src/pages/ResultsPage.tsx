import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Download, RotateCcw, Check, X } from 'lucide-react'
import { useAnalysisStore } from '../store/analysisStore'
import { useKeysStore } from '../store/keysStore'
import { CompetitorCard } from '../components/CompetitorCard'
import { COMPETITOR_CATEGORIES } from '../shared/utils/categories'
import { formatForClipboard, generateCSV, downloadCSV, copyToClipboard } from '../shared/utils/export'

export function ResultsPage() {
  const navigate = useNavigate()
  const { competitors, inputProfiles, niche, summary, candidateCount, params, reset } = useAnalysisStore()
  useKeysStore()
  const [copied, setCopied] = useState(false)
  const [selectedHandles, setSelectedHandles] = useState<string[]>([])
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null)

  const handleToggleSelect = (handle: string) => {
    setSelectedHandles((prev) => {
      if (prev.includes(handle)) return prev.filter((h) => h !== handle)
      if (prev.length >= 5) {
        setSelectionWarning('Select up to 5 creators at a time')
        setTimeout(() => setSelectionWarning(null), 2500)
        return prev
      }
      return [...prev, handle]
    })
  }

  // Redirect to home if no results — must be in useEffect, not render (React 18 rule)
  useEffect(() => {
    if (competitors.length === 0) {
      navigate('/')
    }
  }, [competitors.length, navigate])

  // Don't render content while redirect is pending
  if (competitors.length === 0) return null

  const topCompetitors = competitors.filter((c) => c.category === 'top').sort((a, b) => a.rank - b.rank)
  const trendingCompetitors = competitors.filter((c) => c.category === 'trending').sort((a, b) => a.rank - b.rank)

  // Cohort average ER for coloring (across all candidates)
  const allProfiles = inputProfiles  // we have full profile data from the store
  const profileMap = new Map(allProfiles.map((p) => [p.username, p]))

  // Build full candidate profile list from both result sets combined with inputProfiles
  const allERValues = competitors
    .map((c) => profileMap.get(c.username)?.engagementRate)
    .filter((er): er is number => er !== null && er !== undefined)
  const cohortAvgER = allERValues.length > 0
    ? allERValues.reduce((a, b) => a + b, 0) / allERValues.length
    : 3.0

  const sourceHandles = params?.handles ?? []
  const clientName = params?.clientName

  const handleCopy = async () => {
    const text = formatForClipboard({
      competitors,
      profiles: allProfiles,
      sourceHandles,
      clientName,
    })
    await copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCSV = () => {
    const csv = generateCSV({
      competitors,
      profiles: allProfiles,
      sourceHandles,
      clientName,
    })
    const prefix = clientName ? clientName.replace(/\s+/g, '-').toLowerCase() + '-' : ''
    const date = new Date().toISOString().slice(0, 10)
    downloadCSV(csv, `${prefix}competitors-${date}.csv`)
  }

  const handleNewAnalysis = () => {
    reset()
    navigate('/')
  }

  const selectionCount = selectedHandles.length

  return (
    <div className="pb-24">

      {/* Selection warning toast */}
      {selectionWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#2C2118] border border-[#E07B3A]/40 rounded-xl text-sm text-[#E07B3A] shadow-lg">
          {selectionWarning}
        </div>
      )}

      {/* Page header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#F5EDD6]">Competitor Analysis</h1>
          {(niche || sourceHandles.length > 0) && (
            <p className="mt-1 text-sm text-[#C4A882]">
              {candidateCount > 0 && (
                <>
                  Analyzed{' '}
                  <span className="font-medium text-[#F5EDD6]">{candidateCount} candidate accounts</span>
                  {sourceHandles.length > 0 && <> from {sourceHandles.map((h) => '@' + h).join(', ')}</>}
                  {' · '}
                </>
              )}
              <span className="font-medium text-[#F5EDD6]">{competitors.length} matches</span> after filtering
            </p>
          )}
        </div>
        <button
          onClick={handleNewAnalysis}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#C4A882] border border-[rgba(245,237,214,0.08)] rounded-lg hover:border-[rgba(245,237,214,0.15)] hover:text-[#F5EDD6] transition-colors flex-shrink-0"
        >
          <RotateCcw size={14} />
          New Analysis
        </button>
      </div>

      {/* Summary card — AI-generated content uses violet tint per design system */}
      {summary && (
        <div className="mb-8 p-4 bg-[rgba(167,139,250,0.08)] border border-[#A78BFA]/20 rounded-xl">
          <p className="text-sm font-medium text-[#C4B5FD] leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Top 5 section */}
      {topCompetitors.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold text-[#F5EDD6] mb-4">
            {COMPETITOR_CATEGORIES.top.sectionLabel}
          </h2>
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            {topCompetitors.map((c) => (
              <CompetitorCard
                key={c.username}
                competitor={c}
                profile={profileMap.get(c.username)}
                cohortAvgER={cohortAvgER}
                isSelected={selectedHandles.includes(c.username)}
                onSelect={handleToggleSelect}
              />
            ))}
          </div>
        </section>
      )}

      {/* Trending 5 section */}
      {trendingCompetitors.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-[#F5EDD6] mb-4">
            {COMPETITOR_CATEGORIES.trending.sectionLabel}
          </h2>
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            {trendingCompetitors.map((c) => (
              <CompetitorCard
                key={c.username}
                competitor={c}
                profile={profileMap.get(c.username)}
                cohortAvgER={cohortAvgER}
                isSelected={selectedHandles.includes(c.username)}
                onSelect={handleToggleSelect}
              />
            ))}
          </div>
        </section>
      )}

      {/* Sticky export bar — hidden when selection is active */}
      {selectionCount === 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#1A1410] border-t border-[rgba(245,237,214,0.08)] px-6 py-3 z-20">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <p className="text-xs text-[#7A6A54]">
              {competitors.length} competitors identified
              {clientName && <span> · {clientName}</span>}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#C4A882] border border-[rgba(245,237,214,0.08)] rounded-lg hover:border-[rgba(245,237,214,0.15)] hover:text-[#F5EDD6] transition-colors"
              >
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy for Slides'}
              </button>
              <button
                onClick={handleCSV}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[#E07B3A] text-white rounded-lg hover:bg-[#C4612A] transition-colors"
              >
                <Download size={14} />
                Export CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating selection CTA — shown when 1+ competitors selected */}
      {selectionCount >= 1 && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#1A1410] border-t border-[#E07B3A]/30 px-6 py-3 z-30">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <p className="text-sm font-medium text-[#F5E6D3]">
              {selectionCount} competitor{selectionCount !== 1 ? 's' : ''} selected
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedHandles([])}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#A09080] border border-[#3D2E1E] rounded-lg hover:text-[#F5E6D3] hover:border-[#5C4A30] transition-colors"
              >
                <X size={14} />
                Clear
              </button>
              <button
                onClick={() => navigate('/reel-analysis?handles=' + selectedHandles.join(','))}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#E07B3A] text-[#1A1410] rounded-lg hover:bg-[#C96A2A] transition-colors"
              >
                Analyze {selectionCount} creator{selectionCount !== 1 ? 's' : ''} (~{selectionCount * 2}–{selectionCount * 3} min)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
