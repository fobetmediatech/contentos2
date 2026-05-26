import { Check, Loader2 } from 'lucide-react'
import { STEP_LABELS, type AnalysisStep } from '../store/analysisStore'

interface ProgressStepsProps {
  currentStep: AnalysisStep
}

const STEPS: AnalysisStep[] = [1, 2, 3, 4, 5]

export function ProgressSteps({ currentStep }: ProgressStepsProps) {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-3">
        {STEPS.map((step) => {
          const isDone = step < currentStep
          const isActive = step === currentStep

          return (
            <div
              key={step}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive
                  ? 'bg-indigo-50 border border-indigo-200'
                  : isDone
                  ? 'bg-slate-50 border border-slate-100'
                  : 'bg-white border border-slate-100 opacity-40'
              }`}
            >
              {/* Step indicator */}
              <div
                className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  isDone
                    ? 'bg-green-100 text-green-700'
                    : isActive
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                {isDone ? (
                  <Check size={14} strokeWidth={2.5} />
                ) : isActive ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  step
                )}
              </div>

              {/* Step label */}
              <span
                className={`text-sm ${
                  isActive ? 'text-indigo-900 font-medium' : isDone ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
