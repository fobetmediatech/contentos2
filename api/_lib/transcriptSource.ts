/**
 * Transcript sources (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Ingestion talks to this interface, never to a vendor directly, so adding or swapping a source is
 * a new file plus one line in the registry — not a rewrite of the ingest path.
 *
 * ON THE SECOND IMPLEMENTATION — deliberate deviation from the spec, flagged for review:
 * the spec asked for a `WhisperSource` backed by "Groq Whisper, already in the ContentOS stack".
 * It is NOT in the stack — there is no Groq client, no GROQ_API_KEY, and the only greppable
 * "whisper" hits are a CSS colour token and prose inside a prompt. Today's transcription path
 * (api/get-transcript.ts) is Gemini multimodal. Since Fireflies API access is now CONFIRMED
 * WORKING against real transcripts, a second source would be speculative, untested code for a
 * fallback nobody needs yet. The interface below is what makes it cheap to add later; a
 * Gemini-audio source implementing it would reuse the existing get-transcript machinery.
 */

import type { TranscriptSentence } from './chunkTranscript.js'

export type TranscriptSourceName = 'fireflies' | 'whisper' | 'manual'

/** Lightweight row for "which transcripts could I ingest?" — no bodies fetched. */
export interface TranscriptSummary {
  externalId: string
  title: string | null
  meetingDateMs: number | null
  durationSec: number | null
  /** Null means the meeting was link-joined: no calendar event, so no attendee list, so no emails. */
  calendarId: string | null
  participantEmails: string[]
}

export interface RawTranscript extends TranscriptSummary {
  sentences: TranscriptSentence[]
  fullText: string
}

export interface TranscriptSource {
  readonly name: TranscriptSourceName
  /** Enumerate ingestable transcripts. Optional — not every source can list (e.g. an audio file). */
  list?(limit: number): Promise<TranscriptSummary[]>
  /** Fetch one transcript by its source-native reference. Null when it does not exist. */
  fetch(ref: string): Promise<RawTranscript | null>
}

export class TranscriptSourceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'TranscriptSourceError'
    this.status = status
  }
}

// ---------------------------------------------------------------------------------------------
// Fireflies
// ---------------------------------------------------------------------------------------------

const FIREFLIES_ENDPOINT = 'https://api.fireflies.ai/graphql'

const LIST_QUERY = `
  query List($limit: Int) {
    transcripts(limit: $limit) {
      id title date duration calendar_id
      organizer_email participants
      meeting_attendees { email }
    }
  }
`

const FETCH_QUERY = `
  query Fetch($id: String!) {
    transcript(id: $id) {
      id title date duration calendar_id
      organizer_email participants
      meeting_attendees { email }
      sentences { speaker_name start_time end_time text }
    }
  }
`

interface FirefliesTranscript {
  id: string
  title?: string | null
  date?: number | string | null
  duration?: number | null
  calendar_id?: string | null
  organizer_email?: string | null
  participants?: unknown
  meeting_attendees?: Array<{ email?: string | null }> | null
  sentences?: TranscriptSentence[] | null
}

/** Every address on the meeting, lowercased and de-duped. Classification happens at join time. */
function collectEmails(t: FirefliesTranscript): string[] {
  const raw: unknown[] = [
    ...(t.meeting_attendees ?? []).map((a) => a?.email),
    ...(Array.isArray(t.participants) ? t.participants : [t.participants]),
    t.organizer_email,
  ]
  const seen = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const e = v.trim().toLowerCase()
    if (e.includes('@')) seen.add(e)
  }
  return [...seen]
}

/**
 * Fireflies reports duration in MINUTES (verified: 39.23 for a ~39-minute call), while the schema
 * stores duration_sec. Converting at the boundary keeps the unit mistake in exactly one place.
 */
const toDurationSec = (minutes: number | null | undefined): number | null =>
  typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round(minutes * 60) : null

const toSummary = (t: FirefliesTranscript): TranscriptSummary => ({
  externalId: t.id,
  title: t.title ?? null,
  meetingDateMs: t.date == null ? null : Number(t.date),
  durationSec: toDurationSec(t.duration),
  calendarId: t.calendar_id ?? null,
  participantEmails: collectEmails(t),
})

export function createFirefliesSource(apiKey: string): TranscriptSource {
  const call = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const res = await fetch(FIREFLIES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) {
      // Never echo the response body — it can carry the key back in an auth error.
      throw new TranscriptSourceError(`fireflies request failed (${res.status})`, res.status)
    }
    const body = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> }
    if (body.errors?.length) {
      throw new TranscriptSourceError(`fireflies: ${body.errors[0]?.message ?? 'query error'}`, 502)
    }
    return body.data as T
  }

  return {
    name: 'fireflies',

    async list(limit) {
      const data = await call<{ transcripts: FirefliesTranscript[] }>(LIST_QUERY, { limit })
      return (data?.transcripts ?? []).map(toSummary)
    },

    async fetch(ref) {
      const data = await call<{ transcript: FirefliesTranscript | null }>(FETCH_QUERY, { id: ref })
      const t = data?.transcript
      if (!t) return null

      const sentences = (t.sentences ?? []).filter((s) => (s?.text ?? '').trim().length > 0)
      return {
        ...toSummary(t),
        sentences,
        fullText: sentences
          .map((s) => (s.speaker_name ? `${s.speaker_name}: ${s.text}` : s.text))
          .join('\n'),
      }
    },
  }
}
