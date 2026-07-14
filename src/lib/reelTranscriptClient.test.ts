import { describe, it, expect } from 'vitest'
import { parseTranscriptResponse } from './reelTranscriptClient'

describe('parseTranscriptResponse', () => {
  it('extracts result.transcript', () => {
    expect(parseTranscriptResponse({ shortCode: 'x', result: { transcript: 'hello world', segments: [] } })).toBe('hello world')
  })
  it('returns null when transcript is missing or not a string', () => {
    expect(parseTranscriptResponse({ shortCode: 'x', result: {} })).toBeNull()
    expect(parseTranscriptResponse({ result: { transcript: 42 } })).toBeNull()
    expect(parseTranscriptResponse({})).toBeNull()
    expect(parseTranscriptResponse(null)).toBeNull()
  })
})
