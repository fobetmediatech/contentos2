/**
 * QnA query planning (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Pure, so it is unit-tested directly.
 *
 * TWO RETRIEVAL PATHS, both needed. Building only semantic search is the common mistake, and it
 * makes date-specific questions return plausible garbage: "what happened in the Oct 12 onboarding
 * call" embedded and matched by similarity returns whatever chunks happen to *sound* like that
 * sentence, from any call, and the answer reads perfectly while being about the wrong meeting.
 *
 *   METADATA — "what happened in the Oct 12 onboarding call" -> fetch whole transcripts by
 *              client + date + meeting type. No embedding involved.
 *   SEMANTIC — "what did they say about budget"              -> vector search over chunks.
 *
 * A question can want both (a topic within a specific meeting), so the plan carries filters
 * alongside the mode rather than treating them as exclusive.
 */

export type AskMode = 'metadata' | 'semantic'
export type MeetingType = 'sales' | 'onboarding' | 'strategy' | 'review'

export interface QueryPlan {
  mode: AskMode
  meetingType: MeetingType | null
  /** UTC day boundaries when the question names a specific date. */
  dateFrom: string | null
  dateTo: string | null
}

const MEETING_WORDS: Array<[MeetingType, RegExp]> = [
  ['onboarding', /\bonboard(ing)?\b/i],
  ['sales', /\b(sales|discovery)\s+call\b/i],
  ['strategy', /\bstrategy\s+call\b/i],
  ['review', /\breview\s+call\b/i],
]

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/**
 * Recognise a specific calendar day. Deliberately narrow: only forms that name an unambiguous day.
 * Vague time language ("recently", "last month") is NOT treated as a date filter — silently
 * narrowing to a guessed range would drop relevant material with no visible sign.
 */
export function parseDate(q: string, year: number): { from: string; to: string } | null {
  // Match against real month names. A looser [a-z]{3,9} pattern matches any word, so "the 12 Oct"
  // binds "the" as the month and the day-first form never gets a chance.
  const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'
  const monthFirst = q.match(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'))
  const dayFirst = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\b`, 'i'))

  let month: number | undefined
  let day: number | undefined

  if (monthFirst) {
    month = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()]
    day = Number(monthFirst[2])
  } else if (dayFirst) {
    day = Number(dayFirst[1])
    month = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()]
  }

  // ISO: 2026-08-04
  const iso = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) {
    const from = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])))
    const to = new Date(from.getTime() + 86_400_000)
    return { from: from.toISOString(), to: to.toISOString() }
  }

  if (month === undefined || day === undefined || Number.isNaN(day) || day < 1 || day > 31) return null

  const from = new Date(Date.UTC(year, month, day))
  const to = new Date(from.getTime() + 86_400_000)
  return { from: from.toISOString(), to: to.toISOString() }
}

/**
 * Metadata mode is chosen when the question points at a MEETING rather than a topic — a specific
 * date, or "what happened in the X call". A topic word alongside those keeps it semantic, since the
 * user wants a part of that meeting rather than the whole thing.
 */
export function planQuery(question: string, now: Date): QueryPlan {
  const q = question.trim()

  const meetingType = MEETING_WORDS.find(([, re]) => re.test(q))?.[0] ?? null
  const date = parseDate(q, now.getUTCFullYear())

  // "what happened" / "what did we discuss" / "summarise" all ask for a whole meeting.
  const wholeMeeting = /\b(what happened|what did we (discuss|cover)|summar(ise|ize)|recap|walk me through)\b/i.test(q)

  const mode: AskMode = date !== null || (wholeMeeting && meetingType !== null) ? 'metadata' : 'semantic'

  return {
    mode,
    meetingType,
    dateFrom: date?.from ?? null,
    dateTo: date?.to ?? null,
  }
}

/**
 * Minimum cosine similarity for a chunk to count as relevant.
 *
 * Below this the honest answer is "nothing relevant found". A confident answer about a client that
 * came from nowhere is worse than no answer, and weak matches are exactly how that happens — the
 * model is handed marginally-related text and dutifully synthesises something plausible.
 */
export const MIN_SIMILARITY = 0.45

export interface RetrievedChunk {
  chunk_id: string
  chunk_text: string
  speaker: string | null
  start_sec: number | null
  similarity: number
  title: string | null
  meeting_date: string | null
  client_id: string | null
}

/** Keep only chunks clearing the bar. An empty result must stop the pipeline, not soften it. */
export const relevantChunks = (chunks: RetrievedChunk[]): RetrievedChunk[] =>
  chunks.filter((c) => typeof c.similarity === 'number' && c.similarity >= MIN_SIMILARITY)

/** What the USER selected, as opposed to what their question implies. */
export interface AskScope {
  clientId: string | null
  transcriptId: string | null
}

/**
 * Build the PostgREST filter fragment for the metadata path.
 *
 * An explicitly selected transcript WINS over the date and meeting type parsed out of the question
 * text: the transcriptId came from the user picking a row, the date came from a regex guess on a
 * sentence. Applying both lets "what happened on the 12th" filter itself to nothing while the user
 * is looking at the 5th's transcript — an empty result with no visible cause.
 */
export function metadataFilters(plan: QueryPlan, scope: AskScope): string {
  // Both ids come from the request body and, via the /ask?transcript= URL, from a user-editable
  // location — encode them so a value containing `&` cannot inject extra PostgREST parameters.
  if (scope.transcriptId) return `id=eq.${encodeURIComponent(scope.transcriptId)}`
  return [
    scope.clientId ? `client_id=eq.${encodeURIComponent(scope.clientId)}` : '',
    plan.meetingType ? `meeting_type=eq.${plan.meetingType}` : '',
    plan.dateFrom ? `meeting_date=gte.${plan.dateFrom}` : '',
    plan.dateTo ? `meeting_date=lt.${plan.dateTo}` : '',
  ]
    .filter(Boolean)
    .join('&')
}
