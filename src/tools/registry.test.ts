/**
 * PIPELINE_REGISTRY unit tests.
 *
 * Validates that each registry entry has the required shape (id, name, steps)
 * and that steps arrays match the corresponding store STEP_LABELS.
 */

import { describe, it, expect } from 'vitest'
import { PIPELINE_REGISTRY } from './registry'
import { STEP_LABELS } from '../store/analysisStore'
import { DISCOVERY_STEP_LABELS } from '../store/discoveryStore'

describe('PIPELINE_REGISTRY — competitor entry', () => {
  const entry = PIPELINE_REGISTRY['competitor']

  it('exists in the registry', () => {
    expect(entry).toBeDefined()
  })

  it('has id "competitor"', () => {
    expect(entry.id).toBe('competitor')
  })

  it('steps array matches STEP_LABELS values in order', () => {
    expect(entry.steps).toEqual(Object.values(STEP_LABELS))
  })

  it('steps array has 5 entries', () => {
    expect(entry.steps).toHaveLength(5)
  })
})

describe('PIPELINE_REGISTRY — discovery entry', () => {
  const entry = PIPELINE_REGISTRY['discovery']

  it('exists in the registry', () => {
    expect(entry).toBeDefined()
  })

  it('has id "discovery"', () => {
    expect(entry.id).toBe('discovery')
  })

  it('steps array contains steps 1-5 only (step 6 is dynamic, added by useActivePipeline)', () => {
    const expectedSteps = Object.entries(DISCOVERY_STEP_LABELS)
      .filter(([k]) => Number(k) <= 5)
      .map(([, v]) => v)
    expect(entry.steps).toEqual(expectedSteps)
  })

  it('steps array has 5 entries (step 6 is conditional)', () => {
    expect(entry.steps).toHaveLength(5)
  })
})

describe('PIPELINE_REGISTRY — reel entry', () => {
  const entry = PIPELINE_REGISTRY['reel']

  it('exists in the registry', () => {
    expect(entry).toBeDefined()
  })

  it('has id "reel"', () => {
    expect(entry.id).toBe('reel')
  })

  it('has a non-empty steps array', () => {
    expect(entry.steps.length).toBeGreaterThan(0)
  })
})

describe('PIPELINE_REGISTRY — single-reel entry', () => {
  const entry = PIPELINE_REGISTRY['single-reel']

  it('exists in the registry', () => {
    expect(entry).toBeDefined()
  })

  it('has id "single-reel"', () => {
    expect(entry.id).toBe('single-reel')
  })

  it('has a non-empty steps array', () => {
    expect(entry.steps.length).toBeGreaterThan(0)
  })
})

describe('PIPELINE_REGISTRY — registry shape invariants', () => {
  it('has exactly 4 entries (competitor + discovery + reel + single-reel)', () => {
    expect(Object.keys(PIPELINE_REGISTRY)).toHaveLength(4)
  })

  it('every entry id matches its key', () => {
    for (const [key, descriptor] of Object.entries(PIPELINE_REGISTRY)) {
      expect(descriptor.id).toBe(key)
    }
  })

  it('no entry has an empty steps array', () => {
    for (const descriptor of Object.values(PIPELINE_REGISTRY)) {
      expect(descriptor.steps.length).toBeGreaterThan(0)
    }
  })

  it('every entry has a non-empty name', () => {
    for (const descriptor of Object.values(PIPELINE_REGISTRY)) {
      expect(descriptor.name.length).toBeGreaterThan(0)
    }
  })
})
