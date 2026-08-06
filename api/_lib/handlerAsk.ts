/**
 * POST /api/ask — admin-only. QnA over transcripts, per-client or across clients.
 *
 * TWO RETRIEVAL PATHS (see _lib/askQuery.ts for why both are required):
 *   metadata — "what happened in the Oct 12 onboarding call" -> whole transcripts by date/type
 *   semantic — "what did they say about margins"             -> vector search over chunks
 *
 * GROUNDING IS STRUCTURAL, NOT A PROMPT INSTRUCTION. If retrieval returns nothing clearing the
 * similarity threshold, this endpoint returns "nothing relevant found" and NEVER CALLS THE MODEL.
 * A confident answer about a client that came from nowhere is worse than no answer, and the surest
 * way to prevent one is to not give the model the opportunity. The prompt repeats the rule for the
 * remaining case where retrieval succeeded but the excerpts still do not contain the answer.
 *
 * AUTH: caller's token is forwarded to PostgREST, so admin-only RLS applies. cb_match_chunks is
 * SECURITY INVOKER for the same reason — it must not bypass those policies.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './auth.js'
import { embedTexts } from './embed.js'
import { geminiGenerateJson, pickGeminiKey } from './geminiJson.js'
import { planQuery, relevantChunks, MIN_SIMILARITY, type RetrievedChunk } from './askQuery.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

const bearer = (req: VercelRequest): string => {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

async function rest(
  path: string,
  token: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  let json: unknown = null
  try { json = await res.json() } catch { /* 204 */ }
  return { ok: res.ok, json }
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      nullable: true,
      description: 'The answer, grounded ONLY in the excerpts. null if they do not contain it.',
    },
    used_chunk_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer', 'used_chunk_ids'],
} as const

const SYSTEM = `You answer questions about client calls using ONLY the transcript excerpts provided.

RULES:
- If the excerpts do not contain the answer, return null for "answer". Do NOT fall back on general
  knowledge about the client's industry. A confident answer that came from nowhere is worse than
  admitting the transcripts do not cover it.
- Never invent numbers, dates, names or commitments. If a figure is not in an excerpt, it does not exist.
- List the chunk_id of every excerpt you actually used in "used_chunk_ids".
- Write in LATIN script only. Romanise any Hindi as Hinglish; never output Devanagari.
- Be brief. Quote the client's own words where they answer the question directly.`

const fmtTime = (s: number | null): string =>
  s === null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export async function handleAsk(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await requireClerkUser(req, res)
  if (!user) return
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const token = bearer(req)
  if ((await rest('rpc/is_admin', token, { method: 'POST', body: {} })).json !== true) {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  const body = req.body as { question?: unknown; clientId?: unknown } | undefined
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  const clientId = typeof body?.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : null
  if (!question) {
    res.status(400).json({ error: 'question required' })
    return
  }

  const plan = planQuery(question, new Date())

  try {
    let excerpts: RetrievedChunk[] = []
    let transcriptsRead = 0

    if (plan.mode === 'metadata') {
      // Whole transcripts by client + date + type. No embedding — a date question must not be
      // answered by whatever happens to sound similar.
      const filters = [
        clientId ? `client_id=eq.${clientId}` : '',
        plan.meetingType ? `meeting_type=eq.${plan.meetingType}` : '',
        plan.dateFrom ? `meeting_date=gte.${plan.dateFrom}` : '',
        plan.dateTo ? `meeting_date=lt.${plan.dateTo}` : '',
      ].filter(Boolean).join('&')

      const r = await rest(
        `cb_transcripts?select=id,title,meeting_date,client_id,full_text&${filters}&order=meeting_date.desc&limit=5`,
        token,
        { method: 'GET' },
      )
      const rows = Array.isArray(r.json)
        ? (r.json as Array<{ id: string; title: string | null; meeting_date: string | null; client_id: string | null; full_text: string | null }>)
        : []
      transcriptsRead = rows.length
      excerpts = rows.map((t) => ({
        chunk_id: t.id,
        chunk_text: (t.full_text ?? '').slice(0, 24_000),
        speaker: null,
        start_sec: null,
        similarity: 1, // exact metadata match, not a similarity score
        title: t.title,
        meeting_date: t.meeting_date,
        client_id: t.client_id,
      })).filter((e) => e.chunk_text.trim().length > 0)
    } else {
      const [queryVector] = await embedTexts([question], pickGeminiKey(), 'RETRIEVAL_QUERY')
      const r = await rest('rpc/cb_match_chunks', token, {
        method: 'POST',
        body: {
          query_embedding: `[${queryVector.join(',')}]`,
          match_count: 12,
          p_client_id: clientId,
          p_meeting_type: plan.meetingType,
        },
      })
      const rows = Array.isArray(r.json) ? (r.json as RetrievedChunk[]) : []
      excerpts = relevantChunks(rows)
      transcriptsRead = new Set(rows.map((c) => c.title)).size
    }

    // THE GUARD. Nothing relevant retrieved -> say so, without ever calling the model.
    if (excerpts.length === 0) {
      res.status(200).json({
        answer: null,
        reason: 'no_relevant_content',
        message:
          plan.mode === 'metadata'
            ? 'No transcript matches that meeting. It may not be ingested, or the date/type is different.'
            : `Nothing in the ingested transcripts is relevant to that question (nothing scored above ${MIN_SIMILARITY}).`,
        mode: plan.mode,
        citations: [],
      })
      return
    }

    const context = excerpts
      .map(
        (c) =>
          `[chunk_id: ${c.chunk_id}${c.title ? ` | meeting: ${c.title}` : ''}${c.start_sec != null ? ` | t=${fmtTime(c.start_sec)}` : ''}${c.speaker ? ` | speaker: ${c.speaker}` : ''}]\n${c.chunk_text}`,
      )
      .join('\n\n')

    const parsed = (await geminiGenerateJson(
      `${SYSTEM}\n\nQUESTION: ${question}\n\nEXCERPTS:\n\n${context}`,
      ANSWER_SCHEMA,
      pickGeminiKey(),
    )) as { answer?: string | null; used_chunk_ids?: string[] }

    const answer = typeof parsed?.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : null
    const used = new Set(Array.isArray(parsed?.used_chunk_ids) ? parsed.used_chunk_ids : [])

    res.status(200).json({
      answer,
      // Even with excerpts in hand the model may find they do not answer the question — that is a
      // legitimate outcome, reported rather than papered over.
      reason: answer === null ? 'not_covered_by_transcripts' : null,
      mode: plan.mode,
      transcriptsRead,
      citations: excerpts
        .filter((c) => used.has(c.chunk_id))
        .map((c) => ({
          chunkId: c.chunk_id,
          meeting: c.title,
          meetingDate: c.meeting_date,
          speaker: c.speaker,
          timestamp: fmtTime(c.start_sec),
          quote: c.chunk_text.slice(0, 400),
          similarity: c.similarity,
        })),
    })
  } catch {
    res.status(502).json({ error: 'ask_failed' })
  }
}
