/**
 * DiscoveryProgressPage — 5-step progress display for the location discovery run.
 *
 * Uses the widened ProgressSteps component with discovery-specific step labels.
 * Redirects to /discover/results on success, or stays on error to show the message.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, MapPin } from 'lucide-react'
import { useDiscoveryStore } from '../store/discoveryStore'
import { ProgressSteps } from '../components/ProgressSteps'

const DISCOVERY_STEPS = [
  'Generating location hashtags',
  'Scraping location-tagged posts',
  'Fetching creator profiles',
  'Filtering by location signals',
  'Generating AI insights',
]

export function DiscoveryProgressPage() {
  const navigate = useNavigate()
  const { status, currentStep, error, params } = useDiscoveryStore()

  // Redirect to results when done
  useEffect(() => {
    if (status === 'done') {
      navigate('/discover/results')
    }
  }, [status, navigate])

  // Redirect to discover input if we land here with no active run
  useEffect(() => {
    if (status === 'idle') {
      navigate('/discover')
    }
  }, [status, navigate])

  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle size={24} className="text-red-600" />
          </div>
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Discovery failed</h2>
        <p className="text-sm text-slate-600 mb-6 max-w-sm mx-auto">{error}</p>
        <button
          onClick={() => navigate('/discover')}
          className="px-5 py-2.5 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto mt-16">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-10 h-10 bg-teal-50 rounded-xl mb-4">
          <MapPin size={20} className="text-teal-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">
          Discovering creators
          {params ? ` in ${params.city}` : ''}...
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          This takes up to{' '}
          {params?.depth === 'deep' ? '2 minutes' : '90 seconds'}.
          {' '}Don't close this tab.
        </p>
      </div>
      <ProgressSteps currentStep={currentStep} steps={DISCOVERY_STEPS} />
    </div>
  )
}
