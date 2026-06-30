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
                  ? 'bg-[var(--color-surface)] border border-[rgba(var(--accent-rgb),0.40)]'
                  : isDone
                  ? 'bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.08)]'
                  : 'bg-[var(--color-bg)] border border-[rgba(var(--border-rgb),0.08)] opacity-40'
              }`}
            >
              {/* Step indicator */}
              <div
                className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  isDone
                    ? 'bg-success/15 text-success'
                    : isActive
                    ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
                    : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]'
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
                  isActive ? 'text-[var(--color-text-primary)] font-medium' : isDone ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'
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
