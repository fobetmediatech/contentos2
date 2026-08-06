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
  const res = await fetch('/api/clients', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // Surface what the server actually said. Collapsing every failure into one message hid a
    // missing FIREFLIES_API_KEY behind "could not reach Fireflies" — a different problem entirely.
    const detail = await res.json().catch(() => null) as { error?: string; detail?: string } | null
    throw new Error(detail?.detail ?? detail?.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const listMeetings = (): Promise<{ transcripts: Meeting[] }> => post({ action: 'list-meetings' })

export const ingestMeeting = (externalId: string, clientId?: string) =>
  post<{ transcriptId: string; joinStatus: string; clientId: string | null; chunks: number }>({
    action: 'ingest-meeting',
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

// ---------------------------------------------------------------------------------------------
// Context documents + extraction
// ---------------------------------------------------------------------------------------------

/** ponytail: base64 in the JSON body. Total cap is 4 MB (Vercel's request limit), enforced server-side. */
export async function fileToDoc(file: File): Promise<{ name: string; mimeType: string; data: string }> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  // Chunked so a large file doesn't blow the argument limit of String.fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return { name: file.name, mimeType: file.type, data: btoa(binary) }
}

export interface ExtractResult {
  fieldsWritten: number
  filled: number
  empty: number
  inferred: number
  droppedCitations: number
  documentsRead: number
}

export async function runExtraction(
  clientId: string,
  documents: Array<{ name: string; mimeType: string; data: string }>,
): Promise<ExtractResult> {
  const token = await getClerkSessionToken()
  const res = await fetch('/api/strategy-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: 'extract', clientId, documents }),
  })
  const json = (await res.json()) as ExtractResult & { error?: string; detail?: string }
  if (!res.ok) throw new Error(json.detail ?? json.error ?? `extract-brief ${res.status}`)
  return json
}

/** Ask the server to write the deck's AI slots. The brief is already client-side, so nothing is re-fetched. */
export async function fillDeckSlots(
  brief: unknown,
  doc: unknown,
): Promise<{ slots: Record<string, string>; blank: string[]; usedDoc: boolean }> {
  const token = await getClerkSessionToken()
  const res = await fetch('/api/strategy-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: 'deck-slots', brief, doc }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(detail?.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<{ slots: Record<string, string>; blank: string[]; usedDoc: boolean }>
}

/** Create a client. The email is optional but is what lets FUTURE calls auto-match. */
export const createClient = (displayName: string, email?: string) =>
  post<{ clientId: string; displayName: string }>({
    action: 'create',
    displayName,
    ...(email ? { sheet: { emails: [email] } } : {}),
  })
