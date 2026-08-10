import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../..')

/**
 * The transcript feature is open to every signed-in member (migration 20260810000000).
 *
 * This guard exists because opening it took two passes: the first grep searched for the literal
 * `rpc/is_admin`, and handlerIngest called a local `rpc('is_admin', ...)` helper instead. That one
 * survivor 403'd every non-admin while the other three layers were already open — a state where
 * the UI renders and the API refuses, which reads as broken rather than restricted.
 *
 * team-access.ts is deliberately excluded: granting the finance role IS admin-only and must stay so.
 */
const TRANSCRIPT_FILES = [
  'api/clients.ts',
  'api/strategy-ai.ts',
  'api/_lib/handlerIngest.ts',
  'api/_lib/handlerExtract.ts',
  'api/_lib/handlerAsk.ts',
  'api/_lib/handlerDeckSlots.ts',
]

describe('transcript feature access', () => {
  it('no transcript endpoint gates on is_admin', () => {
    const offenders = TRANSCRIPT_FILES.filter((f) => {
      const src = readFileSync(join(ROOT, f), 'utf8')
      // Strip comments so prose about the old gate does not trip its own guard.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      return /is_admin/.test(code)
    })
    expect(offenders, 'transcript endpoints still gating on admin').toEqual([])
  })

  it('no transcript endpoint returns 403 forbidden', () => {
    const offenders = TRANSCRIPT_FILES.filter((f) => {
      const src = readFileSync(join(ROOT, f), 'utf8')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      return /status\(403\)/.test(code)
    })
    expect(offenders, 'transcript endpoints still returning 403').toEqual([])
  })

  it('team-access.ts stays admin-only — this guard must not over-reach', () => {
    const src = readFileSync(join(ROOT, 'api/team-access.ts'), 'utf8')
    expect(src).toContain('is_admin')
    expect(src).toContain("status(403)")
  })
})
