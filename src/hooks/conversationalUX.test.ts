/**
 * conversationalUX — unit tests for the pure confirming-state helpers.
 *
 * Both functions are module-level exports from useConversation.ts.
 * Testing them directly requires no React/jsdom setup.
 *
 * Covers:
 *   detectPipelineSwitch
 *     1. Competitor → discovery switch triggers
 *     2. Discovery → competitor switch triggers
 *     3. Generic confirmations do NOT trigger a switch
 *     4. Unknown pipeline always returns false
 *
 *   heuristicConfirmMatch
 *     5. Generic affirmatives map to options[0]
 *     6. "micro" keywords map to micro option
 *     7. "macro" keywords map to macro option
 *     8. "business/brand/company" keywords map to biz option
 *     9. Redirect keyword maps to the DISCOVERY_REDIRECT_TO_COMPETITOR option
 *    10. CRITICAL ORDER: "I'm fine with micro" → micro (not options[0])
 *    11. CRITICAL ORDER: "start with micro" → micro (not options[0])
 *    12. Unknown text returns null (falls through to Gemini)
 *    13. Empty options list returns null
 */

import { describe, it, expect } from 'vitest'
import { detectPipelineSwitch, heuristicConfirmMatch } from './useConversation'
import { PROCEED_LABEL, DISCOVERY_REDIRECT_TO_COMPETITOR } from '../lib/constants'

// ── Shared fixtures ───────────────────────────────────────────────────────────

const COMPETITOR_OPTIONS = [
  PROCEED_LABEL,
  'Micro-influencers (under 100K followers)',
  'Macro creators (100K+ followers)',
  'Include businesses and brands',
]

const DISCOVERY_OPTIONS = [
  PROCEED_LABEL,
  DISCOVERY_REDIRECT_TO_COMPETITOR,
]

// ── detectPipelineSwitch ──────────────────────────────────────────────────────

describe('detectPipelineSwitch', () => {
  describe('competitor → discovery', () => {
    it.each([
      'find local food creators',
      'I want creators based in Mumbai',
      'show creators located in Delhi',
      'location discovery please',
      'I meant discovery not analysis',
    ])('detects switch for: "%s"', (text) => {
      expect(detectPipelineSwitch(text, 'competitor')).toBe(true)
    })

    it.each([
      'yes go ahead',
      'looks right, proceed',
      'micro-influencers please',
      'show me macro creators',
      'include brands and businesses',
      // Regression: broad `find.*creator` pattern was previously matching these
      'I want to find the right macro creator in this niche',
      'find the best creators for my brand',
    ])('does NOT trigger switch for: "%s"', (text) => {
      expect(detectPipelineSwitch(text, 'competitor')).toBe(false)
    })
  })

  describe('discovery → competitor', () => {
    it.each([
      'show me global competitor analysis',
      'who dominates this niche',
      'I want competitor research instead',
      'similar to @handle globally',
      'who is winning in this space',
    ])('detects switch for: "%s"', (text) => {
      expect(detectPipelineSwitch(text, 'discovery')).toBe(true)
    })

    it.each([
      'yes go ahead',
      'looks right, proceed',
      'start the search',
      // Regression: bare `\banalysis\b` was previously matching these
      'thanks for the analysis!',
      'I like what the analysis found',
    ])('does NOT trigger switch for: "%s"', (text) => {
      expect(detectPipelineSwitch(text, 'discovery')).toBe(false)
    })
  })

  it('returns false for unknown pipeline type', () => {
    expect(detectPipelineSwitch('some text', 'unknown-pipeline')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(detectPipelineSwitch('FIND LOCAL CREATORS', 'competitor')).toBe(true)
    expect(detectPipelineSwitch('GLOBAL COMPETITOR ANALYSIS', 'discovery')).toBe(true)
  })
})

// ── heuristicConfirmMatch ─────────────────────────────────────────────────────

describe('heuristicConfirmMatch', () => {
  describe('generic affirmatives map to options[0]', () => {
    it.each([
      'yes',
      'yes please',
      'go',
      'go ahead',
      'ok',
      'ok great',
      'sure',
      'proceed',
      'looks right',
      'looks right to me',
    ])('maps "%s" to options[0]', (text) => {
      expect(heuristicConfirmMatch(text, COMPETITOR_OPTIONS)).toBe(PROCEED_LABEL)
    })
  })

  describe('micro keywords', () => {
    it.each([
      'micro please',
      'I want micro-influencers',
      'small accounts only',
      'under 100k followers',
    ])('maps "%s" to the micro option', (text) => {
      expect(heuristicConfirmMatch(text, COMPETITOR_OPTIONS)).toBe('Micro-influencers (under 100K followers)')
    })
  })

  describe('macro keywords', () => {
    it.each([
      'macro creators',
      'large accounts',
      'big influencers',
      '100k+ followers only',
    ])('maps "%s" to the macro option', (text) => {
      expect(heuristicConfirmMatch(text, COMPETITOR_OPTIONS)).toBe('Macro creators (100K+ followers)')
    })
  })

  describe('business/brand keywords', () => {
    it.each([
      'include businesses',
      'brands too',
      'show companies as well',
    ])('maps "%s" to the business option', (text) => {
      expect(heuristicConfirmMatch(text, COMPETITOR_OPTIONS)).toBe('Include businesses and brands')
    })
  })

  describe('redirect keyword (discovery options)', () => {
    it.each([
      'show me competitors globally',
      'I want competitor analysis instead',
      'who dominates this niche',
      'global analysis please',
    ])('maps "%s" to DISCOVERY_REDIRECT_TO_COMPETITOR', (text) => {
      expect(heuristicConfirmMatch(text, DISCOVERY_OPTIONS)).toBe(DISCOVERY_REDIRECT_TO_COMPETITOR)
    })
  })

  describe('CRITICAL ORDER: specific > generic affirmative', () => {
    it('"I\'m fine with micro" → micro option (not PROCEED_LABEL)', () => {
      // "fine" is a generic affirmative — but "micro" is more specific
      expect(heuristicConfirmMatch("I'm fine with micro", COMPETITOR_OPTIONS))
        .toBe('Micro-influencers (under 100K followers)')
    })

    it('"start with micro" → micro option (not PROCEED_LABEL)', () => {
      // "start" is a generic affirmative — but "micro" is more specific
      expect(heuristicConfirmMatch('start with micro', COMPETITOR_OPTIONS))
        .toBe('Micro-influencers (under 100K followers)')
    })

    it('"ok go with brands" → business option (not PROCEED_LABEL)', () => {
      // "ok" + "go" are generic affirmatives — but "brands" is more specific
      expect(heuristicConfirmMatch('ok go with brands', COMPETITOR_OPTIONS))
        .toBe('Include businesses and brands')
    })
  })

  describe('fallthrough cases', () => {
    it('returns null for unrecognised text', () => {
      expect(heuristicConfirmMatch('something completely different', COMPETITOR_OPTIONS)).toBeNull()
    })

    it('returns null for empty options list', () => {
      expect(heuristicConfirmMatch('yes', [])).toBeNull()
    })

    it('returns null when no options match the keyword pattern', () => {
      // Only PROCEED_LABEL in options — no micro/macro/biz/redirect present
      expect(heuristicConfirmMatch('micro please', [PROCEED_LABEL])).toBeNull()
    })
  })

  it('is case-insensitive', () => {
    expect(heuristicConfirmMatch('MICRO PLEASE', COMPETITOR_OPTIONS))
      .toBe('Micro-influencers (under 100K followers)')
    expect(heuristicConfirmMatch('YES', COMPETITOR_OPTIONS)).toBe(PROCEED_LABEL)
  })
})
