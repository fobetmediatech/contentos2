/**
 * Turn a follow-up into a standalone question BEFORE retrieval (SERVER-SIDE, ESM, self-contained).
 *
 * handleAsk retrieves on the question it is given. "and pricing?" embedded alone matches almost
 * nothing, because its subject lives in the previous turn — and the grounding guard then honestly
 * reports "nothing relevant", which reads as a broken bot rather than as a short question.
 *
 * The rewrite runs BEFORE planQuery, which is the whole point: a date established in turn 1 has to
 * survive into turn 2, or "and pricing?" silently widens from one meeting to every call.
 *
 *   turn 1  "what happened in the Oct 12 onboarding call"  -> metadata, Oct 12
 *   turn 2  "and pricing?"  -> "what did they say about pricing in the Oct 12 onboarding call"
 *
 * The pure parts are exported separately so they are unit-tested without a network call.
 */
import { geminiGenerateJson } from './geminiJson.js'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

/** The last `n` turns, oldest first. Enough to resolve a pronoun; not enough to drift. */
export const recentTurns = (history: Turn[], n = 4): Turn[] => history.slice(-n)

/** No prior turn means nothing to resolve against — so no model call and no cost. */
export const needsRewrite = (history: Turn[]): boolean => recentTurns(history).length > 0

const REWRITE_SCHEMA = {
  type: 'object',
  properties: { question: { type: 'string' } },
  required: ['question'],
} as const

const REWRITE_SYSTEM = `Rewrite the user's LATEST question into a standalone question that can be
understood with no conversation history.

RULES:
- Resolve pronouns and omitted subjects using the conversation.
- PRESERVE any meeting name, date or meeting type established earlier — that is the scope of the
  question, and dropping it silently widens the search to every call.
- If the latest question is already standalone, return it UNCHANGED.
- Do NOT answer the question. Do NOT add facts that are not in the conversation.
- Write in LATIN script only. Romanise any Hindi as Hinglish; never output Devanagari.`

/**
 * Returns the standalone question, or the original when there is no history, when the model returns
 * nothing usable, or when the call fails. A degraded retrieval beats a dead chat — and the grounding
 * guard downstream still prevents an ungrounded answer either way.
 */
export async function rewriteFollowup(
  question: string,
  history: Turn[],
  apiKey: string,
): Promise<string> {
  if (!needsRewrite(history)) return question

  const convo = recentTurns(history)
    .map((t) => `${t.role}: ${t.content}`)
    .join('\n')

  try {
    const out = (await geminiGenerateJson(
      `${REWRITE_SYSTEM}\n\nCONVERSATION:\n${convo}\n\nLATEST QUESTION: ${question}`,
      REWRITE_SCHEMA,
      apiKey,
    )) as { question?: unknown }
    const rewritten = typeof out?.question === 'string' ? out.question.trim() : ''
    return rewritten || question
  } catch {
    return question
  }
}
