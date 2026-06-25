// src/store/repurposeStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useRepurposeStore, isCleanRepurposeRun } from './repurposeStore'

describe('repurposeStore', () => {
  beforeEach(() => useRepurposeStore.getState().reset())

  it('start sets running state tagged to a conversation', () => {
    useRepurposeStore.getState().start('conv1', 'https://insta/reel/x', 'aanya')
    const s = useRepurposeStore.getState()
    expect(s.status).toBe('building-profile')
    expect(s.conversationId).toBe('conv1')
    expect(s.clientHandle).toBe('aanya')
  })

  it('reset clears back to idle', () => {
    useRepurposeStore.getState().start('conv1', 'u', 'h')
    useRepurposeStore.getState().reset()
    expect(useRepurposeStore.getState().status).toBe('idle')
    expect(useRepurposeStore.getState().conversationId).toBeNull()
  })

  it('isCleanRepurposeRun drops interrupted runs, keeps done runs', () => {
    expect(isCleanRepurposeRun({ status: 'rewriting' })).toBe(false)
    expect(isCleanRepurposeRun({ status: 'building-profile' })).toBe(false)
    expect(isCleanRepurposeRun({ status: 'done' })).toBe(true)
    expect(isCleanRepurposeRun({ status: 'error' })).toBe(true)
    expect(isCleanRepurposeRun({ status: 'idle' })).toBe(true)
  })
})
