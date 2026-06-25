/**
 * Agent router eval suite (Phase 4.1)
 *
 * Cost-gated: skipped unless VITE_GEMINI_API_KEY is set in the environment.
 * Run manually: VITE_GEMINI_API_KEY=... bun run test src/ai/agentLoop.eval.test.ts
 *
 * Each case has a turn history (simulating what a real chat looks like), the
 * expected AgentAction type, and optionally a specific dispatch name or keyword.
 */

import { describe, it, expect } from 'vitest'
import { runAgentTurn, buildGeminiHistory, AGENT_SYSTEM_PROMPT, AGENT_TOOLS } from '../tools/agentTools'
import type { AgentAction, HistoryMessage } from '../tools/agentTools'
import { callGeminiWithTools } from './gemini'
import type { GeminiTurn } from './gemini'

// ── Cost gate ─────────────────────────────────────────────────────────────────

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? ''
const RUN_EVALS = GEMINI_KEY.length > 0

// ── Live callModel factory ────────────────────────────────────────────────────

function makeCallModel(key: string) {
  return (history: GeminiTurn[], repairNote?: string): Promise<import('./gemini').GeminiToolResult> => {
    const augmented: GeminiTurn[] = repairNote
      ? [...history, { role: 'user', parts: [{ text: `[REPAIR HINT] ${repairNote}` }] }]
      : history
    return callGeminiWithTools(
      [key],
      augmented,
      AGENT_TOOLS,
      { systemInstruction: AGENT_SYSTEM_PROMPT },
    )
  }
}

// ── Golden cases ──────────────────────────────────────────────────────────────

interface EvalCase {
  label: string
  messages: HistoryMessage[]
  expect: {
    type: AgentAction['type']
    dispatchName?: 'discover_competitors' | 'discover_by_location' | 'analyze_reels' | 'analyze_single_reel' | 'repurpose_reel' | 'get_reel_transcript'
  }
}

const CASES: EvalCase[] = [
  // ── Competitor pipeline ────────────────────────────────────────────────────
  {
    label: 'competitor: named handle',
    messages: [{ role: 'user', content: 'Analyse competitors for @fittrackpro' }],
    expect: { type: 'dispatch', dispatchName: 'discover_competitors' },
  },
  {
    label: 'competitor: niche without location',
    messages: [{ role: 'user', content: 'Find the top fitness influencers in India' }],
    expect: { type: 'dispatch', dispatchName: 'discover_competitors' },
  },
  {
    label: 'competitor: city-filtered niche ("top X in city" is competitor, not location)',
    messages: [{ role: 'user', content: 'Best yoga accounts in Mumbai' }],
    expect: { type: 'dispatch', dispatchName: 'discover_competitors' },
  },
  {
    label: 'competitor: brands angle',
    messages: [{ role: 'user', content: 'Show me the top skincare brands on Instagram' }],
    expect: { type: 'dispatch', dispatchName: 'discover_competitors' },
  },
  {
    // Hybrid recall fix: a broad/comprehensive phrasing must still route to discover_competitors
    // (the eval can only assert routing — mode='broad' is a post-dispatch internal, unit-tested in
    // prompts.test.ts). Verifies the new `mode` param didn't change routing for a recall-first ask.
    label: 'competitor: broad/comprehensive recall phrasing',
    messages: [{ role: 'user', content: 'Give me a broad, comprehensive list of every productivity creator on Instagram' }],
    expect: { type: 'dispatch', dispatchName: 'discover_competitors' },
  },

  // ── Location discovery pipeline ────────────────────────────────────────────
  {
    label: 'location: explicit creator-based-in phrasing',
    messages: [{ role: 'user', content: 'Find food creators based in Bangalore' }],
    expect: { type: 'dispatch', dispatchName: 'discover_by_location' },
  },
  {
    label: 'location: local niche phrasing',
    messages: [{ role: 'user', content: 'Local fashion influencers in Delhi' }],
    expect: { type: 'dispatch', dispatchName: 'discover_by_location' },
  },

  // ── Reel analysis pipeline ─────────────────────────────────────────────────
  {
    label: 'reels: analyze named handle',
    messages: [{ role: 'user', content: 'Analyse the reels of @beerbiclep' }],
    expect: { type: 'dispatch', dispatchName: 'analyze_reels' },
  },
  {
    label: 'reels: hook patterns request',
    messages: [{ role: 'user', content: 'What hook patterns does @nikhilchadha use in his reels?' }],
    expect: { type: 'dispatch', dispatchName: 'analyze_reels' },
  },

  // ── Single-reel analysis pipeline ──────────────────────────────────────────
  {
    label: 'single-reel: pasted reel URL routes to analyze_single_reel',
    messages: [{ role: 'user', content: 'break down this reel https://www.instagram.com/reel/CxYz123/' }],
    expect: { type: 'dispatch', dispatchName: 'analyze_single_reel' },
  },
  {
    label: 'single-reel contrast: plain @handle reel-hook request stays analyze_reels (NOT single-reel)',
    messages: [{ role: 'user', content: 'Analyse the reels of @garyvee' }],
    expect: { type: 'dispatch', dispatchName: 'analyze_reels' },
  },

  // ── Repurpose Reel pipeline ────────────────────────────────────────────────
  {
    label: 'repurpose: url + client handle → dispatch',
    messages: [{ role: 'user', content: 'Repurpose https://www.instagram.com/reel/Cabc123/ for @aanya' }],
    expect: { type: 'dispatch', dispatchName: 'repurpose_reel' },
  },
  {
    label: 'repurpose: url with no client → ask, never guess a handle',
    messages: [{ role: 'user', content: 'Repurpose https://www.instagram.com/reel/Cabc123/' }],
    expect: { type: 'ask' },
  },

  // ── Transcript pipeline ────────────────────────────────────────────────────
  {
    label: 'transcript: explicit "provide transcript" with reel URL routes to get_reel_transcript',
    messages: [{ role: 'user', content: 'provide transcript for this reel https://www.instagram.com/reel/CxYz123/' }],
    expect: { type: 'dispatch', dispatchName: 'get_reel_transcript' },
  },
  {
    label: 'transcript: "transcribe this reel" routes to get_reel_transcript',
    messages: [{ role: 'user', content: 'transcribe this reel https://www.instagram.com/reel/CxYz123/' }],
    expect: { type: 'dispatch', dispatchName: 'get_reel_transcript' },
  },

  // ── Content / strategy (no scraping) ──────────────────────────────────────
  {
    label: 'content: hook writing request',
    messages: [{ role: 'user', content: 'Write 5 hook ideas for a fitness coach targeting beginners' }],
    expect: { type: 'answer' },
  },
  {
    label: 'content: caption strategy question',
    messages: [{ role: 'user', content: 'How long should Instagram captions be for a food brand?' }],
    expect: { type: 'answer' },
  },
  {
    label: 'content: general strategy advice',
    messages: [{ role: 'user', content: 'What posting frequency works best for growing a travel page?' }],
    expect: { type: 'answer' },
  },

  // ── Clarification ──────────────────────────────────────────────────────────
  {
    label: 'clarify: vague "good accounts"',
    messages: [{ role: 'user', content: 'Show me some good accounts' }],
    expect: { type: 'ask' },
  },
  {
    label: 'clarify: vague "the best ones"',
    messages: [{ role: 'user', content: 'Find me the best ones' }],
    expect: { type: 'ask' },
  },
]

// ── Test runner ───────────────────────────────────────────────────────────────

describe.skipIf(!RUN_EVALS)('agent router eval (live, cost-gated)', () => {
  const callModel = makeCallModel(GEMINI_KEY)

  for (const c of CASES) {
    it(c.label, async () => {
      const history = buildGeminiHistory(c.messages, 20)
      const action = await runAgentTurn(history, callModel)

      expect(action.type).toBe(c.expect.type)

      if (c.expect.dispatchName) {
        expect(action.type).toBe('dispatch')
        if (action.type === 'dispatch') {
          expect(action.name).toBe(c.expect.dispatchName)
        }
      }
    }, 30_000)
  }
})

// ── Offline sanity check (no API cost) ───────────────────────────────────────
// These verify that buildGeminiHistory + the pure shape plumbing work without a key.

describe('buildGeminiHistory (pure, no API)', () => {
  it('maps user → user, assistant → model', () => {
    const msgs: HistoryMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]
    const turns = buildGeminiHistory(msgs, 20)
    expect(turns).toHaveLength(2)
    expect(turns[0].role).toBe('user')
    expect(turns[1].role).toBe('model')
  })

  it('drops leading model turns', () => {
    const msgs: HistoryMessage[] = [
      { role: 'assistant', content: 'Intro' },
      { role: 'user', content: 'Hi' },
    ]
    const turns = buildGeminiHistory(msgs, 20)
    expect(turns[0].role).toBe('user')
  })

  it('collapses consecutive same-role turns (keeps latest)', () => {
    const msgs: HistoryMessage[] = [
      { role: 'user', content: 'First' },
      { role: 'user', content: 'Second' },
    ]
    const turns = buildGeminiHistory(msgs, 20)
    expect(turns).toHaveLength(1)
    expect(turns[0].parts[0].text).toBe('Second')
  })

  it('preserves result turn even if same-role follows', () => {
    const msgs: HistoryMessage[] = [
      { role: 'user', content: 'Find competitors' },
      { role: 'assistant', content: 'Results payload', type: 'result' },
      { role: 'assistant', content: 'Follow-up model message' },
    ]
    const turns = buildGeminiHistory(msgs, 20)
    expect(turns[1].parts[0].text).toBe('Results payload')
  })

  it('respects the window cap', () => {
    const msgs: HistoryMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg${i}`,
    }))
    const turns = buildGeminiHistory(msgs, 10)
    expect(turns.length).toBeLessThanOrEqual(10)
  })

  it('drops error-type messages', () => {
    const msgs: HistoryMessage[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Oops', type: 'error' },
      { role: 'user', content: 'Try again' },
    ]
    const turns = buildGeminiHistory(msgs, 20)
    const texts = turns.map((t) => t.parts[0].text)
    expect(texts).not.toContain('Oops')
  })
})
