import { describe, it, expect } from 'vitest'
import { ACTORS, buildYoutubeTranscriptInput } from './actors'

describe('YouTube transcript actor', () => {
  it('uses the ~-separated actor id', () => {
    expect(ACTORS.YOUTUBE_TRANSCRIPT).toBe('topaz_sharingan~Youtube-Transcript-Scraper-1')
  })

  it('builds the string-array startUrls input shape confirmed by the spike', () => {
    expect(buildYoutubeTranscriptInput('https://youtube.com/shorts/abc123')).toEqual({
      startUrls: ['https://youtube.com/shorts/abc123'],
      timestamps: false,
    })
  })
})
