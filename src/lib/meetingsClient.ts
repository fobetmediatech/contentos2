/**
 * Fireflies meeting list + ingest, from the browser.
 *
 * Both hit /api/ingest-transcript, which is admin-gated server-side. Non-admins get 403, so the
 * page hides itself rather than showing an error.
 */
import { getClerkSessionToken } from './clerkToken'

export interface Meeting {
  externalId: string
  title: string | null
  meetingDateMs: number | null
  durationSec: number | null
  /** false = link-joined: no calendar event, so no attendee emails, so it can only be assigned by hand. */
  calendarSourced: boolean
  emailCount: number
}

async function post<T>(body: unknown): Promise<T> {
  const token = await getClerkSessionToken()
  const res = await fetch('/api/ingest-transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`ingest-transcript ${res.status}`)
  return res.json() as Promise<T>
}

export const listMeetings = (): Promise<{ transcripts: Meeting[] }> => post({ action: 'list' })

export const ingestMeeting = (externalId: string, clientId?: string) =>
  post<{ transcriptId: string; joinStatus: string; clientId: string | null; chunks: number }>({
    action: 'ingest',
    externalId,
    ...(clientId ? { clientId } : {}),
  })

/** ponytail: derived from the title, same rule the server uses. No separate source of truth. */
export function meetingType(title: string | null): 'onboarding' | 'strategy' | 'review' | 'sales' {
  const t = (title ?? '').toLowerCase()
  if (t.includes('onboard')) return 'onboarding'
  if (t.includes('strategy')) return 'strategy'
  if (t.includes('review')) return 'review'
  return 'sales'
}
