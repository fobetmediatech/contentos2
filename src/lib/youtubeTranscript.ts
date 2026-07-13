/**
 * YouTube transcript adapter — given ONE YouTube Short/video URL, returns its spoken
 * transcript as a single string via the Transcript-Ninja actor.
 *
 * Mirrors singleReelClient/reelVideoClient: routes through apifyCore (/api/apify proxy
 * picks the key), serialized on the shared apifyRunLimiter. Spike-confirmed: the dataset
 * item carries the transcript in `text`.
 */
import { startRun, pollRun, fetchDataset, ApifyError, apifyRunLimiter, withKeyFailover } from './apifyCore'
import { ACTORS, buildYoutubeTranscriptInput } from './actors'

// Captions fetch is fast (no video download) — a 2-minute idle budget is ample.
const YT_POLL_MS = 120_000

interface RawYtTranscriptItem {
  text?: string
  transcript?: string
  transcriptText?: string
}

/** Pure: pull the transcript string from the actor's dataset items. Exported for tests. */
export function extractYoutubeTranscript(rawItems: unknown[]): string {
  const items = rawItems as RawYtTranscriptItem[]
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    if (typeof it.text === 'string' && it.text.trim()) return it.text.trim()
    if (typeof it.transcript === 'string' && it.transcript.trim()) return it.transcript.trim()
    if (typeof it.transcriptText === 'string' && it.transcriptText.trim()) return it.transcriptText.trim()
  }
  return ''
}

/**
 * Resolve a YouTube URL to its transcript. Throws ApifyError when the run is blocked or
 * the video has no captions/transcript.
 *
 * @param url        A YouTube Short/video URL
 * @param apifyKeys  keysStore.apifyKeys (ignored by the proxy; kept for call-site parity)
 * @param signal     AbortSignal for cancellation
 */
export async function fetchYoutubeTranscript(
  url: string,
  apifyKeys: string[],
  signal?: AbortSignal,
): Promise<string> {
  return apifyRunLimiter(async () => {
    const input = buildYoutubeTranscriptInput(url)
    const raw = await withKeyFailover(apifyKeys, async (apiKey) => {
      const { runId, datasetId, keyIndex } = await startRun(ACTORS.YOUTUBE_TRANSCRIPT, input, apiKey, signal)
      await pollRun(runId, apiKey, signal, YT_POLL_MS, keyIndex)
      return fetchDataset<RawYtTranscriptItem>(datasetId, apiKey, signal, keyIndex)
    })
    const transcript = extractYoutubeTranscript(raw)
    if (!transcript) {
      throw new ApifyError('RUN_FAILED', 'No transcript available for that YouTube Short (no captions found)', 0)
    }
    return transcript
  })
}
