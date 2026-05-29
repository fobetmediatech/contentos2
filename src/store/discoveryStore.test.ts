/**
 * Unit tests for discoveryStore — coverage for all actions and state transitions.
 *
 * Tests the full status lifecycle: idle → running → done/error → reset
 * and verifies that setError always resets currentStep to 1 (step-indicator clear).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useDiscoveryStore } from './discoveryStore'
import type { DiscoveryParams } from './discoveryStore'
import type { NormalizedProfile } from '../lib/transformers'
import type { DiscoveryOutput } from '../ai/prompts'

// Re-set store to initial state before each test so tests are isolated
beforeEach(() => {
  useDiscoveryStore.getState().reset()
})

const PARAMS: DiscoveryParams = {
  city: 'Mumbai',
  niche: 'food bloggers',
  depth: 'standard',
  clientName: 'TestClient',
}

const CANDIDATE: NormalizedProfile = {
  username: 'chef_mumbai',
  fullName: 'Mumbai Chef',
  biography: 'Food lover in Mumbai',
  followersCount: 50000,
  followsCount: 500,
  postsCount: 300,
  profilePicUrl: '',
  verified: false,
  isBusinessAccount: false,
  private: false,
  latestPosts: [],
  relatedProfiles: [],
}

const DISCOVERY_OUTPUT: DiscoveryOutput = {
  niche: 'food bloggers',
  results: [
    {
      username: 'chef_mumbai',
      category: 'top',
      rank: 1,
      rationale: 'Top food blogger',
      specialties: ['indian cuisine'],
      contentFocus: 'restaurant reviews',
      partnershipReady: true,
      locationConfidence: 'confirmed',
    },
  ],
}

describe('discoveryStore — initial state', () => {
  it('starts in idle status', () => {
    expect(useDiscoveryStore.getState().status).toBe('idle')
  })

  it('starts at step 1', () => {
    expect(useDiscoveryStore.getState().currentStep).toBe(1)
  })

  it('starts with null params', () => {
    expect(useDiscoveryStore.getState().params).toBeNull()
  })

  it('starts with empty arrays and null error', () => {
    const s = useDiscoveryStore.getState()
    expect(s.results).toHaveLength(0)
    expect(s.candidateProfiles).toHaveLength(0)
    expect(s.sourceHashtags).toHaveLength(0)
    expect(s.error).toBeNull()
  })
})

describe('discoveryStore — startDiscovery', () => {
  it('transitions status to running', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    expect(useDiscoveryStore.getState().status).toBe('running')
  })

  it('stores the params', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    expect(useDiscoveryStore.getState().params).toEqual(PARAMS)
  })

  it('resets currentStep to 1 even if it was advanced', () => {
    useDiscoveryStore.getState().setStep(4)
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    expect(useDiscoveryStore.getState().currentStep).toBe(1)
  })

  it('clears previous results', () => {
    useDiscoveryStore.getState().setResults(DISCOVERY_OUTPUT, [CANDIDATE], false, ['#food'])
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    expect(useDiscoveryStore.getState().results).toHaveLength(0)
  })
})

describe('discoveryStore — setStep', () => {
  it('advances currentStep', () => {
    useDiscoveryStore.getState().setStep(3)
    expect(useDiscoveryStore.getState().currentStep).toBe(3)
  })

  it('can advance to step 5', () => {
    useDiscoveryStore.getState().setStep(5)
    expect(useDiscoveryStore.getState().currentStep).toBe(5)
  })
})

describe('discoveryStore — setResults', () => {
  it('transitions status to done', () => {
    useDiscoveryStore.getState().setResults(DISCOVERY_OUTPUT, [CANDIDATE], false, ['#food'])
    expect(useDiscoveryStore.getState().status).toBe('done')
  })

  it('stores results and niche from output', () => {
    useDiscoveryStore.getState().setResults(DISCOVERY_OUTPUT, [CANDIDATE], false, ['#food'])
    const s = useDiscoveryStore.getState()
    expect(s.results).toHaveLength(1)
    expect(s.results[0].username).toBe('chef_mumbai')
    expect(s.niche).toBe('food bloggers')
  })

  it('stores candidateProfiles', () => {
    useDiscoveryStore.getState().setResults(DISCOVERY_OUTPUT, [CANDIDATE], false, ['#food'])
    expect(useDiscoveryStore.getState().candidateProfiles).toHaveLength(1)
  })

  it('stores locationFilterRelaxed flag', () => {
    useDiscoveryStore.getState().setResults(DISCOVERY_OUTPUT, [CANDIDATE], true, ['#food'])
    expect(useDiscoveryStore.getState().locationFilterRelaxed).toBe(true)
  })

  it('stores sourceHashtags', () => {
    useDiscoveryStore.getState().setResults(DISCOVERY_OUTPUT, [], false, ['#food', '#mumbai'])
    expect(useDiscoveryStore.getState().sourceHashtags).toEqual(['#food', '#mumbai'])
  })
})

describe('discoveryStore — setError', () => {
  it('transitions status to error', () => {
    useDiscoveryStore.getState().setError('Scraping failed')
    expect(useDiscoveryStore.getState().status).toBe('error')
  })

  it('stores the error message', () => {
    useDiscoveryStore.getState().setError('Scraping failed')
    expect(useDiscoveryStore.getState().error).toBe('Scraping failed')
  })

  it('resets currentStep to 1 so step indicator clears on error', () => {
    useDiscoveryStore.getState().setStep(4)
    useDiscoveryStore.getState().setError('timeout')
    // The step indicator should reset so users don't see a stale step number on retry
    expect(useDiscoveryStore.getState().currentStep).toBe(1)
  })
})

describe('discoveryStore — reset', () => {
  it('restores idle status', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().reset()
    expect(useDiscoveryStore.getState().status).toBe('idle')
  })

  it('clears params', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().reset()
    expect(useDiscoveryStore.getState().params).toBeNull()
  })

  it('clears results and error', () => {
    useDiscoveryStore.getState().setError('oops')
    useDiscoveryStore.getState().reset()
    const s = useDiscoveryStore.getState()
    expect(s.results).toHaveLength(0)
    expect(s.error).toBeNull()
  })

  it('resets currentStep to 1', () => {
    useDiscoveryStore.getState().setStep(5)
    useDiscoveryStore.getState().reset()
    expect(useDiscoveryStore.getState().currentStep).toBe(1)
  })
})
