/**
 * INTEGRATION test — hits REAL services (the Apify-hosted video + real Gemini).
 *
 * This is the T1 / P0-1 confirmation: the function core fetches a real public
 * `downloadedVideo` URL from a server context and runs the full Gemini multimodal
 * path end-to-end. Cost-gated: self-skips unless BOTH a Gemini key (.env) and
 * REEL_TEST_VIDEO_URL are present, so normal CI never spends money here.
 *
 * Run on demand:
 *   REEL_TEST_VIDEO_URL="https://api.apify.com/v2/key-value-stores/.../records/x.mp4" \
 *     npx vitest run api/analyze-reel-video.integration.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { analyzeReelVideo } from './analyze-reel-video.js'
import { HOOK_ARCHETYPES } from '../src/ai/prompts/reelAnalysis.js'

function geminiKeyFromEnvFile(): string | undefined {
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*VITE_GEMINI_KEY\s*=\s*(.*)$/)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no .env */
  }
  return undefined
}

const KEY = process.env.GEMINI_API_KEY || geminiKeyFromEnvFile()
const URL_UNDER_TEST = process.env.REEL_TEST_VIDEO_URL
const enabled = Boolean(KEY && URL_UNDER_TEST)

describe('analyzeReelVideo (integration, real services)', () => {
  it.runIf(enabled)(
    'fetches a real downloadedVideo URL and returns a grounded DeepReelAnalysis',
    async () => {
      const out = await analyzeReelVideo(
        { downloadedVideoUrl: URL_UNDER_TEST as string, shortCode: 'integration', caption: '' },
        KEY as string,
      )
      expect(HOOK_ARCHETYPES).toContain(out.hookArchetype)
      expect(out.visualOpening.length).toBeGreaterThan(0)
      expect(out.hookBreakdown.length).toBeGreaterThan(0)
      expect(out.hookScore).toBeGreaterThanOrEqual(1)
      expect(out.hookScore).toBeLessThanOrEqual(10)
      // Log the real output so the run is self-documenting.
      console.log('[integration] DeepReelAnalysis:', JSON.stringify(out, null, 2))
    },
    120_000,
  )

  it.skipIf(enabled)('skipped (set REEL_TEST_VIDEO_URL + a Gemini key to run)', () => {
    expect(true).toBe(true)
  })
})
