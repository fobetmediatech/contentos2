import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickGeminiKey } from './geminiJson'

const ROOT = join(import.meta.dirname, '../..')

/**
 * GEMINI_API_KEY holds a COMMA-SEPARATED POOL of keys, not one key. Reading it raw and passing the
 * whole joined string to Gemini yields a 401 that looks exactly like a revoked key — which is how
 * it cost an afternoon. pickGeminiKey() is the only correct reader.
 */
describe('Gemini key usage', () => {
  it('pickGeminiKey splits the pool rather than returning it whole', () => {
    const prev = { key: process.env.GEMINI_API_KEY, keys: process.env.GEMINI_KEYS }
    try {
      process.env.GEMINI_API_KEY = 'aaa,bbb'
      process.env.GEMINI_KEYS = 'ccc'
      for (let i = 0; i < 25; i++) {
        expect(['aaa', 'bbb', 'ccc']).toContain(pickGeminiKey())
      }
    } finally {
      if (prev.key === undefined) delete process.env.GEMINI_API_KEY
      else process.env.GEMINI_API_KEY = prev.key
      if (prev.keys === undefined) delete process.env.GEMINI_KEYS
      else process.env.GEMINI_KEYS = prev.keys
    }
  })

  it('nothing passes the raw pool string as a key — it must be split first', () => {
    const dirs = ['api', join('api', '_lib')]
    const offenders: string[] = []

    for (const dir of dirs) {
      for (const file of readdirSync(join(ROOT, dir))) {
        if (!file.endsWith('.ts') || file.includes('.test.')) continue
        const src = readFileSync(join(ROOT, dir, file), 'utf8')
        // Strip comments so notes about this very bug do not trip its own guard.
        let code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        // Remove the legitimate idiom: several files implement their own pool splitter.
        code = code.replace(/String\(process\.env\.GEMINI_API_KEY[^)]*\)[^\n]*split\(','\)/g, '')
        if (/process\.env\.GEMINI_API_KEY/.test(code)) offenders.push(join(dir, file))
      }
    }

    expect(offenders, 'files using the comma-separated key pool as a single key').toEqual([])
  })
})
