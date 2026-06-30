import { Check, Loader2 } from 'lucide-react'
import { STEP_LABELS, type AnalysisStep } from '../store/analysisStore'

// ProgressSteps supports both the competitor analysis flow (AnalysisStep = 1|2|3|4|5
// with STEP_LABELS from analysisStore) and the discovery flow (steps passed as a
// string[] prop). When `steps` is provided, it takes precedence over STEP_LABELS.

interface ProgressStepsProps {
  /** Current step index (1-based). Widened from AnalysisStep to number for discovery flow. */
  currentStep: number
  /** Optional custom step labels. When provided, overrides STEP_LABELS from analysisStore. */
  steps?: string[]
}

export function ProgressSteps({ currentStep, steps }: ProgressStepsProps) {
  // Use custom steps if provided, otherwise fall back to competitor analysis labels
  const stepLabels: Record<number, string> = steps
    ? Object.fromEntries(steps.map((label, i) => [i + 1, label]))
    : (STEP_LABELS as Record<number, string>)

  const stepCount = steps ? steps.length : 5
  const stepIndices = Array.from({ length: stepCount }, (_, i) => i + 1)

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-3">
        {stepIndices.map((step) => {
          const isDone = step < currentStep
          const isActive = step === currentStep

          return (
            <div
              key={step}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive
                  ? 'bg-[#2C2218] border border-[#E07B3A]/40'
                  : isDone
                  ? 'bg-[#2C2218] border border-[rgba(245,237,214,0.08)]'
                  : 'bg-[#1A1410] border border-[rgba(245,237,214,0.08)] opacity-40'
              }`}
            >
              {/* Step indicator */}
              <div
                className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  isDone
                    ? 'bg-success/15 text-success'
                    : isActive
                    ? 'bg-[#E07B3A] text-[#1A1410]'
                    : 'bg-[#3D3025] text-[#8B7D6B]'
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
                  isActive ? 'text-[#F5EDD6] font-medium' : isDone ? 'text-[#C4A882]' : 'text-[#8B7D6B]'
                }`}
              >
                {stepLabels[step] ?? `Step ${step}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Backward-compatible re-export for the competitor analysis ProgressPage
// which passes currentStep as AnalysisStep — no change needed there.
export type { AnalysisStep }
