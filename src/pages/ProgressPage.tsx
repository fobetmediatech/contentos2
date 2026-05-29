import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { useAnalysisStore } from '../store/analysisStore'
import { useCompetitorAnalysis } from '../hooks/useCompetitorAnalysis'
import { ProgressSteps } from '../components/ProgressSteps'
import { ClarificationCard } from '../components/ClarificationCard'

export function ProgressPage() {
  const navigate = useNavigate()
  const { status, currentStep, error, pendingDiscovery } = useAnalysisStore()
  const { answerClarification, isPending } = useCompetitorAnalysis()

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
        <h1 className="text-xl font-bold text-slate-900">
          {status === 'clarifying' ? 'One quick check' : 'Analyzing competitors...'}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {status === 'clarifying'
            ? 'Help me rank the right accounts for your client.'
            : "This takes up to 2 minutes. Don't close this tab."}
        </p>
      </div>

      {/* Discovery progress steps (steps 1–4 are completed in 'clarifying' status) */}
      <ProgressSteps currentStep={status === 'clarifying' ? 5 : currentStep} />

      {/* Mid-run clarification card — shown between discovery and ranking */}
      {status === 'clarifying' && pendingDiscovery && (
        <ClarificationCard
          question={pendingDiscovery.clarificationQuestion}
          candidateCount={pendingDiscovery.candidateProfiles.length}
          onAnswer={answerClarification}
          disabled={isPending}
        />
      )}
    </div>
  )
}
