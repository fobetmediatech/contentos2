/**
 * Golden set for the intent parser — Phase 1a "ask before searching" eval (T4/T11).
 *
 * India-focused. Each case is a real-shaped chat message + the CORRECT behavior,
 * assigned strictly from the documented rules in prompts.ts (buildIntentPrompt):
 *   - ASK  (needsClarification=true)  when the creator target is vague/generic.
 *   - DISPATCH competitor             specific niche, or competitive "top X in Y" phrasing.
 *   - DISPATCH discovery              explicitly geographic ("based in", "located in", "local").
 *   - DISPATCH reel                   named @handles + reels/hooks/video language.
 *   - DISPATCH content                create/strategy (write hooks, ideas, how-to).
 *   - ASK-OR-CONFIRM                  genuinely ambiguous "X creators in <city>" — the parser
 *                                     should EITHER ask OR flag routingConfidence='medium'
 *                                     (the orchestrator then asks competitor-vs-local).
 *
 * SYNTHETIC_SEED is authored from the rules (objective, good for regression-catching).
 * YOUR_EXAMPLES is where the highest-signal data goes: paste the real messages where
 * the tool misread YOU, label what you meant. Those catch failures the seed can't predict.
 *
 * Run the eval (needs a real Gemini key, skips otherwise):
 *   GEMINI_EVAL_KEY=your_key npx vitest run src/ai/__evals__/intent.eval.test.ts
 */

export type ExpectedBehavior =
  | { kind: 'ask' }
  | { kind: 'dispatch'; pipeline: 'competitor' | 'discovery' | 'reel' | 'content' }
  | { kind: 'ask-or-confirm'; pipeline: 'competitor' | 'discovery' }

export interface GoldenCase {
  id: string
  message: string
  expect: ExpectedBehavior
  note?: string
}

// ── Synthetic seed (rule-derived, India-focused) ──────────────────────────────

export const SYNTHETIC_SEED: GoldenCase[] = [
  // ASK — vague / generic creator target (the core Phase-1a fix)
  { id: 'ask-vague-good', message: 'find me some good Indian accounts to look at', expect: { kind: 'ask' }, note: '"good accounts" — no niche' },
  { id: 'ask-best-creators', message: 'who are the best creators in India right now', expect: { kind: 'ask' }, note: 'no domain' },
  { id: 'ask-top-influencers', message: 'show me some top influencers to study', expect: { kind: 'ask' } },
  { id: 'ask-help-research', message: 'help me research some accounts for a client', expect: { kind: 'ask' }, note: 'no niche or city' },
  { id: 'ask-hinglish', message: 'yaar achhe creators dikhao', expect: { kind: 'ask' }, note: 'Hinglish, vague — ask not crash' },

  // DISPATCH competitor — specific niche, no city OR competitive phrasing
  { id: 'comp-street-food', message: 'top Indian street food creators', expect: { kind: 'dispatch', pipeline: 'competitor' } },
  { id: 'comp-skincare', message: "who's winning in Indian skincare right now", expect: { kind: 'dispatch', pipeline: 'competitor' } },
  { id: 'comp-bollywood-memes', message: 'best Bollywood meme pages', expect: { kind: 'dispatch', pipeline: 'competitor' } },
  { id: 'comp-handles', message: 'find competitors similar to @mumbai.foodie and @delhi.eats', expect: { kind: 'dispatch', pipeline: 'competitor' }, note: 'handles + "competitors similar"' },
  { id: 'comp-top-in-city', message: 'top fitness creators in Mumbai', expect: { kind: 'dispatch', pipeline: 'competitor' }, note: '"top X in Y" → competitor, city is a filter' },
  { id: 'comp-marathi-comedy', message: 'best Marathi comedy creators', expect: { kind: 'dispatch', pipeline: 'competitor' }, note: 'specific regional niche' },
  { id: 'comp-compare-brands', message: 'compare @zomato and @swiggyindia', expect: { kind: 'dispatch', pipeline: 'competitor' }, note: 'compare accounts, no reel language' },

  // DISPATCH discovery — explicitly geographic
  { id: 'disc-pune-food', message: 'find food bloggers based in Pune', expect: { kind: 'dispatch', pipeline: 'discovery' }, note: '"based in"' },
  { id: 'disc-rishikesh-yoga', message: 'yoga teachers physically located in Rishikesh', expect: { kind: 'dispatch', pipeline: 'discovery' } },
  { id: 'disc-jaipur-fashion', message: 'local fashion creators in Jaipur', expect: { kind: 'dispatch', pipeline: 'discovery' }, note: '"local"' },
  { id: 'disc-blr-startups', message: "who's posting about startups based out of Bangalore", expect: { kind: 'dispatch', pipeline: 'discovery' } },

  // ASK-OR-CONFIRM — genuinely ambiguous "X creators in <city>"
  { id: 'amb-hyd-fitness', message: 'fitness creators in Hyderabad', expect: { kind: 'ask-or-confirm', pipeline: 'competitor' }, note: 'based-there vs locals — medium' },
  { id: 'amb-chennai-cricket', message: 'cricket content creators in Chennai', expect: { kind: 'ask-or-confirm', pipeline: 'competitor' } },

  // DISPATCH reel — named handles + reels/hooks/video
  { id: 'reel-beerbiceps', message: 'break down @beerbiceps reel hooks', expect: { kind: 'dispatch', pipeline: 'reel' } },
  { id: 'reel-kushakapila', message: 'analyze the hooks @kushakapila uses in her reels', expect: { kind: 'dispatch', pipeline: 'reel' } },
  { id: 'reel-guruji', message: 'what makes @technicalguruji reels go viral', expect: { kind: 'dispatch', pipeline: 'reel' } },

  // DISPATCH content — create / strategy, no accounts to scrape
  { id: 'content-hooks', message: 'write me 5 hooks for an Indian street food reel', expect: { kind: 'dispatch', pipeline: 'content' } },
  { id: 'content-diwali', message: 'give me content ideas for a Diwali skincare campaign', expect: { kind: 'dispatch', pipeline: 'content' } },
  { id: 'content-howto', message: 'how do I make my reels blow up in India', expect: { kind: 'dispatch', pipeline: 'content' } },

  // Over-ask guards — specific enough to resolve; the parser must NOT ask here
  { id: 'guard-vegan', message: 'vegan food creators in India', expect: { kind: 'dispatch', pipeline: 'competitor' }, note: 'specific niche + country (not a city) → resolve, do NOT ask' },
  { id: 'guard-handle-only', message: 'similar to @nas.daily', expect: { kind: 'dispatch', pipeline: 'competitor' }, note: 'handle named → resolve, do NOT ask' },
]

// ── Your real examples (highest signal — fill these in as the tool misreads you) ──
// Paste the actual message you typed, then label the correct behavior. Example:
//   { id: 'real-1', message: '<what you actually typed>', expect: { kind: 'ask' }, note: 'I meant X' },
export const YOUR_EXAMPLES: GoldenCase[] = [
  // TODO: add ~15-20 real misread messages here.
]

export const GOLDEN_SET: GoldenCase[] = [...SYNTHETIC_SEED, ...YOUR_EXAMPLES]
