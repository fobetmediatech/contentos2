/**
 * POST /api/strategy-ai — one endpoint, three actions.
 *
 * WHY MERGED: Vercel's Hobby plan caps a deployment at 12 Serverless Functions. Every file in
 * api/ is one; files under api/_lib/ are not. Adding five endpoints took the branch to 14 and the
 * deployment started failing at "Deploying outputs..." with a clean build — a limit, not a bug.
 * The handler bodies moved to _lib unchanged and this file dispatches to them.
 *
 *   extract     -> fill the brief from a client's transcripts (writes cb_extractions)
 *   deck-slots  -> write the deck's 10 AI slots (returns them; stores nothing)
 *   ask         -> QnA over the transcripts
 *   summary     -> plain printable minutes for one transcript (cached on cb_transcripts)
 *
 * Each handler does its own auth check via requireClerkUser — auth belongs with the thing it
 * protects, so a future action cannot skip it by forgetting to check here. That check confirms
 * identity, not role: since migration 20260810000000, cb_transcripts and the tables built on it are
 * readable by any signed-in member, not admin-only, with RLS as the real boundary.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleExtract } from './_lib/handlerExtract.js'
import { handleDeckSlots } from './_lib/handlerDeckSlots.js'
import { handleAsk } from './_lib/handlerAsk.js'
import { handleSummary } from './_lib/handlerSummary.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const action = typeof (req.body as { action?: unknown } | undefined)?.action === 'string'
    ? (req.body as { action: string }).action
    : ''

  switch (action) {
    case 'extract': return handleExtract(req, res)
    case 'deck-slots': return handleDeckSlots(req, res)
    case 'ask': return handleAsk(req, res)
    case 'summary': return handleSummary(req, res)
    default:
      res.status(400).json({ error: 'unknown action', allowed: ['extract', 'deck-slots', 'ask', 'summary'] })
  }
}
