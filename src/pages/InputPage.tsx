import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Zap } from 'lucide-react'
import { useKeysStore } from '../store/keysStore'
import { useCompetitorAnalysis } from '../hooks/useCompetitorAnalysis'

export function InputPage() {
  const navigate = useNavigate()
  const { isReady } = useKeysStore()
  const { analyze, isPending } = useCompetitorAnalysis()

  const [handlesInput, setHandlesInput] = useState('')
  const [depth, setDepth] = useState<'standard' | 'deep'>('standard')
  const [clientName, setClientName] = useState('')
  const [nicheContext, setNicheContext] = useState('')

  const ready = isReady()
  const handles = handlesInput
    .split(/[\n,\s]+/)
    .map((h) => h.replace(/^@/, '').trim())
    .filter(Boolean)
  const canAnalyze = ready && handles.length >= 1 && handles.length <= 5 && !isPending

  const handleSubmit = () => {
    if (!canAnalyze) return
    analyze({ handles, depth, clientName, nicheContext: nicheContext.trim() })
    navigate('/progress')
  }

  return (
    <div className="max-w-xl mx-auto mt-8">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Find Competitors</h1>
        <p className="mt-2 text-sm text-slate-500">
          Enter 1–5 Instagram handles in the same niche. We'll find the top competitors and rising accounts.
        </p>
      </div>

      {/* First-time empty state banner */}
      {!ready && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">API keys required</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Add your Gemini and Apify API keys in{' '}
              <a href="/settings" className="underline font-medium">Settings</a>{' '}
              to start analyzing.
            </p>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        {/* Handles input */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Instagram handles <span className="text-red-500">*</span>
          </label>
          <textarea
            value={handlesInput}
            onChange={(e) => setHandlesInput(e.target.value)}
            placeholder={'pritika.loonia\nthesortedgirl\nmehakmarketing'}
            rows={4}
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none font-mono placeholder:font-sans placeholder:text-slate-400"
          />
          <p className="mt-1 text-xs text-slate-400">
            One per line or comma-separated. Without @. Max 5. Include known competitors, not just your own account — this surfaces more Trending accounts.
            {handles.length > 0 && (
              <span className={`ml-2 font-medium ${handles.length > 5 ? 'text-red-500' : 'text-slate-600'}`}>
                {handles.length}/5
              </span>
            )}
          </p>
        </div>

        {/* Niche context (optional — clarification card covers it) */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Niche context{' '}
            <span className="text-slate-400 font-normal text-xs">(optional — tool will ask after discovery)</span>
          </label>
          <input
            type="text"
            value={nicheContext}
            onChange={(e) => setNicheContext(e.target.value.slice(0, 200))}
            placeholder="e.g. Indian business growth creators — entrepreneurship tips (NOT trading, NOT finance)"
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-slate-400">
            Optional pre-hint. If left blank, the tool will show you what it found and ask which direction to rank toward.
            {nicheContext.length > 160 && (
              <span className="ml-1 text-slate-500">{nicheContext.length}/200</span>
            )}
          </p>
        </div>

        {/* Depth toggle */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Scrape depth</label>
          <div className="flex gap-2">
            {(['standard', 'deep'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  depth === d
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {d === 'standard' ? 'Standard' : 'Deep'}
                <span className={`block text-xs font-normal mt-0.5 ${depth === d ? 'text-indigo-200' : 'text-slate-400'}`}>
                  {d === 'standard' ? '~60s · 5 hashtags' : '~120s · 8 hashtags'}
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
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {/* CTA */}
        <button
          onClick={handleSubmit}
          disabled={!canAnalyze}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Zap size={16} />
          {isPending ? 'Analyzing...' : 'Analyze Competitors'}
        </button>

        {handles.length > 5 && (
          <p className="text-xs text-red-500 text-center">Max 5 handles per analysis.</p>
        )}
      </div>
    </div>
  )
}
