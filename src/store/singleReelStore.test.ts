import { describe, it, expect, beforeEach } from 'vitest'
import { useSingleReelStore } from './singleReelStore'

describe('singleReelStore', () => {
  beforeEach(() => useSingleReelStore.getState().reset())

  it('tracks a run lifecycle', () => {
    const s = useSingleReelStore.getState()
    s.startRun('ABC', 'https://www.instagram.com/reel/ABC/', 'conv-1')
    expect(useSingleReelStore.getState().status).toBe('running')
    expect(useSingleReelStore.getState().shortCode).toBe('ABC')
    expect(useSingleReelStore.getState().conversationId).toBe('conv-1')

    s.setResult({ transcript: 't', segments: [], videoAnalysis: {} as never, markdown: '# hi' })
    expect(useSingleReelStore.getState().status).toBe('done')
    expect(useSingleReelStore.getState().result?.markdown).toBe('# hi')
  })

  it('records errors', () => {
    useSingleReelStore.getState().setError('nope')
    expect(useSingleReelStore.getState().status).toBe('failed')
    expect(useSingleReelStore.getState().error).toBe('nope')
  })

  it('reset clears everything', () => {
    useSingleReelStore.getState().setError('x')
    useSingleReelStore.getState().reset()
    expect(useSingleReelStore.getState().status).toBe('idle')
    expect(useSingleReelStore.getState().result).toBeNull()
  })
})
