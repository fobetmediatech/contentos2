/**
 * Agent tool registry + validate/repair layer (Phase 1b T8).
 *
 * AGENT_TOOLS are the function declarations handed to callGeminiWithTools. When the
 * model returns a functionCall, useAgentConversation runs it through validateToolCall
 * BEFORE dispatching:
 *   - unknown tool name (hallucination) → { ok:false, reason:'unknown_tool' }
 *   - args fail the per-tool Zod schema  → { ok:false, reason:'invalid_args' }
 *   - valid                              → { ok:true, name, args } (parsed + normalized)
 *
 * On ok:false the loop feeds `detail` back to Gemini for ONE repair turn, then falls
 * back to ask_clarification. Pure module — no React, no network — so it's fully unit
 * tested here while the hook (T8) is integration-tested separately.
 *
 * Invariants mirror intentParser deliberately: competitor search needs a niche OR
 * handles; @handles are normalized (strip @, lowercase, ≤30 chars).
 */

import { z } from 'zod'
import type { GeminiFunctionDeclaration, GeminiToolResult, GeminiTurn } from '../ai/gemini'

export type AgentToolName =
  | 'ask_clarification'
  | 'discover_competitors'
  | 'discover_by_location'
  | 'analyze_reels'
  | 'answer_content'

export type ToolValidation =
  | { ok: true; name: AgentToolName; args: Record<string, unknown> }
  | { ok: false; reason: 'unknown_tool' | 'invalid_args'; detail: string }

/** The next thing the agent loop should do, derived from one Gemini tool result. */
export type AgentAction =
  | { type: 'message'; text: string }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'answer'; message: string }
  | { type: 'dispatch'; name: 'discover_competitors' | 'discover_by_location' | 'analyze_reels'; args: Record<string, unknown> }
  | { type: 'repair'; detail: string }

/**
 * Map one Gemini tool result to the agent loop's next action. Free text → render a
 * message; a valid tool call → ask / answer / dispatch; an invalid or hallucinated
 * call → repair (re-prompt the model once with the detail).
 */
export function decideAction(result: GeminiToolResult): AgentAction {
  if (result.kind === 'text') {
    return { type: 'message', text: result.text }
  }
  const v = validateToolCall(result.name, result.args)
  if (!v.ok) {
    return { type: 'repair', detail: v.detail }
  }
  if (v.name === 'ask_clarification') {
    const a = v.args as { question: string; options?: string[] }
    return {
      type: 'ask',
      question: String(a.question),
      ...(a.options && a.options.length > 0 ? { options: a.options } : {}),
    }
  }
  if (v.name === 'answer_content') {
    return { type: 'answer', message: String((v.args as { message: string }).message) }
  }
  return { type: 'dispatch', name: v.name, args: v.args }
}

/**
 * Run one agent turn: call the model, decide the action, and on an invalid/hallucinated
 * tool call re-prompt the model ONCE with the repair detail. If repairs are exhausted,
 * fall back to a clarifying question rather than loop forever. `callModel` is injected
 * (the hook passes a closure over callGeminiWithTools) so the repair loop is unit-tested.
 */
export async function runAgentTurn(
  history: GeminiTurn[],
  callModel: (history: GeminiTurn[], repairNote?: string) => Promise<GeminiToolResult>,
  opts?: { maxRepairs?: number },
): Promise<AgentAction> {
  const maxRepairs = opts?.maxRepairs ?? 1
  let action = decideAction(await callModel(history))
  let repairs = 0
  while (action.type === 'repair' && repairs < maxRepairs) {
    repairs++
    action = decideAction(await callModel(history, action.detail))
  }
  if (action.type === 'repair') {
    return { type: 'ask', question: "I didn't catch which creators or niche to look at — can you say it another way?" }
  }
  return action
}

/** Minimal shape buildGeminiHistory needs — ChatMessage is structurally assignable. */
export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
  type?: string
}

/**
 * Assemble the windowed Gemini `contents` from the chat transcript.
 *
 * Drops error/empty messages, windows to the last `window` messages, and maps role.
 * Pure + exported so the turn-structure invariants are unit-tested (the hook's inline
 * version couldn't be, which is how the consecutive-user-turn contamination shipped).
 */
export function buildGeminiHistory(messages: HistoryMessage[], window: number): GeminiTurn[] {
  const mapped = messages
    .filter((m) => m.type !== 'error' && m.content)
    .slice(-window)
    .map((m): GeminiTurn => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }))
  // Collapse consecutive same-role turns, keeping the LATEST of each run, so contents
  // strictly alternate. A filtered-out error between two user messages otherwise left two
  // adjacent user turns, which Gemini conflated — bleeding the prior (failed) search's
  // handle + niche into the new request ("@nike.training" + "ai" → "@nike.trainingai").
  // Keeping the latest drops the stale request; the live message stands alone.
  const turns: GeminiTurn[] = []
  for (const t of mapped) {
    const prev = turns[turns.length - 1]
    if (prev && prev.role === t.role) turns[turns.length - 1] = t
    else turns.push(t)
  }
  // Drop leading model turns so contents starts with a user turn (the API requires it).
  while (turns.length > 0 && turns[0].role === 'model') turns.shift()
  return turns
}

/** Normalize a handle list: strip @, lowercase, trim, drop empties + over-length. */
const normalizeHandles = (arr: string[] | null | undefined): string[] =>
  (arr ?? [])
    .map((h) => h.replace(/^@/, '').toLowerCase().trim())
    .filter((h) => h.length > 0 && h.length <= 30)

// Per-tool argument schemas. safeParse failures become the repair `detail`.
const argSchemas: Record<AgentToolName, z.ZodTypeAny> = {
  ask_clarification: z.object({
    question: z.string().min(1),
    // 2-4 tappable answer chips (TD1). Trim, drop empties, cap at 4 so the UI stays clean.
    options: z
      .array(z.string())
      .nullish()
      .transform((a) => (a ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4)),
  }),

  discover_competitors: z
    .object({
      niche: z.string().nullish().transform((s) => (s ?? '').trim()),
      knownHandles: z.array(z.string()).nullish().transform(normalizeHandles),
      segment: z.enum(['micro', 'macro', 'business', 'all']).nullish().transform((s) => s ?? 'all'),
    })
    // niche OR handles — an empty competitor search would scrape garbage.
    .refine((d) => d.niche.length > 0 || d.knownHandles.length > 0, {
      message: 'a competitor search needs a niche or at least one handle',
      path: ['niche'],
    }),

  discover_by_location: z.object({
    niche: z.string().min(1),
    city: z.string().min(1),
    depth: z.enum(['standard', 'deep']).nullish().transform((s) => s ?? 'standard'),
  }),

  analyze_reels: z
    .object({
      handles: z.array(z.string()).transform(normalizeHandles),
    })
    .refine((d) => d.handles.length > 0, { message: 'at least one @handle is required', path: ['handles'] }),

  answer_content: z.object({
    message: z.string().min(1),
  }),
}

/**
 * Validate a model-emitted tool call. Returns a typed dispatch on success, or a
 * repair signal (with a human-readable `detail`) the agent loop can feed back.
 */
export function validateToolCall(name: string, args: Record<string, unknown>): ToolValidation {
  if (!Object.prototype.hasOwnProperty.call(argSchemas, name)) {
    return {
      ok: false,
      reason: 'unknown_tool',
      detail: `Unknown tool "${name}". Valid tools: ${Object.keys(argSchemas).join(', ')}.`,
    }
  }
  const result = argSchemas[name as AgentToolName].safeParse(args ?? {})
  if (!result.success) {
    return {
      ok: false,
      reason: 'invalid_args',
      detail: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    }
  }
  return { ok: true, name: name as AgentToolName, args: result.data as Record<string, unknown> }
}

/** System instruction that drives ask-vs-act + tool routing (mirrors intentParser rules). */
export const AGENT_SYSTEM_PROMPT = `You are the research agent for Content OS, an Instagram creator-research tool for Indian creators, social-media managers, and brand marketers. Each turn, either CALL exactly one tool or ASK one short clarifying question — never both.

Routing:
- ask_clarification: ONLY when you genuinely cannot tell WHICH creators to find (a vague niche like "good accounts", "the best ones"). ALWAYS include 2-4 short tappable options (the likely answers, each ≤3 words) so the user can reply in one tap. Do NOT ask when the niche is specific or @handles are named.
- discover_competitors: find the top accounts in a niche regardless of location, or accounts similar to named @handles. "top X in <city>" / "best X in <city>" is competitor (the city is a filter).
- discover_by_location: ONLY when the goal is explicitly geographic ("creators based in <city>", "local <niche> in <city>").
- analyze_reels: break down the hook patterns of specific named @handles.
- answer_content: content/strategy/how-to questions or generating content (hooks, captions, ideas) — no scraping.

Prefer acting when confident; ask only when genuinely ambiguous. When @handles are present, always resolve — never ask for a niche.`

/** Function declarations passed to callGeminiWithTools. Descriptions guide routing. */
export const AGENT_TOOLS: GeminiFunctionDeclaration[] = [
  {
    name: 'ask_clarification',
    description:
      'Ask the user ONE short, specific question when their request is too ambiguous to act on (e.g. a vague niche like "good accounts"). Name 2-3 concrete directions so they can answer in a tap. Use ONLY when you genuinely cannot tell what to search.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The clarifying question to show the user.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2-4 short, tappable answer options (the likely answers, each ≤3 words) so the user can reply in one tap.',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'discover_competitors',
    description:
      'Find the top accounts succeeding in a niche, regardless of location. Use when the user wants competitors/leaders in a space, or names reference @handles to find similar accounts. "top X in <city>" is competitor (city is a filter), not discovery.',
    parameters: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'Creator niche, e.g. "vegan food creators". Optional if handles are given.' },
        knownHandles: { type: 'array', items: { type: 'string' }, description: 'Reference @handles to find similar accounts.' },
        segment: { type: 'string', enum: ['micro', 'macro', 'business', 'all'], description: 'Follower-size segment.' },
      },
    },
  },
  {
    name: 'discover_by_location',
    description:
      'Find creators physically based in a specific city. Use ONLY when the goal is explicitly geographic ("creators based in Pune", "local food bloggers in Mumbai").',
    parameters: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'Creator niche to find in the city.' },
        city: { type: 'string', description: 'The city to search within.' },
        depth: { type: 'string', enum: ['standard', 'deep'] },
      },
      required: ['niche', 'city'],
    },
  },
  {
    name: 'analyze_reels',
    description:
      'Break down the hook patterns in recent reels of specific named creators. Requires at least one @handle.',
    parameters: {
      type: 'object',
      properties: { handles: { type: 'array', items: { type: 'string' }, description: 'The creator @handles to analyze.' } },
      required: ['handles'],
    },
  },
  {
    name: 'answer_content',
    description:
      'Answer a content/strategy/how-to question or generate content (hooks, captions, ideas, scripts) — no scraping. Use when the user wants advice or content, not account research ("how do I go viral", "write 5 hooks").',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: "The user's content/strategy request." } },
      required: ['message'],
    },
  },
]
