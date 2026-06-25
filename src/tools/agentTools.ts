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
 * Architecture: each tool is a single record (description + parameters + Zod schema +
 * toAction). AGENT_TOOLS, validateToolCall dispatch, and the system prompt are all
 * derived from this registry so adding a new tool requires touching only one place.
 */

import { z } from 'zod'
import type { GeminiFunctionDeclaration, GeminiToolResult, GeminiTurn } from '../ai/gemini'
import { parseReelUrl } from '../lib/reelUrl'

export type AgentToolName =
  | 'ask_clarification'
  | 'discover_competitors'
  | 'discover_by_location'
  | 'analyze_reels'
  | 'analyze_single_reel'
  | 'repurpose_reel'
  | 'answer_content'

export type ToolValidation =
  | { ok: true; name: AgentToolName; args: Record<string, unknown> }
  | { ok: false; reason: 'unknown_tool' | 'invalid_args'; detail: string }

/** The next thing the agent loop should do, derived from one Gemini tool result. */
export type AgentAction =
  | { type: 'message'; text: string }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'answer'; message: string }
  | { type: 'dispatch'; name: 'discover_competitors' | 'discover_by_location' | 'analyze_reels' | 'analyze_single_reel' | 'repurpose_reel'; args: Record<string, unknown> }
  | { type: 'repair'; detail: string }

/** Normalize a handle list: strip @, lowercase, trim, drop empties + over-length. */
const normalizeHandles = (arr: string[] | null | undefined): string[] =>
  (arr ?? [])
    .map((h) => h.replace(/^@/, '').toLowerCase().trim())
    .filter((h) => h.length > 0 && h.length <= 30)

// ── Unified tool registry ────────────────────────────────────────────────────
//
// Each entry bundles: description, API parameters, Zod validation schema, and
// the toAction function. AGENT_TOOLS and validateToolCall are DERIVED from this
// record — adding a tool requires only one entry here.

interface ToolRecord {
  description: string
  parameters: GeminiFunctionDeclaration['parameters']
  schema: z.ZodTypeAny
  toAction: (args: Record<string, unknown>) => AgentAction
}

const TOOL_REGISTRY: Record<AgentToolName, ToolRecord> = {
  ask_clarification: {
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
    schema: z.object({
      question: z.string().min(1),
      options: z
        .array(z.string())
        .nullish()
        .transform((a) => (a ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4)),
    }),
    toAction: (args) => {
      const a = args as { question: string; options?: string[] }
      return {
        type: 'ask',
        question: String(a.question),
        ...(a.options && a.options.length > 0 ? { options: a.options } : {}),
      }
    },
  },

  discover_competitors: {
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
    schema: z
      .object({
        niche: z.string().nullish().transform((s) => (s ?? '').trim()),
        knownHandles: z.array(z.string()).nullish().transform(normalizeHandles),
        segment: z.enum(['micro', 'macro', 'business', 'all']).nullish().transform((s) => s ?? 'all'),
      })
      .refine((d) => d.niche.length > 0 || d.knownHandles.length > 0, {
        message: 'a competitor search needs a niche or at least one handle',
        path: ['niche'],
      }),
    toAction: (args) => ({ type: 'dispatch', name: 'discover_competitors', args }),
  },

  discover_by_location: {
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
    schema: z.object({
      niche: z.string().min(1),
      city: z.string().min(1),
      depth: z.enum(['standard', 'deep']).nullish().transform((s) => s ?? 'standard'),
    }),
    toAction: (args) => ({ type: 'dispatch', name: 'discover_by_location', args }),
  },

  analyze_reels: {
    description:
      'Break down the hook patterns in recent reels of specific named creators. Requires at least one @handle.',
    parameters: {
      type: 'object',
      properties: { handles: { type: 'array', items: { type: 'string' }, description: 'The creator @handles to analyze.' } },
      required: ['handles'],
    },
    schema: z
      .object({
        handles: z.array(z.string()).transform(normalizeHandles),
      })
      .refine((d) => d.handles.length > 0, { message: 'at least one @handle is required', path: ['handles'] }),
    toAction: (args) => ({ type: 'dispatch', name: 'analyze_reels', args }),
  },

  analyze_single_reel: {
    description:
      'Deep case-study analysis of ONE specific Instagram reel, given its URL (a /reel/, /reels/ or /p/ link). Returns the transcript plus a full hook/psychology breakdown. Use when the user pastes or names a single reel URL — NOT for analyzing a creator by @handle (use analyze_reels for that).',
    parameters: {
      type: 'object',
      properties: { reelUrl: { type: 'string', description: 'The full Instagram reel URL to analyze.' } },
      required: ['reelUrl'],
    },
    schema: z
      .object({ reelUrl: z.string().min(1) })
      .transform((d) => {
        const parsed = parseReelUrl(d.reelUrl)
        return parsed ? { reelUrl: parsed.canonicalUrl, shortCode: parsed.shortCode } : { reelUrl: '', shortCode: '' }
      })
      .refine((d) => d.shortCode.length > 0, { message: 'a valid Instagram reel URL is required', path: ['reelUrl'] }),
    toAction: (args) => ({ type: 'dispatch', name: 'analyze_single_reel', args }),
  },

  repurpose_reel: {
    description:
      'Repurpose/rewrite a specific viral reel (given its URL) into a CLIENT\'s voice/tone. Use when the user gives a reel URL AND a client to rewrite it for (an @handle, or pasted scripts). Produces a full script package in the client\'s voice. NOT for plain analysis (use analyze_single_reel) and NOT for finding creators.',
    parameters: {
      type: 'object',
      properties: {
        sourceReelUrl: { type: 'string', description: 'The viral reel URL to repurpose (a /reel/, /reels/ or /p/ link).' },
        clientHandle: { type: 'string', description: 'The client @handle whose voice to rewrite into. Omit only if the user pasted the client\'s scripts instead.' },
        pastedScripts: { type: 'array', items: { type: 'string' }, description: 'Optional: 2-3 of the client\'s existing scripts/captions, used when no @handle is given.' },
      },
      required: ['sourceReelUrl'],
    },
    schema: z
      .object({
        sourceReelUrl: z.string().min(1),
        clientHandle: z.string().optional(),
        pastedScripts: z.array(z.string()).optional(),
      })
      .transform((d) => {
        const parsed = parseReelUrl(d.sourceReelUrl)
        const clientHandle = d.clientHandle ? normalizeHandles([d.clientHandle])[0] : undefined
        return {
          sourceReelUrl: parsed ? parsed.canonicalUrl : '',
          shortCode: parsed ? parsed.shortCode : '',
          clientHandle,
          pastedScripts: d.pastedScripts ?? [],
        }
      })
      .refine((d) => d.shortCode.length > 0, { message: 'a valid Instagram reel URL is required', path: ['sourceReelUrl'] })
      .refine((d) => !!d.clientHandle || d.pastedScripts.length > 0, {
        message: 'a client @handle or pasted scripts are required', path: ['clientHandle'],
      }),
    toAction: (args) => ({ type: 'dispatch', name: 'repurpose_reel', args }),
  },

  answer_content: {
    description:
      'Answer a content/strategy/how-to question or generate content (hooks, captions, ideas, scripts) — no scraping. Use when the user wants advice or content, not account research ("how do I go viral", "write 5 hooks").',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: "The user's content/strategy request." } },
      required: ['message'],
    },
    schema: z.object({
      message: z.string().min(1),
    }),
    toAction: (args) => ({ type: 'answer', message: String((args as { message: string }).message) }),
  },
}

// ── Derived AGENT_TOOLS (function declarations for Gemini) ───────────────────

/** Function declarations passed to callGeminiWithTools. Descriptions guide routing. */
export const AGENT_TOOLS: GeminiFunctionDeclaration[] = (
  Object.entries(TOOL_REGISTRY) as [AgentToolName, ToolRecord][]
).map(([name, t]) => ({
  name,
  description: t.description,
  parameters: t.parameters,
}))

// ── Validation + dispatch ────────────────────────────────────────────────────

/**
 * Validate a model-emitted tool call. Returns a typed dispatch on success, or a
 * repair signal (with a human-readable `detail`) the agent loop can feed back.
 */
export function validateToolCall(name: string, args: Record<string, unknown>): ToolValidation {
  if (!Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name)) {
    return {
      ok: false,
      reason: 'unknown_tool',
      detail: `Unknown tool "${name}". Valid tools: ${Object.keys(TOOL_REGISTRY).join(', ')}.`,
    }
  }
  const result = TOOL_REGISTRY[name as AgentToolName].schema.safeParse(args ?? {})
  if (!result.success) {
    return {
      ok: false,
      reason: 'invalid_args',
      detail: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    }
  }
  return { ok: true, name: name as AgentToolName, args: result.data as Record<string, unknown> }
}

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
  return TOOL_REGISTRY[v.name].toAction(v.args)
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
  const filtered = messages
    .filter((m) => m.type !== 'error' && m.content)
    .slice(-window)

  // Collapse consecutive same-role turns so contents strictly alternates.
  // Exception: once a result message lands at the tail of `turns`, it is NEVER
  // replaced by a subsequent same-role turn. Result messages anchor research
  // context in history (e.g. a "Switched" steer bubble must not overwrite them).
  const turns: GeminiTurn[] = []
  let prevTurnWasResult = false

  for (const m of filtered) {
    const turn: GeminiTurn = { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }
    const isResult = m.type === 'result'
    const prev = turns[turns.length - 1]

    if (prev && prev.role === turn.role) {
      if (prevTurnWasResult) {
        // Preserve the result — drop this same-role turn instead.
      } else {
        // Normal collapse: keep the latest of consecutive same-role turns.
        turns[turns.length - 1] = turn
        prevTurnWasResult = isResult
      }
    } else {
      turns.push(turn)
      prevTurnWasResult = isResult
    }
  }

  // Drop leading model turns so contents starts with a user turn (the API requires it).
  while (turns.length > 0 && turns[0].role === 'model') turns.shift()
  return turns
}

/** System instruction that drives ask-vs-act + tool routing (mirrors intentParser rules). */
export const AGENT_SYSTEM_PROMPT = `You are the research agent for Content OS, an Instagram creator-research tool for Indian creators, social-media managers, and brand marketers. Each turn, either CALL exactly one tool or ASK one short clarifying question — never both.

Routing:
- ask_clarification: ONLY when you genuinely cannot tell WHICH creators to find (a vague niche like "good accounts", "the best ones"). ALWAYS include 2-4 short tappable options (the likely answers, each ≤3 words) so the user can reply in one tap. Do NOT ask when the niche is specific or @handles are named.
- discover_competitors: find the top accounts in a niche regardless of location, or accounts similar to named @handles. "top X in <city>" / "best X in <city>" is competitor (the city is a filter).
- discover_by_location: ONLY when the goal is explicitly geographic ("creators based in <city>", "local <niche> in <city>").
- analyze_reels: break down the hook patterns of specific named @handles.
- analyze_single_reel: deep-analyze ONE specific reel when the user gives a reel URL (a link containing /reel/, /reels/ or /p/). Returns its transcript + a hook/psychology case study. Use this (not analyze_reels) whenever a single reel link is present AND no client repurpose is requested.
- repurpose_reel: rewrite a specific viral reel into a CLIENT's voice. Use when the user gives a reel URL AND names a client to repurpose it for (an @handle, or pasted scripts). If a reel URL is present but NO client is named, ask which client (do NOT guess a handle).
- answer_content: content/strategy/how-to questions or generating content (hooks, captions, ideas) — no scraping.

Prefer acting when confident; ask only when genuinely ambiguous. When @handles are present, always resolve — never ask for a niche.`
