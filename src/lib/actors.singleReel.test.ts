import { describe, it, expect } from 'vitest'
import { buildSingleReelInput } from './actors'

describe('buildSingleReelInput', () => {
  it('passes the direct reel URL and requests the downloaded video', () => {
    const input = buildSingleReelInput('https://www.instagram.com/reel/ABC/')
    expect(input).toEqual({
      username: ['https://www.instagram.com/reel/ABC/'],
      includeDownloadedVideo: true,
    })
  })
})
