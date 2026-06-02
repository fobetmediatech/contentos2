/**
 * PIPELINE_REGISTRY unit tests.
 *
 * Validates that each registry entry:
 *   - has the required shape (id, name, steps, resultsPath)
 *   - confirmMessage() returns a non-empty string with niche/location injected
 *   - confirmOptions() includes PROCEED_LABEL as the first option
 *   - steps array matches the corresponding store STEP_LABELS
 */

import { describe, it, expect } from 'vitest'
import { PIPELINE_REGISTRY } from './registry'
import { STEP_LABELS } from '../store/analysisStore'
import { DISCOVERY_STEP_LABELS } from '../store/discoveryStore'
import { PROCEED_LABEL, DISCOVERY_REDIRECT_TO_COMPETITOR, REEL_ANALYZE_LABEL } from '../lib/constants'
import type { ResolvedIntent } from './types'

// Minimal resolved intent fixture (competitor shape)
const competitorIntent: ResolvedIntent = {
  needsClarification: false,
  niche: 'food bloggers',
  location: 'Mumbai',
  knownHandles: [],
  depth: 'standard',
  clientName: undefined,
  pipelineType: 'competitor',
  routingConfidence: 'high',
}

// Discovery intent fixture
const discoveryIntent: ResolvedIntent = {
  needsClarification: false,
  niche: 'fitness creators',
  location: 'Delhi',
  knownHandles: [],
  depth: 'standard',
  clientName: undefined,
  pipelineType: 'discovery',
  routingConfidence: 'high',
}

// Reel intent fixture (names handles to analyze)
const reelIntent: ResolvedIntent = {
  needsClarification: false,
  niche: 'fitness creators',
  location: undefined,
  knownHandles: ['nike', 'garyvee'],
  depth: 'standard',
  clientName: undefined,
  pipelineType: 'reel',
  routingConfidence: 'high',
}

describe('PIPELINE_REGISTRY — competitor entry', () => {
  const entry = PIPELINE_REGISTRY['competitor']

  it('exists in the registry', () => {
    expect(entry).toBeDefined()
  })

  it('has id "competitor"', () => {
    expect(entry.id).toBe('competitor')
  })

  it('resultsPath is "/results"', () => {
    expect(entry.resultsPath).toBe('/results')
  })

  it('steps array matches STEP_LABELS values in order', () => {
    expect(entry.steps).toEqual(Object.values(STEP_LABELS))
  })

  it('steps array has 5 entries', () => {
    expect(entry.steps).toHaveLength(5)
  })

  it('confirmMessage() includes the niche', () => {
    const msg = entry.confirmMessage(competitorIntent)
    expect(msg).toContain('food bloggers')
  })

  it('confirmOptions() includes PROCEED_LABEL', () => {
    const opts = entry.confirmOptions(competitorIntent)
    expect(opts).toContain(PROCEED_LABEL)
  })

  it('confirmOptions() includes additional direction choices', () => {
    const opts = entry.confirmOptions(competitorIntent)
    expect(opts.length).toBeGreaterThan(1)
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

  it('resultsPath is "/discover/results"', () => {
    expect(entry.resultsPath).toBe('/discover/results')
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

  it('confirmMessage() includes the niche and location', () => {
    const msg = entry.confirmMessage(discoveryIntent)
    expect(msg).toContain('fitness creators')
    expect(msg).toContain('Delhi')
  })

  it('confirmOptions() starts with PROCEED_LABEL', () => {
    const opts = entry.confirmOptions(discoveryIntent)
    expect(opts[0]).toBe(PROCEED_LABEL)
  })

  it('confirmOptions() includes DISCOVERY_REDIRECT_TO_COMPETITOR', () => {
    const opts = entry.confirmOptions(discoveryIntent)
    expect(opts).toContain(DISCOVERY_REDIRECT_TO_COMPETITOR)
  })

  it('confirmOptions() has exactly 2 options', () => {
    const opts = entry.confirmOptions(discoveryIntent)
    expect(opts).toHaveLength(2)
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

  it('confirmOptions() includes REEL_ANALYZE_LABEL', () => {
    expect(entry.confirmOptions(reelIntent)).toContain(REEL_ANALYZE_LABEL)
  })

  it('confirmMessage() references the named handles', () => {
    expect(entry.confirmMessage(reelIntent)).toContain('@nike')
  })

  it('has a non-empty steps array', () => {
    expect(entry.steps.length).toBeGreaterThan(0)
  })
})

describe('PIPELINE_REGISTRY — registry shape invariants', () => {
  it('has exactly 3 entries (competitor + discovery + reel)', () => {
    expect(Object.keys(PIPELINE_REGISTRY)).toHaveLength(3)
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

  it('no entry has an empty resultsPath', () => {
    for (const descriptor of Object.values(PIPELINE_REGISTRY)) {
      expect(descriptor.resultsPath.length).toBeGreaterThan(0)
    }
  })
})
