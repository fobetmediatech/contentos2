/**
 * DiscoverPage — input form for the Location Discovery feature.
 *
 * Collects: city + niche (required), depth toggle, client name (optional).
 * On submit → navigates to /discover/progress while the mutation runs.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, MapPin } from 'lucide-react'
import { useKeysStore } from '../store/keysStore'
import { useLocationDiscovery } from '../hooks/useLocationDiscovery'

export function DiscoverPage() {
  const navigate = useNavigate()
  const { isReady } = useKeysStore()
  const { discover, isPending } = useLocationDiscovery()

  const [city, setCity] = useState('')
  const [niche, setNiche] = useState('')
  const [depth, setDepth] = useState<'standard' | 'deep'>('standard')
  const [clientName, setClientName] = useState('')

  const ready = isReady()
  const safeCity = city.trim().slice(0, 50)
  const safeNiche = niche.trim().slice(0, 100)
  const canDiscover = ready && safeCity.length > 0 && safeNiche.length > 0 && !isPending

  const handleSubmit = () => {
    if (!canDiscover) return
    discover(
      { city: safeCity, niche: safeNiche, depth, clientName: clientName.trim() },
      {
        onSuccess: () => navigate('/discover/results'),
        onError: () => navigate('/discover'),
      },
    )
    navigate('/discover/progress')
  }

  return (
    <div className="max-w-xl mx-auto mt-8">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-teal-50 rounded-xl mb-4">
          <MapPin size={24} className="text-teal-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Location Discovery</h1>
        <p className="mt-2 text-sm text-slate-500">
          Find top creators in any city and niche — no competitor handles needed.
        </p>
      </div>

      {/* Keys required banner */}
      {!ready && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">API keys required</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Add your Gemini and Apify API keys in{' '}
              <a href="/settings" className="underline font-medium">Settings</a>{' '}
              to start discovering.
            </p>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        {/* City + Niche row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              City <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value.replace(/[\n\r]/g, ''))}
              placeholder="e.g. Mumbai"
              maxLength={50}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Niche <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={niche}
              onChange={(e) => setNiche(e.target.value.replace(/[\n\r]/g, ''))}
              placeholder="e.g. food"
              maxLength={100}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Depth toggle */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Depth</label>
          <div className="flex gap-2">
            {(['standard', 'deep'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  depth === d
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {d === 'standard' ? 'Standard' : 'Deep'}
                <span className={`block text-xs font-normal mt-0.5 ${depth === d ? 'text-teal-100' : 'text-slate-400'}`}>
                  {d === 'standard' ? '~85s · 5 hashtags' : '~110s · 8 hashtags'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Client name (optional) */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Client name{' '}
            <span className="text-slate-400 font-normal text-xs">(optional — used in export filename)</span>
          </label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Acme Corp"
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>

        {/* CTA */}
        <button
          onClick={handleSubmit}
          disabled={!canDiscover}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <MapPin size={16} />
          {isPending ? 'Discovering...' : 'Discover Creators'}
        </button>
      </div>

      {/* How it works explainer */}
      <div className="mt-6 px-4 py-4 bg-slate-50 rounded-xl border border-slate-100">
        <p className="text-xs font-medium text-slate-600 mb-2">How it works</p>
        <ol className="space-y-1.5">
          {[
            'Generates location-aware hashtags for your city + niche',
            'Scrapes recent posts from those hashtags',
            'Fetches full profiles for all post authors',
            'Filters by city signal in creator bios',
            'AI selects the top 10 with rich profile insights',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-500">
              <span className="flex-shrink-0 w-4 h-4 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-[10px] font-bold mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
