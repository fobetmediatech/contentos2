/**
 * Deep reel analysis EVAL — golden set (real services, gated).
 *
 * Exercises the full client+server path on a small set of real reels and asserts the
 * output contract, including the transcription quality that decides open question D2:
 *   - talking-head reel  -> spokenHookVerbatim must be non-empty (Gemini transcribed speech)
 *   - visual/no-speech   -> may be empty (correct)
 * If Gemini transcribes the talking-head well, the Apify transcript add-on stays dropped.
 *
 * Repeatable: re-scrapes from PERMALINKS each run (reel URLs persist; the downloadedVideo
 * URLs they yield are fresh), so there's nothing to expire. Self-skips unless
 * RUN_DEEP_EVAL=1 AND keys are present, so normal CI never spends money here.
 *
 * Run:  RUN_DEEP_EVAL=1 npx vitest run api/deepReelAnalysis.eval.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { analyzeReelVideo } from './analyze-reel-video.js'
import { scrapeReelVideos } from '../src/lib/reelVideoClient.js'
import { HOOK_ARCHETYPES } from '../src/ai/prompts/reelAnalysis.js'

function loadEnvFile(): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no .env */
  }
  return env
}

const fileEnv = loadEnvFile()
const geminiKey = process.env.GEMINI_API_KEY || fileEnv.VITE_GEMINI_KEY
const apifyKeys = Array.from({ length: 10 }, (_, i) => fileEnv[`VITE_APIFY_KEY_${i + 1}`]).filter(Boolean)
const enabled = Boolean(process.env.RUN_DEEP_EVAL && geminiKey && apifyKeys.length)

const CASES = [
  { permalink: 'https://www.instagram.com/garyvee/reel/CzoSr0rsq8u/', expectSpeech: true, label: 'talking-head (garyvee)' },
  { permalink: 'https://www.instagram.com/reel/DXmki6lEirj/', expectSpeech: false, label: 'visual (zachking)' },
]

describe('deep reel analysis eval — golden set', () => {
  for (const c of CASES) {
    it.runIf(enabled)(
      `${c.label}: valid analysis + transcription contract`,
      async () => {
        const videos = await scrapeReelVideos([c.permalink], apifyKeys)
        const entry = [...videos.entries()][0]
        expect(entry, 'reel scrape should yield a downloadedVideo').toBeTruthy()
        const [shortCode, url] = entry as [string, string]

        const a = await analyzeReelVideo({ downloadedVideoUrl: url, shortCode, caption: '' }, geminiKey as string)

        expect(HOOK_ARCHETYPES).toContain(a.hookArchetype)
        expect(a.visualOpening.length).toBeGreaterThan(0)
        expect(a.hookScore).toBeGreaterThanOrEqual(1)
        expect(a.hookScore).toBeLessThanOrEqual(10)
        if (c.expectSpeech) {
          expect(a.spokenHookVerbatim.length, 'talking-head reel should transcribe speech (D2)').toBeGreaterThan(0)
        }
        console.log(
          `[eval ${c.label}] archetype="${a.hookArchetype}" score=${a.hookScore} spoken="${a.spokenHookVerbatim}"`,
        )
      },
      // Must exceed scrapeReelVideos' 240s poll budget + the Gemini call, or a slow
      // scrape kills the test before it can finish (or surface a clean scrape error).
      330_000,
    )
  }

  it.skipIf(enabled)('skipped (set RUN_DEEP_EVAL=1 + keys in .env to run the golden set)', () => {
    expect(true).toBe(true)
  })
})
