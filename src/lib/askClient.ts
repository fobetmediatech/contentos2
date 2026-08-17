/**
 * Browser -> /api/strategy-ai?action=ask. QnA over ingested transcripts.
 *
 * `answer: null` is a LEGITIMATE RESPONSE, not an error: the server refuses to call the model when
 * retrieval finds nothing above the similarity threshold. Callers must render it as an answer, not
 * as a failure — the whole value of this feature is that it does not invent figures.
 */
import { getClerkSessionToken } from './clerkToken'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskCitation {
  chunkId: string
  meeting: string | null
  meetingDate: string | null
  speaker: string | null
  timestamp: string
  quote: string
  similarity: number
}

export interface AskResponse {
  answer: string | null
  reason: string | null
  message?: string
  mode: 'metadata' | 'semantic'
  transcriptsRead?: number
  /** The rewritten question, when a follow-up was resolved into something standalone. */
  interpretedAs: string | null
  citations: AskCitation[]
}

export async function askTranscripts(
  question: string,
  scope: { clientId?: string; transcriptId?: string },
  history: Turn[],
): Promise<AskResponse> {
  const token = await getClerkSessionToken()
  const res = await fetch('/api/strategy-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: 'ask', question, ...scope, history }),
  })
  // Surface what the server actually said — collapsing every failure into one string is what hid a
  // missing FIREFLIES_API_KEY behind "could not reach Fireflies".
  const json = (await res.json().catch(() => null)) as
    | (AskResponse & { error?: string; detail?: string })
    | null
  if (!res.ok) throw new Error(json?.detail ?? json?.error ?? `ask ${res.status}`)
  if (!json) throw new Error('ask returned no body')
  return json
}
