/**
 * useActivePipeline — bridge hook that presents a unified interface over
 * analysisStore (competitor pipeline) and discoveryStore (location pipeline).
 *
 * Precedence rule:
 *   analysisStore wins whenever its status is outside {'idle', 'chatting'}.
 *   discoveryStore is consulted only when analysisStore is idle or chatting.
 *   This prevents split-brain when both stores have residual state mid-reset.
 *
 * Architecture note:
 *   computeActivePipeline() is a pure function (exported for testing).
 *   The hook is a thin wrapper that reads store state and calls it.
 *   This keeps all logic testable in a node/vitest environment without jsdom.
 */

import { useAnalysisStore } from '../store/analysisStore'
import { useDiscoveryStore, DISCOVERY_STEP_LABELS } from '../store/discoveryStore'
import { PIPELINE_REGISTRY } from '../tools/registry'
import type { DiscoveryResult } from '../ai/prompts'
import type { AnalysisStatus } from '../store/analysisStore'
import type { DiscoveryStatus } from '../store/discoveryStore'

const ANALYSIS_IDLE_STATUSES = new Set<AnalysisStatus>(['idle', 'chatting'])

export interface ActivePipelineState {
  /** 'competitor' | 'discovery' | null (no pipeline active) */
  activePipelineId: string | null
  /** Either pipeline is actively running (showing progress steps) */
  isRunning: boolean
  /** Either pipeline completed successfully */
  isDone: boolean
  /** Current step index (1-based) for the <ProgressSteps /> component */
  step: number
  /** Ordered step labels from the active registry entry */
  stepLabels: string[]
  /** Human-readable progress label shown above the step bar */
  progressLabel: string
  /** Discovery results when the discovery pipeline is done; null otherwise */
  discoveryResults: DiscoveryResult[] | null
  /** True when the done pipeline accepts a follow-up refinement message */
  followUpAllowed: boolean
}

const NULL_STATE: ActivePipelineState = {
  activePipelineId: null,
  isRunning: false,
  isDone: false,
  step: 1,
  stepLabels: [],
  progressLabel: '',
  discoveryResults: null,
  followUpAllowed: false,
}

/** Input values consumed by computeActivePipeline — mirrors what the hook reads. */
export interface PipelineInputValues {
  analysisStatus: AnalysisStatus
  analysisStep: number
  analysisNiche: string
  discoveryStatus: DiscoveryStatus
  discoveryStep: number
  discoveryCity: string | null
  discoveryResults: DiscoveryResult[]
  discoveryStepProgressDetail: string | null
}

/**
 * Pure computation: maps pipeline store values → ActivePipelineState.
 * Exported for unit testing without a React/jsdom environment.
 */
export function computeActivePipeline(v: PipelineInputValues): ActivePipelineState {
  // ── Competitor pipeline active ────────────────────────────────────────────
  if (!ANALYSIS_IDLE_STATUSES.has(v.analysisStatus)) {
    const descriptor = PIPELINE_REGISTRY['competitor']
    const isRunning = v.analysisStatus === 'running' || v.analysisStatus === 'clarifying'
    const isDone = v.analysisStatus === 'done'

    const progressLabel = v.analysisNiche
      ? `Analyzing ${v.analysisNiche} creators…`
      : 'Analyzing creators…'

    return {
      activePipelineId: 'competitor',
      isRunning,
      isDone,
      step: v.analysisStep,
      stepLabels: descriptor.steps,
      progressLabel,
      discoveryResults: null,
      followUpAllowed: isDone,
    }
  }

  // ── Discovery pipeline active ─────────────────────────────────────────────
  if (v.discoveryStatus !== 'idle') {
    const descriptor = PIPELINE_REGISTRY['discovery']
    const isRunning = v.discoveryStatus === 'running'
    const isDone = v.discoveryStatus === 'done'

    // Step 6 ("Expanding search") is only included when the quality gate fires.
    // Non-expansion runs always render as a 5-step bar so they don't look incomplete.
    const dynamicStepLabels = v.discoveryStep >= 6
      ? Object.values(DISCOVERY_STEP_LABELS)   // all 6 labels
      : descriptor.steps                        // static 5-step registry

    const progressLabel = v.discoveryStep === 6 && v.discoveryStepProgressDetail
      ? v.discoveryStepProgressDetail
      : v.discoveryCity
      ? `Discovering creators in ${v.discoveryCity}…`
      : 'Running location discovery…'

    return {
      activePipelineId: 'discovery',
      isRunning,
      isDone,
      step: v.discoveryStep,
      stepLabels: dynamicStepLabels,
      progressLabel,
      discoveryResults: isDone && v.discoveryResults.length > 0 ? v.discoveryResults : null,
      followUpAllowed: isDone,
    }
  }

  // ── No pipeline active ────────────────────────────────────────────────────
  return NULL_STATE
}

/** React hook — reads store values and delegates to computeActivePipeline. */
export function useActivePipeline(): ActivePipelineState {
  const analysisStatus = useAnalysisStore((s) => s.status)
  const analysisStep = useAnalysisStore((s) => s.currentStep)
  const analysisNiche = useAnalysisStore((s) => s.niche)

  const discoveryStatus = useDiscoveryStore((s) => s.status)
  const discoveryStep = useDiscoveryStore((s) => s.currentStep)
  const discoveryCity = useDiscoveryStore((s) => s.params?.city ?? null)
  const discoveryResults = useDiscoveryStore((s) => s.results)
  const discoveryStepProgressDetail = useDiscoveryStore((s) => s.stepProgressDetail)

  return computeActivePipeline({
    analysisStatus,
    analysisStep,
    analysisNiche,
    discoveryStatus,
    discoveryStep,
    discoveryCity,
    discoveryResults,
    discoveryStepProgressDetail,
  })
}
