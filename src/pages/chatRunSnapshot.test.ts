import { describe, it, expect } from 'vitest'
import { runToMessage } from './chatRunSnapshot'

describe('runToMessage', () => {
  it('maps a done transcript run to a result message', () => {
    const msg = runToMessage({ id: 'run_1', kind: 'transcript', status: 'done', conversationId: 'c1', progress: '', targetLabel: 'r', startedAt: 0, result: { kind: 'transcript', reelUrl: 'u', transcript: 'hi', segments: [] } })
    expect(msg).toMatchObject({ role: 'assistant', type: 'result', result: { kind: 'transcript' } })
  })
  it('maps a failed run to an error message', () => {
    const msg = runToMessage({ id: 'run_2', kind: 'single-reel', status: 'failed', conversationId: 'c1', progress: '', targetLabel: 'r', startedAt: 0, error: 'boom' })
    expect(msg).toMatchObject({ role: 'assistant', type: 'error', content: 'boom' })
  })
})
