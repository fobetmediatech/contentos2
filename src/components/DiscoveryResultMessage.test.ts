/**
 * Tests for deriveDiscoveryView — the pure view-model behind DiscoveryResultMessage.
 * Parallels the competitor view test: split/sort by category+rank and the cohort-ER default.
 */

import { describe, it, expect } from 'vitest'
import { deriveDiscoveryView } from './discoveryResultView'
import type { DiscoveryResultPayload } from '../store/analysisStore'
import type { DiscoveryResult } from '../ai/prompts'
import type { NormalizedProfile } from '../lib/transformers'

const res = (username: string, category: 'top' | 'trending', rank: number): DiscoveryResult => ({
  username,
  category,
  rank,
  rationale: '',
  specialties: [],
  contentFocus: '',
  partnershipReady: false,
  locationConfidence: 'unknown',
})
const prof = (username: string, engagementRate: number): NormalizedProfile =>
  ({ username, engagementRate } as unknown as NormalizedProfile)

const payload = (results: DiscoveryResult[], profiles: NormalizedProfile[]): DiscoveryResultPayload => ({
  kind: 'discovery',
  results,
  city: 'Pune',
  profiles,
  didExpand: false,
  locationRelaxed: false,
})

describe('deriveDiscoveryView', () => {
  it('splits top vs trending and sorts each by rank', () => {
    const v = deriveDiscoveryView(
      payload([res('b', 'top', 2), res('a', 'top', 1), res('c', 'trending', 1)], []),
    )
    expect(v.top.map((r) => r.username)).toEqual(['a', 'b'])
    expect(v.trending.map((r) => r.username)).toEqual(['c'])
  })

  it('cohortAvgER averages profile ERs; defaults to 3.0 when none', () => {
    const withER = deriveDiscoveryView(payload([res('a', 'top', 1), res('b', 'top', 2)], [prof('a', 2), prof('b', 8)]))
    expect(withER.cohortAvgER).toBe(5)
    const noER = deriveDiscoveryView(payload([res('a', 'top', 1)], []))
    expect(noER.cohortAvgER).toBe(3.0)
  })
})
