/**
 * DiscoveryResultsPage — display 10 discovery results in Top 5 / Trending 5 sections.
 *
 * Extra features vs. ResultsPage:
 *   - Location filter relaxed banner (when too few bio matches were found)
 *   - Source hashtags listed in meta
 *   - DiscoveryCard with specialties chips + location confidence badges
 *   - Discovery-specific CSV + clipboard export
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Download, RotateCcw, Check, MapPin, Info } from 'lucide-react'
import { useDiscoveryStore } from '../store/discoveryStore'
import { DiscoveryCard } from '../components/DiscoveryCard'
import { DISCOVERY_CATEGORIES } from '../shared/utils/categories'
import {
  formatDiscoveryForClipboard,
  generateDiscoveryCSV,
  downloadCSV,
  copyToClipboard,
} from '../shared/utils/export'

export function DiscoveryResultsPage() {
  const navigate = useNavigate()
  const {
    results,
    candidateProfiles,
    niche,
    params,
    locationFilterRelaxed,
    sourceHashtags,
    reset,
  } = useDiscoveryStore()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (results.length === 0) navigate('/discover')
  }, [results.length, navigate])

  const topResults = results.filter((r) => r.category === 'top').sort((a, b) => a.rank - b.rank)
  const trendingResults = results.filter((r) => r.category === 'trending').sort((a, b) => a.rank - b.rank)

  // Profile map for card rendering
  const profileMap = new Map(candidateProfiles.map((p) => [p.username, p]))

  // Cohort average ER
  const allERValues = results
    .map((r) => profileMap.get(r.username)?.engagementRate)
    .filter((er): er is number => er !== null && er !== undefined)
  const cohortAvgER = allERValues.length > 0
    ? allERValues.reduce((a, b) => a + b, 0) / allERValues.length
    : 3.0

  const city = params?.city ?? 'Unknown city'
  const nicheLabel = params?.niche ?? 'creators'
  const clientName = params?.clientName

  const handleCopy = async () => {
    const text = formatDiscoveryForClipboard({
      results,
      profiles: candidateProfiles,
      city,
      niche: nicheLabel,
      clientName,
    })
    await copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCSV = () => {
    const csv = generateDiscoveryCSV({
      results,
      profiles: candidateProfiles,
      city,
      niche: nicheLabel,
      sourceHashtags,
      clientName,
    })
    const prefix = clientName ? clientName.replace(/\s+/g, '-').toLowerCase() + '-' : ''
    const date = new Date().toISOString().slice(0, 10)
    downloadCSV(csv, `${prefix}discovery-${city.toLowerCase().replace(/\s+/g, '-')}-${date}.csv`)
  }

  const handleNewSearch = () => {
    reset()
    navigate('/discover')
  }

  return (
    <div className="pb-24">

      {/* Page header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MapPin size={18} className="text-teal-600" />
            <h1 className="text-2xl font-bold text-slate-900">
              Top {nicheLabel} Creators in {city}
            </h1>
          </div>
          <p className="text-sm text-slate-500">
            {niche && <span className="font-medium text-slate-700">{niche}</span>}
            {niche && ' · '}
            {results.length} creators found
            {sourceHashtags.length > 0 && (
              <span className="ml-2 text-slate-400 text-xs">
                via {sourceHashtags.slice(0, 3).map((h) => `#${h}`).join(', ')}
                {sourceHashtags.length > 3 ? ` +${sourceHashtags.length - 3} more` : ''}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={handleNewSearch}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:border-slate-300 hover:text-slate-900 transition-colors flex-shrink-0"
        >
          <RotateCcw size={14} />
          New Search
        </button>
      </div>

      {/* Location filter relaxed banner */}
      {locationFilterRelaxed && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl">
          <Info size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Location filter relaxed — fewer than 15 creators had {city} in their bio.
            Showing all niche-relevant creators; some may not be locally based.
          </p>
        </div>
      )}

      {/* Top section */}
      {topResults.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold text-slate-800 mb-4">
            {DISCOVERY_CATEGORIES.top.sectionLabel}
          </h2>
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            {topResults.map((r) => (
              <DiscoveryCard
                key={r.username}
                result={r}
                profile={profileMap.get(r.username)}
                cohortAvgER={cohortAvgER}
              />
            ))}
          </div>
        </section>
      )}

      {/* Trending section */}
      {trendingResults.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-4">
            {DISCOVERY_CATEGORIES.trending.sectionLabel}
          </h2>
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            {trendingResults.map((r) => (
              <DiscoveryCard
                key={r.username}
                result={r}
                profile={profileMap.get(r.username)}
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
            {results.length} creators · {city} {nicheLabel}
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
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
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
