/**
 * Pure per-tool cockpit progress-label functions.
 *
 * Each function returns a non-empty summary string for the cockpit pane — no side effects,
 * no store reads, no logging. Takes only the values it needs as arguments.
 */

import { STEP_LABELS } from '../store/analysisStore'
import { DISCOVERY_STEP_LABELS } from '../store/discoveryStore'
import { PIPELINE_REGISTRY } from '../tools/registry'
import type { CreatorAnalysisState } from '../store/reelAnalysisStore'

export function competitorRunLabel(status: string, currentStep: number, stepProgressDetail: string): string {
  if (status === 'clarifying') return 'Waiting for your answer…'
  return stepProgressDetail
    ? `${stepProgressDetail}…`
    : (STEP_LABELS[currentStep as keyof typeof STEP_LABELS] ?? 'Analyzing competitors…')
}

export function discoveryRunLabel(currentStep: number, stepProgressDetail: string | null): string {
  return stepProgressDetail ? `${stepProgressDetail}` : (DISCOVERY_STEP_LABELS[currentStep] ?? 'Finding creators…')
}

export function repurposeRunLabel(status: string): string {
  const steps = PIPELINE_REGISTRY.repurpose.steps
  if (status === 'building-profile') return steps[0]
  if (status === 'analyzing-source') return steps[1]
  if (status === 'rewriting') return steps[2]
  return 'Repurposing…'
}

export function reelRunLabel(creatorStates: Record<string, CreatorAnalysisState>, synthesisStatus: string): string {
  const handles = Object.values(creatorStates)
  const done = handles.filter((c) => c.status === 'done' || c.status === 'no-reels' || c.status === 'failed').length
  if (handles.length === 0) return 'Scraping reels…'
  if (synthesisStatus === 'running') {
    return `Synthesizing patterns across ${handles.length} creator${handles.length !== 1 ? 's' : ''}…`
  }
  return `Analyzing ${handles.length} creator${handles.length !== 1 ? 's' : ''} (${done}/${handles.length})…`
}
