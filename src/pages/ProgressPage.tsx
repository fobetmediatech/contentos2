import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { useAnalysisStore } from '../store/analysisStore'
import { ProgressSteps } from '../components/ProgressSteps'

export function ProgressPage() {
  const navigate = useNavigate()
  const { status, currentStep, error } = useAnalysisStore()

  // Redirect to results when done
  useEffect(() => {
    if (status === 'done') {
      navigate('/results')
    }
  }, [status, navigate])

  // Redirect to home if we land here with no active analysis
  useEffect(() => {
    if (status === 'idle') {
      navigate('/')
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
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Analysis failed</h2>
        <p className="text-sm text-slate-600 mb-6 max-w-sm mx-auto">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto mt-16">
      <div className="text-center mb-10">
        <h1 className="text-xl font-bold text-slate-900">Analyzing competitors...</h1>
        <p className="mt-2 text-sm text-slate-500">
          This takes up to 2 minutes. Don't close this tab.
        </p>
      </div>
      <ProgressSteps currentStep={currentStep} />
    </div>
  )
}
