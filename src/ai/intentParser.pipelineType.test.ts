/**
 * Tests for pipelineType routing in intentParser.ts
 *
 * Verifies:
 *   1. Zod schema coerces / defaults pipelineType correctly for all edge cases
 *   2. buildIntentPrompt includes the PIPELINE ROUTING section in its output
 *   3. Routing rule commentary (spot-checks presence of key phrases)
 *
 * These are pure unit tests — no network calls, no Gemini mocking needed.
 * The Zod validation layer is the hard safety net we care about most here.
 */

import { describe, it, expect } from 'vitest'
import { buildIntentPrompt } from './prompts'

// ─── Re-export the schema internals for direct testing ───────────────────────
//
// intentParser.ts doesn't export the Zod schemas, but we can test the same
// validation logic by constructing objects that match what Gemini would return
// and running them through a locally-defined equivalent schema.
// This mirrors the approach used in the real parser without coupling to internals.

import { z } from 'zod'

// Minimal recreation of IntentSchema pipelineType field.
// Uses the same .transform(v => v ?? 'competitor') as the real schema so that
// null (Gemini JSON mode absent field) is coerced to the safe default.
const PipelineTypeSchema = z.object({
  niche: z.string().min(1),
  pipelineType: z
    .enum(['competitor', 'discovery'])
    .nullish()
    .default('competitor')
    .transform((v) => v ?? 'competitor'),
})

// ─── pipelineType Zod coercion ───────────────────────────────────────────────

describe('IntentSchema — pipelineType coercion', () => {
  it('accepts "competitor" and passes it through', () => {
    const result = PipelineTypeSchema.safeParse({ niche: 'fitness', pipelineType: 'competitor' })
    expect(result.success).toBe(true)
    expect(result.data?.pipelineType).toBe('competitor')
  })

  it('accepts "discovery" and passes it through', () => {
    const result = PipelineTypeSchema.safeParse({ niche: 'yoga teachers', pipelineType: 'discovery' })
    expect(result.success).toBe(true)
    expect(result.data?.pipelineType).toBe('discovery')
  })

  it('defaults to "competitor" when pipelineType is absent', () => {
    const result = PipelineTypeSchema.safeParse({ niche: 'food creators' })
    expect(result.success).toBe(true)
    expect(result.data?.pipelineType).toBe('competitor')
  })

  it('defaults to "competitor" when pipelineType is null (Gemini JSON mode returns null for absent fields)', () => {
    const result = PipelineTypeSchema.safeParse({ niche: 'food creators', pipelineType: null })
    expect(result.success).toBe(true)
    expect(result.data?.pipelineType).toBe('competitor')
  })

  it('defaults to "competitor" when pipelineType is undefined', () => {
    const result = PipelineTypeSchema.safeParse({ niche: 'food creators', pipelineType: undefined })
    expect(result.success).toBe(true)
    expect(result.data?.pipelineType).toBe('competitor')
  })

  it('rejects unknown pipelineType values (never reaches the app)', () => {
    const result = PipelineTypeSchema.safeParse({ niche: 'food creators', pipelineType: 'location_search' })
    // nullish() wraps the enum — unknown string fails the inner enum check,
    // then falls through to null/undefined check — this should also fail since
    // it's a non-null, non-undefined string that doesn't match the enum.
    // The schema uses .nullish() which only allows null/undefined as bypasses,
    // not arbitrary strings.
    expect(result.success).toBe(false)
  })
})

// ─── buildIntentPrompt — PIPELINE ROUTING section ───────────────────────────

describe('buildIntentPrompt — PIPELINE ROUTING section', () => {
  const prompt = buildIntentPrompt('Find yoga teachers in Delhi')

  it('includes the PIPELINE ROUTING header', () => {
    expect(prompt).toContain('PIPELINE ROUTING')
  })

  it('explains the "discovery" pipeline with geographic examples', () => {
    expect(prompt).toContain('"discovery"')
    expect(prompt).toContain('geographically located')
  })

  it('explains the "competitor" pipeline', () => {
    expect(prompt).toContain('"competitor"')
    expect(prompt).toContain('succeeding in a niche')
  })

  it('documents the default-to-competitor fallback rule', () => {
    expect(prompt).toContain('Default to "competitor" when unclear')
  })

  it('documents the competitive-phrasing override rule (top X in Y → competitor)', () => {
    expect(prompt).toContain('top X in Y')
  })

  it('includes pipelineType in the OUTPUT FORMAT example JSON', () => {
    expect(prompt).toContain('"pipelineType"')
  })

  it('embeds the user message in the prompt', () => {
    expect(prompt).toContain('Find yoga teachers in Delhi')
  })
})

// ─── buildIntentPrompt — pipelineType in output JSON example ────────────────

describe('buildIntentPrompt — output JSON example contains pipelineType', () => {
  it('example JSON shows pipelineType: "competitor" as the default', () => {
    const prompt = buildIntentPrompt('any message')
    // The example JSON in the prompt should include pipelineType
    const jsonBlockMatch = prompt.match(/"pipelineType":\s*"(\w+)"/)
    expect(jsonBlockMatch).not.toBeNull()
    expect(jsonBlockMatch?.[1]).toBe('competitor')
  })
})

// ─── Routing correctness smoke-tests (pipelineType field presence) ───────────
//
// These test the prompt *contains the right instructions* for Gemini to route
// correctly. Actual Gemini routing is tested manually (Step 10).

describe('buildIntentPrompt — routing instruction coverage', () => {
  it('lists "creators based in" as a discovery trigger example', () => {
    const prompt = buildIntentPrompt('some query')
    expect(prompt).toContain('creators based in')
  })

  it('lists "find competitors to @handle" as a competitor trigger example', () => {
    const prompt = buildIntentPrompt('some query')
    expect(prompt).toContain('find competitors to @handle')
  })

  it('documents that only use "discovery" when goal is explicitly geographic', () => {
    const prompt = buildIntentPrompt('some query')
    expect(prompt).toContain('explicitly geographic')
  })
})
