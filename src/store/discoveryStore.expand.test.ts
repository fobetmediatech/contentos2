/**
 * Unit tests for discoveryStore — coverage for fields added for the quality gate:
 *
 *   setStepProgressDetail(detail | null)
 *   didExpand field (initial state, setResults 5th arg, reset)
 *   step 6 (DiscoveryStep type includes 6 since quality gate introduced it)
 *
 * Covers:
 *   1. stepProgressDetail starts as null
 *   2. setStepProgressDetail('text') stores the string
 *   3. setStepProgressDetail(null) clears it
 *   4. reset() clears stepProgressDetail back to null
 *   5. didExpand starts as false
 *   6. setResults without 5th arg → didExpand stays false
 *   7. setResults with didExpand=true → didExpand is true
 *   8. setResults with didExpand=false → didExpand is false
 *   9. reset() clears didExpand back to false
 *  10. setStep(6) advances currentStep to 6
 *  11. reset() after step 6 returns currentStep to 1
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useDiscoveryStore } from './discoveryStore'
import type { DiscoveryParams } from './discoveryStore'
import type { NormalizedProfile } from '../lib/transformers'
import type { DiscoveryOutput } from '../ai/prompts'

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

const OUTPUT: DiscoveryOutput = {
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

// ── stepProgressDetail ────────────────────────────────────────────────────────

describe('discoveryStore — stepProgressDetail', () => {
  it('starts as null', () => {
    expect(useDiscoveryStore.getState().stepProgressDetail).toBeNull()
  })

  it('setStepProgressDetail stores a string', () => {
    useDiscoveryStore.getState().setStepProgressDetail('Expanding search — found 3 so far')
    expect(useDiscoveryStore.getState().stepProgressDetail).toBe('Expanding search — found 3 so far')
  })

  it('setStepProgressDetail(null) clears the value', () => {
    useDiscoveryStore.getState().setStepProgressDetail('some detail')
    useDiscoveryStore.getState().setStepProgressDetail(null)
    expect(useDiscoveryStore.getState().stepProgressDetail).toBeNull()
  })

  it('reset() clears stepProgressDetail to null', () => {
    useDiscoveryStore.getState().setStepProgressDetail('in progress')
    useDiscoveryStore.getState().reset()
    expect(useDiscoveryStore.getState().stepProgressDetail).toBeNull()
  })

  it('startDiscovery() resets stepProgressDetail to null', () => {
    useDiscoveryStore.getState().setStepProgressDetail('in progress')
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    expect(useDiscoveryStore.getState().stepProgressDetail).toBeNull()
  })
})

// ── didExpand ─────────────────────────────────────────────────────────────────

describe('discoveryStore — didExpand', () => {
  it('starts as false', () => {
    expect(useDiscoveryStore.getState().didExpand).toBe(false)
  })

  it('setResults without 5th arg leaves didExpand as false', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().setResults(OUTPUT, [CANDIDATE], false, ['MumbaiFood'])
    expect(useDiscoveryStore.getState().didExpand).toBe(false)
  })

  it('setResults with didExpand=true sets didExpand to true', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().setResults(OUTPUT, [CANDIDATE], false, ['MumbaiFood'], true)
    expect(useDiscoveryStore.getState().didExpand).toBe(true)
  })

  it('setResults with explicit didExpand=false keeps it false', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().setResults(OUTPUT, [CANDIDATE], false, ['MumbaiFood'], false)
    expect(useDiscoveryStore.getState().didExpand).toBe(false)
  })

  it('reset() returns didExpand to false', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().setResults(OUTPUT, [CANDIDATE], false, ['MumbaiFood'], true)
    useDiscoveryStore.getState().reset()
    expect(useDiscoveryStore.getState().didExpand).toBe(false)
  })
})

// ── step 6 ────────────────────────────────────────────────────────────────────

describe('discoveryStore — step 6 (quality gate)', () => {
  it('setStep(6) advances currentStep to 6', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().setStep(6)
    expect(useDiscoveryStore.getState().currentStep).toBe(6)
  })

  it('reset() after step 6 returns currentStep to 1', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().setStep(6)
    useDiscoveryStore.getState().reset()
    expect(useDiscoveryStore.getState().currentStep).toBe(1)
  })

  it('startDiscovery() resets currentStep to 1', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().setStep(6)
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    expect(useDiscoveryStore.getState().currentStep).toBe(1)
  })
})

// ── setResults clears stepProgressDetail ────────────────────────────────────

describe('discoveryStore — setResults clears stepProgressDetail', () => {
  it('setResults clears stepProgressDetail to null (prevents city-string corruption in done card)', () => {
    useDiscoveryStore.getState().startDiscovery(PARAMS)
    useDiscoveryStore.getState().setStepProgressDetail('Expanding search — found 2 so far')
    useDiscoveryStore.getState().setResults(OUTPUT, [CANDIDATE], false, ['MumbaiFood'])
    // Must be null so ChatPage doesn't use expansion text as city name
    expect(useDiscoveryStore.getState().stepProgressDetail).toBeNull()
  })
})
