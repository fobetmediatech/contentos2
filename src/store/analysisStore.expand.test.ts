/**
 * Unit tests for analysisStore — setDidExpand() and didExpand in reset().
 *
 * Covers:
 *   1. setDidExpand(true) stores true
 *   2. setDidExpand(false) stores false
 *   3. reset() returns didExpand to false
 *   4. startAnalysis() resets didExpand to false
 *   5. didExpand starts at false in initial state
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAnalysisStore } from './analysisStore'

beforeEach(() => {
  useAnalysisStore.getState().reset()
})

describe('analysisStore — didExpand initial state', () => {
  it('starts as false', () => {
    expect(useAnalysisStore.getState().didExpand).toBe(false)
  })
})

describe('analysisStore — setDidExpand', () => {
  it('sets didExpand to true', () => {
    useAnalysisStore.getState().setDidExpand(true)
    expect(useAnalysisStore.getState().didExpand).toBe(true)
  })

  it('sets didExpand back to false', () => {
    useAnalysisStore.getState().setDidExpand(true)
    useAnalysisStore.getState().setDidExpand(false)
    expect(useAnalysisStore.getState().didExpand).toBe(false)
  })

  it('does not affect other store fields', () => {
    useAnalysisStore.getState().startChat()
    useAnalysisStore.getState().setDidExpand(true)
    expect(useAnalysisStore.getState().status).toBe('chatting')
    expect(useAnalysisStore.getState().didExpand).toBe(true)
  })
})

describe('analysisStore — reset clears didExpand', () => {
  it('reset() returns didExpand to false', () => {
    useAnalysisStore.getState().setDidExpand(true)
    useAnalysisStore.getState().reset()
    expect(useAnalysisStore.getState().didExpand).toBe(false)
  })

  it('startAnalysis() returns didExpand to false', () => {
    useAnalysisStore.getState().setDidExpand(true)
    useAnalysisStore.getState().startAnalysis({
      handles: ['handle1'],
      depth: 'standard',
      clientName: 'TestClient',
      nicheContext: '',
    })
    expect(useAnalysisStore.getState().didExpand).toBe(false)
  })
})
