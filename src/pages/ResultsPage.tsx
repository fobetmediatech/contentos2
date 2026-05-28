import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Download, RotateCcw, Check } from 'lucide-react'
import { useAnalysisStore } from '../store/analysisStore'
import { useKeysStore } from '../store/keysStore'
import { CompetitorCard } from '../components/CompetitorCard'
import { COMPETITOR_CATEGORIES } from '../shared/utils/categories'
import { formatForClipboard, generateCSV, downloadCSV, copyToClipboard } from '../shared/utils/export'

export function ResultsPage() {
  const navigate = useNavigate()
  const { competitors, inputProfiles, niche, summary, params, reset } = useAnalysisStore()
  useKeysStore()
  const [copied, setCopied] = useState(false)

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

  return (
    // Add bottom padding so content isn't hidden behind sticky export bar
    <div className="pb-24">

      {/* Page header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Competitor Analysis</h1>
          {niche && (
            <p className="mt-1 text-sm text-slate-500">
              Niche: <span className="font-medium text-slate-700">{niche}</span>
              {' · '}
              Source: {sourceHandles.map((h) => '@' + h).join(', ')}
            </p>
          )}
          {summary && (
            <p className="mt-2 text-sm text-slate-600 max-w-2xl">{summary}</p>
          )}
        </div>
        <button
          onClick={handleNewAnalysis}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:border-slate-300 hover:text-slate-900 transition-colors flex-shrink-0"
        >
          <RotateCcw size={14} />
          New Analysis
        </button>
      </div>

      {/* Top 5 section */}
      {topCompetitors.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold text-slate-800 mb-4">
            {COMPETITOR_CATEGORIES.top.sectionLabel}
          </h2>
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            {topCompetitors.map((c) => (
              <CompetitorCard
                key={c.username}
                competitor={c}
                profile={profileMap.get(c.username)}
                cohortAvgER={cohortAvgER}
              />
            ))}
          </div>
        </section>
      )}

      {/* Trending 5 section */}
      {trendingCompetitors.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-4">
            {COMPETITOR_CATEGORIES.trending.sectionLabel}
          </h2>
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            {trendingCompetitors.map((c) => (
              <CompetitorCard
                key={c.username}
                competitor={c}
                profile={profileMap.get(c.username)}
                cohortAvgER={cohortAvgER}
              />
            ))}
          </div>
        </section>
      )}

      {/* Sticky export bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {competitors.length} competitors identified
            {clientName && <span> · {clientName}</span>}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:border-slate-300 hover:text-slate-900 transition-colors"
            >
              {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy for Slides'}
            </button>
            <button
              onClick={handleCSV}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
