/**
 * Intent parser eval (T4/T11) — runs the golden set against the REAL Gemini intent
 * parser and scores "did it ask vs guess correctly?".
 *
 * Skips entirely unless GEMINI_EVAL_KEY is set, so normal `npm run test` stays green
 * and offline. Run it as a gate before shipping any intent-prompt change:
 *
 *   GEMINI_EVAL_KEY=your_key npx vitest run src/ai/__evals__/intent.eval.test.ts
 *
 * Reproducibility: parseIntent pins temperature 0.2 + thinkingBudget 0, so scoring is
 * stable across runs. Scoring is against an ALLOWED behavior (ask / dispatch:<pipeline>
 * / express-uncertainty), not an exact string, per the eng-review eval note.
 *
 * Two metrics matter beyond raw accuracy:
 *   - underAsk: 'ask' cases where it dispatched anyway  → the ORIGINAL bug (searches
 *     before it understands). Must stay at/near zero.
 *   - overAsk:  'dispatch' cases where it asked anyway   → the NEW regression the
 *     outside voice warned about (interrogating clear requests).
 */

import { describe, it, expect } from 'vitest'
import { parseIntent, type ParsedIntent } from '../intentParser'
import { GOLDEN_SET, type GoldenCase } from './intentGolden'

const KEY = process.env.GEMINI_EVAL_KEY

// Tunable floors. Loosen/tighten as the golden set grows with real examples.
const MIN_ACCURACY = 0.8
const MAX_UNDER_ASK = 1 // tolerance for LLM variance on pure 'ask' cases

type Judged = { c: GoldenCase; pass: boolean; got: string; kind: 'ok' | 'under-ask' | 'over-ask' | 'wrong-pipeline' }

function judge(c: GoldenCase, parsed: ParsedIntent): Judged {
  const asked = 'needsClarification' in parsed && parsed.needsClarification === true
  if (asked) {
    if (c.expect.kind === 'ask' || c.expect.kind === 'ask-or-confirm') return { c, pass: true, got: 'ask', kind: 'ok' }
    return { c, pass: false, got: 'ask', kind: 'over-ask' }
  }
  // Resolved (dispatch) branch — narrow to the resolved intent shape.
  const resolved = parsed as Extract<ParsedIntent, { needsClarification?: false | null | undefined }>
  const pipeline = resolved.pipelineType ?? 'competitor'
  const medium = resolved.routingConfidence === 'medium'
  const got = `dispatch:${pipeline}${medium ? '(medium)' : ''}`
  if (c.expect.kind === 'ask') return { c, pass: false, got, kind: 'under-ask' }
  if (c.expect.kind === 'dispatch') {
    return c.expect.pipeline === pipeline
      ? { c, pass: true, got, kind: 'ok' }
      : { c, pass: false, got, kind: 'wrong-pipeline' }
  }
  // ask-or-confirm: passing means it expressed uncertainty (medium) rather than a confident guess.
  return medium ? { c, pass: true, got, kind: 'ok' } : { c, pass: false, got, kind: 'wrong-pipeline' }
}

describe.skipIf(!KEY)('intent parser golden eval (needs GEMINI_EVAL_KEY)', () => {
  it(
    `scores ${GOLDEN_SET.length} cases; accuracy >= ${MIN_ACCURACY}, underAsk <= ${MAX_UNDER_ASK}`,
    async () => {
      const results: Judged[] = []
      for (const c of GOLDEN_SET) {
        const parsed = await parseIntent(KEY as string, c.message)
        results.push(judge(c, parsed))
      }

      const pass = results.filter((r) => r.pass).length
      const accuracy = pass / results.length
      const underAsk = results.filter((r) => r.kind === 'under-ask')
      const overAsk = results.filter((r) => r.kind === 'over-ask')
      const wrongPipe = results.filter((r) => r.kind === 'wrong-pipeline')

      // Human-readable report (eval output, not a chat message).
      const fmt = (r: Judged) => `  [${r.kind.toUpperCase()}] ${r.c.id}: "${r.c.message}" → got ${r.got}, expected ${JSON.stringify(r.c.expect)}`
      // eslint-disable-next-line no-console
      console.log(
        `\n=== INTENT GOLDEN EVAL ===\n` +
        `accuracy: ${(accuracy * 100).toFixed(1)}% (${pass}/${results.length})\n` +
        `underAsk (searched when it should ASK — the original bug): ${underAsk.length}\n` +
        `overAsk  (asked when request was clear — the new regression): ${overAsk.length}\n` +
        `wrongPipeline: ${wrongPipe.length}\n` +
        (results.some((r) => !r.pass) ? `\nFAILURES:\n${results.filter((r) => !r.pass).map(fmt).join('\n')}\n` : 'all pass\n'),
      )

      expect(accuracy, `accuracy ${(accuracy * 100).toFixed(1)}% below floor`).toBeGreaterThanOrEqual(MIN_ACCURACY)
      expect(underAsk.length, `underAsk (the original bug) too high: ${underAsk.map((r) => r.c.id).join(', ')}`).toBeLessThanOrEqual(MAX_UNDER_ASK)
    },
    180_000,
  )
})
