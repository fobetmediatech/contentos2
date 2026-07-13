import { describe, it, expect } from 'vitest'
import { extractYoutubeTranscript } from './youtubeTranscript'

describe('extractYoutubeTranscript', () => {
  it('reads the spike-confirmed `text` field', () => {
    const rows = [{ videoId: 'x', videoTitle: 't', text: 'one small step for man' }]
    expect(extractYoutubeTranscript(rows)).toBe('one small step for man')
  })

  it('falls back to transcript/transcriptText fields', () => {
    expect(extractYoutubeTranscript([{ transcript: 'hi there' }])).toBe('hi there')
    expect(extractYoutubeTranscript([{ transcriptText: 'yo' }])).toBe('yo')
  })

  it('returns empty string when no usable text is present', () => {
    expect(extractYoutubeTranscript([{ videoId: 'x', text: '' }])).toBe('')
    expect(extractYoutubeTranscript([])).toBe('')
  })
})
