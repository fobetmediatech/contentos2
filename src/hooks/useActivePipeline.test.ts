/**
 * useActivePipeline — unit tests for computeActivePipeline().
 *
 * Tests the pure computation function directly (no React/jsdom needed).
 * The hook is a thin wrapper around computeActivePipeline — if the pure
 * function is correct, the hook is correct.
 *
 * Covers:
 *   1. Null state (both pipelines idle)
 *   2. Competitor pipeline: running, clarifying, done
 *   3. Discovery pipeline: running, done (with and without results)
 *   4. Precedence rule: competitor wins when analysisStatus ≠ idle/chatting
 *   5. progressLabel fallbacks when niche/city is missing
 */

import { describe, it, expect } from 'vitest'
import { computeActivePipeline } from './useActivePipeline'
import { STEP_LABELS } from '../store/analysisStore'
import { DISCOVERY_STEP_LABELS } from '../store/discoveryStore'
import type { PipelineInputValues } from './useActivePipeline'
import type { DiscoveryResult } from '../ai/prompts'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EMPTY_DISCOVERY_RESULT: DiscoveryResult = {
  username: 'test_user',
  rank: 1,
  category: 'top',
  rationale: '',
  specialties: [],
  contentFocus: '',
  partnershipReady: false,
  locationConfidence: 'likely',
}

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

// ── Null state ────────────────────────────────────────────────────────────────

describe('computeActivePipeline — no pipeline active', () => {
  it('returns null activePipelineId when both idle/chatting', () => {
    expect(computeActivePipeline(base()).activePipelineId).toBeNull()
  })

  it('isRunning is false', () => {
    expect(computeActivePipeline(base()).isRunning).toBe(false)
  })

  it('isDone is false', () => {
    expect(computeActivePipeline(base()).isDone).toBe(false)
  })

  it('followUpAllowed is false', () => {
    expect(computeActivePipeline(base()).followUpAllowed).toBe(false)
  })

  it('stepLabels is empty array', () => {
    expect(computeActivePipeline(base()).stepLabels).toEqual([])
  })

  it('resultsPath is empty string', () => {
    expect(computeActivePipeline(base()).resultsPath).toBe('')
  })

  it('discoveryResults is null', () => {
    expect(computeActivePipeline(base()).discoveryResults).toBeNull()
  })
})

// ── Competitor pipeline — running ─────────────────────────────────────────────

describe('computeActivePipeline — competitor running', () => {
  const v = () => ({ ...base(), analysisStatus: 'running' as const, analysisStep: 3, analysisNiche: 'food bloggers' })

  it('activePipelineId is "competitor"', () => {
    expect(computeActivePipeline(v()).activePipelineId).toBe('competitor')
  })

  it('isRunning is true', () => {
    expect(computeActivePipeline(v()).isRunning).toBe(true)
  })

  it('isDone is false', () => {
    expect(computeActivePipeline(v()).isDone).toBe(false)
  })

  it('step reflects analysisStep', () => {
    expect(computeActivePipeline(v()).step).toBe(3)
  })

  it('stepLabels matches STEP_LABELS values', () => {
    expect(computeActivePipeline(v()).stepLabels).toEqual(Object.values(STEP_LABELS))
  })

  it('progressLabel contains the niche', () => {
    expect(computeActivePipeline(v()).progressLabel).toContain('food bloggers')
  })

  it('resultsPath is "/results"', () => {
    expect(computeActivePipeline(v()).resultsPath).toBe('/results')
  })

  it('discoveryResults is null', () => {
    expect(computeActivePipeline(v()).discoveryResults).toBeNull()
  })

  it('followUpAllowed is false while running', () => {
    expect(computeActivePipeline(v()).followUpAllowed).toBe(false)
  })
})

// ── Competitor pipeline — clarifying (treated as running) ─────────────────────

describe('computeActivePipeline — competitor clarifying', () => {
  const v = () => ({ ...base(), analysisStatus: 'clarifying' as const, analysisStep: 5 })

  it('isRunning is true', () => {
    expect(computeActivePipeline(v()).isRunning).toBe(true)
  })

  it('isDone is false', () => {
    expect(computeActivePipeline(v()).isDone).toBe(false)
  })

  it('activePipelineId is "competitor"', () => {
    expect(computeActivePipeline(v()).activePipelineId).toBe('competitor')
  })
})

// ── Competitor pipeline — done ────────────────────────────────────────────────

describe('computeActivePipeline — competitor done', () => {
  const v = () => ({ ...base(), analysisStatus: 'done' as const, analysisStep: 5, analysisNiche: 'fitness' })

  it('isDone is true', () => {
    expect(computeActivePipeline(v()).isDone).toBe(true)
  })

  it('isRunning is false', () => {
    expect(computeActivePipeline(v()).isRunning).toBe(false)
  })

  it('followUpAllowed is true', () => {
    expect(computeActivePipeline(v()).followUpAllowed).toBe(true)
  })

  it('activePipelineId is "competitor"', () => {
    expect(computeActivePipeline(v()).activePipelineId).toBe('competitor')
  })
})

// ── Discovery pipeline — running ──────────────────────────────────────────────

describe('computeActivePipeline — discovery running', () => {
  const v = () => ({
    ...base(),
    discoveryStatus: 'running' as const,
    discoveryStep: 2,
    discoveryCity: 'Mumbai',
  })

  it('activePipelineId is "discovery"', () => {
    expect(computeActivePipeline(v()).activePipelineId).toBe('discovery')
  })

  it('isRunning is true', () => {
    expect(computeActivePipeline(v()).isRunning).toBe(true)
  })

  it('isDone is false', () => {
    expect(computeActivePipeline(v()).isDone).toBe(false)
  })

  it('step is 2', () => {
    expect(computeActivePipeline(v()).step).toBe(2)
  })

  it('stepLabels contains steps 1-5 (step 6 not included when discoveryStep < 6)', () => {
    const expectedLabels = Object.entries(DISCOVERY_STEP_LABELS)
      .filter(([k]) => Number(k) <= 5)
      .map(([, v]) => v)
    expect(computeActivePipeline(v()).stepLabels).toEqual(expectedLabels)
  })

  it('progressLabel includes the city', () => {
    expect(computeActivePipeline(v()).progressLabel).toContain('Mumbai')
  })

  it('resultsPath is "/discover/results"', () => {
    expect(computeActivePipeline(v()).resultsPath).toBe('/discover/results')
  })

  it('discoveryResults is null while running', () => {
    expect(computeActivePipeline(v()).discoveryResults).toBeNull()
  })

  it('followUpAllowed is false while running', () => {
    expect(computeActivePipeline(v()).followUpAllowed).toBe(false)
  })
})

// ── Discovery pipeline — done ─────────────────────────────────────────────────

describe('computeActivePipeline — discovery done', () => {
  const results: DiscoveryResult[] = [EMPTY_DISCOVERY_RESULT, { ...EMPTY_DISCOVERY_RESULT, username: 'user2', rank: 2 }]
  const v = () => ({
    ...base(),
    discoveryStatus: 'done' as const,
    discoveryStep: 5,
    discoveryCity: 'Delhi',
    discoveryResults: results,
  })

  it('isDone is true', () => {
    expect(computeActivePipeline(v()).isDone).toBe(true)
  })

  it('followUpAllowed is true', () => {
    expect(computeActivePipeline(v()).followUpAllowed).toBe(true)
  })

  it('discoveryResults is populated', () => {
    expect(computeActivePipeline(v()).discoveryResults).toHaveLength(2)
  })

  it('activePipelineId is "discovery"', () => {
    expect(computeActivePipeline(v()).activePipelineId).toBe('discovery')
  })
})

describe('computeActivePipeline — discovery done with empty results', () => {
  it('discoveryResults is null when results array is empty', () => {
    const v = { ...base(), discoveryStatus: 'done' as const, discoveryStep: 5, discoveryCity: 'Chennai', discoveryResults: [] }
    expect(computeActivePipeline(v).discoveryResults).toBeNull()
  })
})

// ── Precedence rule ───────────────────────────────────────────────────────────

describe('computeActivePipeline — precedence', () => {
  it('competitor wins when analysisStatus is "running" (even if discovery also running)', () => {
    const v: PipelineInputValues = {
      ...base(),
      analysisStatus: 'running',
      analysisStep: 2,
      discoveryStatus: 'running',
      discoveryStep: 3,
      discoveryCity: 'Pune',
    }
    expect(computeActivePipeline(v).activePipelineId).toBe('competitor')
  })

  it('competitor wins when analysisStatus is "done" (even if discovery also done)', () => {
    const v: PipelineInputValues = {
      ...base(),
      analysisStatus: 'done',
      discoveryStatus: 'done',
      discoveryResults: [EMPTY_DISCOVERY_RESULT],
    }
    expect(computeActivePipeline(v).activePipelineId).toBe('competitor')
  })

  it('discovery is chosen when analysisStatus is "chatting"', () => {
    const v: PipelineInputValues = {
      ...base(),
      analysisStatus: 'chatting',
      discoveryStatus: 'running',
      discoveryCity: 'Hyderabad',
    }
    expect(computeActivePipeline(v).activePipelineId).toBe('discovery')
  })

  it('discovery is chosen when analysisStatus is "idle"', () => {
    const v: PipelineInputValues = {
      ...base(),
      analysisStatus: 'idle',
      discoveryStatus: 'running',
      discoveryCity: 'Hyderabad',
    }
    expect(computeActivePipeline(v).activePipelineId).toBe('discovery')
  })
})

// ── progressLabel fallbacks ───────────────────────────────────────────────────

describe('computeActivePipeline — progressLabel fallbacks', () => {
  it('competitor: generic label when niche is empty', () => {
    const v = { ...base(), analysisStatus: 'running' as const, analysisNiche: '' }
    expect(computeActivePipeline(v).progressLabel).toBe('Analyzing creators…')
  })

  it('discovery: generic label when city is null', () => {
    const v = { ...base(), discoveryStatus: 'running' as const, discoveryCity: null }
    expect(computeActivePipeline(v).progressLabel).toBe('Running location discovery…')
  })
})
