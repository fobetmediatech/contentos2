/**
 * Unit tests for computeActivePipeline() — step 6 (quality gate) paths.
 *
 * Covers gaps identified by the ship coverage audit:
 *   1. discoveryStep >= 6 → dynamicStepLabels includes all 6 DISCOVERY_STEP_LABELS
 *   2. discoveryStep = 5 → static 5-label registry (unchanged behaviour)
 *   3. step === 6 + stepProgressDetail !== null → progressLabel = stepProgressDetail
 *   4. step === 6 + stepProgressDetail === null → falls back to city label
 *   5. step === 6 + stepProgressDetail === null + no city → falls back to generic label
 */

import { describe, it, expect } from 'vitest'
import { computeActivePipeline } from './useActivePipeline'
import { DISCOVERY_STEP_LABELS } from '../store/discoveryStore'
import type { PipelineInputValues } from './useActivePipeline'

function base(): PipelineInputValues {
  return {
    analysisStatus: 'chatting',
    analysisStep: 1,
    analysisNiche: '',
    discoveryStatus: 'idle',
    discoveryStep: 1,
    discoveryCity: null,
    discoveryResults: [],
    discoveryStepProgressDetail: null,
  }
}

// ── 6-label step labels ───────────────────────────────────────────────────────

describe('computeActivePipeline — discovery step 6: dynamicStepLabels', () => {
  it('includes all 6 labels when discoveryStep = 6', () => {
    const result = computeActivePipeline({
      ...base(),
      discoveryStatus: 'running',
      discoveryStep: 6,
    })
    expect(result.stepLabels).toEqual(Object.values(DISCOVERY_STEP_LABELS))
    expect(result.stepLabels).toHaveLength(6)
  })

  it('the 6th label is the expansion label', () => {
    const result = computeActivePipeline({
      ...base(),
      discoveryStatus: 'running',
      discoveryStep: 6,
    })
    expect(result.stepLabels[5]).toBe(DISCOVERY_STEP_LABELS[6])
  })

  it('uses static 5-label registry when discoveryStep = 5', () => {
    const result = computeActivePipeline({
      ...base(),
      discoveryStatus: 'running',
      discoveryStep: 5,
    })
    expect(result.stepLabels).toHaveLength(5)
    expect(result.stepLabels.some(l => l === DISCOVERY_STEP_LABELS[6])).toBe(false)
  })

  it('uses static 5-label registry when discoveryStep = 1', () => {
    const result = computeActivePipeline({
      ...base(),
      discoveryStatus: 'running',
      discoveryStep: 1,
    })
    expect(result.stepLabels).toHaveLength(5)
  })
})

// ── progressLabel override when step = 6 ────────────────────────────────────

describe('computeActivePipeline — discovery step 6: progressLabel', () => {
  it('uses stepProgressDetail as progressLabel when step = 6 and detail is set', () => {
    const result = computeActivePipeline({
      ...base(),
      discoveryStatus: 'running',
      discoveryStep: 6,
      discoveryCity: 'Delhi',
      discoveryStepProgressDetail: 'Expanding search — found 2 so far',
    })
    expect(result.progressLabel).toBe('Expanding search — found 2 so far')
  })

  it('falls back to city label when step = 6 but detail is null', () => {
    const result = computeActivePipeline({
      ...base(),
      discoveryStatus: 'running',
      discoveryStep: 6,
      discoveryCity: 'Pune',
      discoveryStepProgressDetail: null,
    })
    expect(result.progressLabel).toBe('Discovering creators in Pune…')
  })

  it('falls back to generic label when step = 6, detail is null, and no city', () => {
    const result = computeActivePipeline({
      ...base(),
      discoveryStatus: 'running',
      discoveryStep: 6,
      discoveryCity: null,
      discoveryStepProgressDetail: null,
    })
    expect(result.progressLabel).toBe('Running location discovery…')
  })

  it('does NOT use detail for progressLabel when step = 5', () => {
    const result = computeActivePipeline({
      ...base(),
      discoveryStatus: 'running',
      discoveryStep: 5,
      discoveryCity: 'Chennai',
      discoveryStepProgressDetail: 'some detail',
    })
    // step = 5, so the override condition (step === 6 && detail) is false
    expect(result.progressLabel).toBe('Discovering creators in Chennai…')
  })
})
