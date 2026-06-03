/**
 * Unit tests for analysisStore — analysis state + status lifecycle.
 *
 * NOTE: the chat transcript (conversationMessages / addMessage) moved to conversationsStore
 * (multi-conversation history); those behaviors are covered in conversationsStore.test.ts.
 * This file now tests only analysisStore's analysis-specific state.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAnalysisStore } from './analysisStore'
import type { NormalizedProfile } from '../lib/transformers'

beforeEach(() => {
  useAnalysisStore.getState().reset()
})

describe('analysisStore — startChat', () => {
  it('transitions status to chatting', () => {
    useAnalysisStore.getState().startChat()
    expect(useAnalysisStore.getState().status).toBe('chatting')
  })

  it('resets discoveredSeeds', () => {
    useAnalysisStore.getState().setDiscoveredSeeds(['handle1'])
    useAnalysisStore.getState().startChat()
    expect(useAnalysisStore.getState().discoveredSeeds).toHaveLength(0)
  })

  it('resets parsedIntent to null', () => {
    useAnalysisStore.getState().setParsedIntent({ needsClarification: true, question: 'What niche?' })
    useAnalysisStore.getState().startChat()
    expect(useAnalysisStore.getState().parsedIntent).toBeNull()
  })
})

describe('analysisStore — setStatus', () => {
  it('transitions to discovering', () => {
    useAnalysisStore.getState().startChat()
    useAnalysisStore.getState().setStatus('discovering')
    expect(useAnalysisStore.getState().status).toBe('discovering')
  })

  it('transitions to confirming', () => {
    useAnalysisStore.getState().setStatus('confirming')
    expect(useAnalysisStore.getState().status).toBe('confirming')
  })

  it('transitions back to chatting', () => {
    useAnalysisStore.getState().setStatus('running')
    useAnalysisStore.getState().setStatus('chatting')
    expect(useAnalysisStore.getState().status).toBe('chatting')
  })
})

describe('analysisStore — startAnalysis', () => {
  it('resets analysis state (competitors, candidateCount) and sets running', () => {
    useAnalysisStore.getState().setResults({ competitors: [], niche: 'x', summary: 's' }, [], 5)
    useAnalysisStore.getState().startAnalysis({ handles: ['y'], depth: 'standard', clientName: '', nicheContext: '' })
    expect(useAnalysisStore.getState().status).toBe('running')
    expect(useAnalysisStore.getState().competitors).toHaveLength(0)
    expect(useAnalysisStore.getState().candidateCount).toBe(0)
  })
})

describe('analysisStore — setResults stores candidate profiles', () => {
  it('keeps candidateProfiles so competitor cards + the corpus can read their metrics', () => {
    // Regression: setResults only stored inputProfiles (the reference accounts the user typed).
    // The ranked competitors live in candidateProfiles — without storing them, competitor cards
    // showed no ER/followers and the corpus harvested zero creators (no "Seen" badges, dead count).
    const profs = [{ username: 'alice' }, { username: 'bob' }] as NormalizedProfile[]
    useAnalysisStore
      .getState()
      .setResults({ competitors: [], niche: 'ai', summary: 's' }, [], profs.length, profs)
    expect(useAnalysisStore.getState().candidateProfiles.map((p) => p.username)).toEqual(['alice', 'bob'])
  })

  it('defaults candidateProfiles to [] when omitted (back-compat for 3-arg callers)', () => {
    useAnalysisStore.getState().setResults({ competitors: [], niche: 'x', summary: 's' }, [], 5)
    expect(useAnalysisStore.getState().candidateProfiles).toEqual([])
  })
})

describe('analysisStore — setDiscoveredSeeds', () => {
  it('stores discovered seeds', () => {
    useAnalysisStore.getState().setDiscoveredSeeds(['handle1', 'handle2'])
    expect(useAnalysisStore.getState().discoveredSeeds).toEqual(['handle1', 'handle2'])
  })

  it('overwrites existing seeds', () => {
    useAnalysisStore.getState().setDiscoveredSeeds(['old'])
    useAnalysisStore.getState().setDiscoveredSeeds(['new1', 'new2'])
    expect(useAnalysisStore.getState().discoveredSeeds).toEqual(['new1', 'new2'])
  })
})

describe('analysisStore — setParsedIntent', () => {
  it('stores a needsClarification intent', () => {
    const intent = { needsClarification: true as const, question: 'Which niche?' }
    useAnalysisStore.getState().setParsedIntent(intent)
    expect(useAnalysisStore.getState().parsedIntent).toEqual(intent)
  })

  it('can be cleared back to null', () => {
    useAnalysisStore.getState().setParsedIntent({ needsClarification: true, question: 'Q' })
    useAnalysisStore.getState().setParsedIntent(null)
    expect(useAnalysisStore.getState().parsedIntent).toBeNull()
  })
})

describe('analysisStore — reset', () => {
  it('clears discoveredSeeds and parsedIntent', () => {
    useAnalysisStore.getState().setDiscoveredSeeds(['h1'])
    useAnalysisStore.getState().setParsedIntent({ needsClarification: true, question: 'Q' })
    useAnalysisStore.getState().reset()
    expect(useAnalysisStore.getState().discoveredSeeds).toHaveLength(0)
    expect(useAnalysisStore.getState().parsedIntent).toBeNull()
  })
})

describe('analysisStore — chatting → confirming lifecycle', () => {
  it('full flow: startChat → discovering → setDiscoveredSeeds → confirming', () => {
    useAnalysisStore.getState().startChat()
    expect(useAnalysisStore.getState().status).toBe('chatting')
    useAnalysisStore.getState().setStatus('discovering')
    expect(useAnalysisStore.getState().status).toBe('discovering')
    useAnalysisStore.getState().setDiscoveredSeeds(['user1', 'user2'])
    expect(useAnalysisStore.getState().discoveredSeeds).toHaveLength(2)
    useAnalysisStore.getState().setStatus('confirming')
    expect(useAnalysisStore.getState().status).toBe('confirming')
  })
})

describe('analysisStore — candidateCount', () => {
  it('initialises to 0', () => {
    expect(useAnalysisStore.getState().candidateCount).toBe(0)
  })

  it('setResults persists candidateCount', () => {
    useAnalysisStore.getState().setResults({ competitors: [], niche: 'fitness', summary: 'test' }, [], 47)
    expect(useAnalysisStore.getState().candidateCount).toBe(47)
  })

  it('reset clears candidateCount to 0', () => {
    useAnalysisStore.getState().setResults({ competitors: [], niche: 'fitness', summary: 'test' }, [], 23)
    useAnalysisStore.getState().reset()
    expect(useAnalysisStore.getState().candidateCount).toBe(0)
  })
})

describe('analysisStore — stepProgressDetail', () => {
  it('initialises to empty string', () => {
    expect(useAnalysisStore.getState().stepProgressDetail).toBe('')
  })

  it('reset clears stepProgressDetail', () => {
    useAnalysisStore.getState().setStepProgressDetail('Found 47 candidate accounts')
    useAnalysisStore.getState().reset()
    expect(useAnalysisStore.getState().stepProgressDetail).toBe('')
  })

  it('setStepProgressDetail persists the value until reset', () => {
    useAnalysisStore.getState().setStepProgressDetail('Found 23 candidate accounts')
    expect(useAnalysisStore.getState().stepProgressDetail).toBe('Found 23 candidate accounts')
  })
})
