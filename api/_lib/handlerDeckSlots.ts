/**
 * POST /api/fill-deck — admin-only. Writes the 10 AI slots in the strategy deck.
 *
 * Takes the brief (and the generated strategy doc, when one exists) straight from the client and
 * returns slot values. No Supabase reads: the caller already holds everything this needs, so a
 * round trip to the database would buy nothing.
 *
 * This is SLOT FILLING, not deck generation. 11 of the deck's 16 sections are fixed FOBET
 * boilerplate and 11 of its 21 blanks come from the brief with no model involved. Nothing here
 * touches the 4-stage pipeline.
 *
 * Where a strategy doc is supplied the model is told to REUSE its language rather than re-derive
 * it — the client may already have seen those words, and the deck must not contradict the document
 * it accompanies.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './auth.js'
import { geminiGenerateJson, pickGeminiKey, GeminiJsonError } from './geminiJson.js'
import { DECK_SLOT_PROMPT, DECK_SLOT_SCHEMA, pickSlots } from './deckSlots.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

/** Only the doc fields that map onto a slot — sending the whole deck would be mostly noise. */
const DOC_KEYS = ['positioning', 'audienceInsight', 'competitiveSummary', 'currentMarketingFlaw'] as const

export async function handleDeckSlots(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await requireClerkUser(req, res)
  if (!user) return
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  // Signed-in is enough — this feature is open to the whole team (20260810000000).

  const body = req.body as { brief?: Record<string, unknown>; doc?: Record<string, unknown> } | undefined
  const brief = body?.brief
  if (!brief || typeof brief !== 'object') {
    res.status(400).json({ error: 'brief required' })
    return
  }

  const briefLines = [
    `Brand: ${brief.brandName ?? ''}`,
    `Niche: ${brief.primaryNiche ?? ''} / ${brief.subNiche ?? ''}`,
    `Offer: ${brief.offer ?? ''}`,
    `Audience: ${brief.audience ?? ''}`,
    `Dislikes: ${brief.dislikes ?? ''}`,
    `Off-limits: ${brief.offLimits ?? ''}`,
    `Competitors: ${Array.isArray(brief.competitors) ? brief.competitors.filter(Boolean).join(', ') : ''}`,
  ].join('\n')

  const docLines = body?.doc
    ? DOC_KEYS.map((k) => (body.doc?.[k] ? `${k}: ${String(body.doc[k])}` : '')).filter(Boolean).join('\n')
    : ''

  try {
    const raw = await geminiGenerateJson(
      `${DECK_SLOT_PROMPT}\n\nCLIENT BRIEF:\n${briefLines}` +
        (docLines ? `\n\nEXISTING STRATEGY DOCUMENT (reuse this language):\n${docLines}` : ''),
      DECK_SLOT_SCHEMA,
      pickGeminiKey(),
    )
    const { slots, blank } = pickSlots(raw)
    res.status(200).json({ slots, blank, usedDoc: Boolean(docLines) })
  } catch (err) {
    res.status(err instanceof GeminiJsonError ? 502 : 500).json({ error: 'fill_failed' })
  }
}
