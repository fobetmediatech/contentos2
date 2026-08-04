/**
 * Transcript chunking (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Pure function: sentences → chunks. No I/O, so it is unit-tested directly.
 *
 * Two properties matter downstream and drive the whole design:
 *
 *  1. SPEAKER TURNS ARE PRESERVED. Consecutive sentences from one speaker merge into a turn, and
 *     chunks are packed at turn granularity. A chunk never starts mid-sentence from one speaker
 *     and finishes with another's reply half-quoted — a citation pulled from such a chunk would
 *     misattribute who said what, which is worse than having no citation.
 *
 *  2. start_sec/end_sec SURVIVE. They are what makes a citation clickable (jump to the moment in
 *     the recording), so they are carried from the first/last sentence of each chunk rather than
 *     recomputed.
 *
 * Chunks OVERLAP by a trailing turn so a statement split across a boundary is still retrievable
 * whole from one side of it.
 *
 * Speaker labels are rendered INTO the chunk text ("Name: said this") because the embedding and
 * any quote pulled from it should carry attribution, not just the words.
 */

export interface TranscriptSentence {
  speaker_name?: string | null
  start_time?: number | null
  end_time?: number | null
  text?: string | null
}

export interface TranscriptChunk {
  index: number
  text: string
  speaker: string | null
  startSec: number | null
  endSec: number | null
}

export interface ChunkOptions {
  /** Soft cap. A single turn longer than this is split; otherwise turns stay intact. */
  maxChars?: number
  /** Trailing turns repeated at the head of the next chunk. */
  overlapTurns?: number
}

const DEFAULT_MAX_CHARS = 1500
const DEFAULT_OVERLAP_TURNS = 1

interface Turn {
  speaker: string | null
  startSec: number | null
  endSec: number | null
  texts: string[]
}

const renderTurn = (t: Turn): string =>
  t.speaker ? `${t.speaker}: ${t.texts.join(' ')}` : t.texts.join(' ')

/** Merge consecutive sentences by the same speaker into turns, dropping empties. */
function toTurns(sentences: TranscriptSentence[]): Turn[] {
  const turns: Turn[] = []
  for (const s of sentences) {
    const text = (s?.text ?? '').trim()
    if (!text) continue
    const speaker = s?.speaker_name?.trim() || null
    const startSec = typeof s?.start_time === 'number' ? s.start_time : null
    const endSec = typeof s?.end_time === 'number' ? s.end_time : null

    const last = turns[turns.length - 1]
    if (last && last.speaker === speaker) {
      last.texts.push(text)
      if (endSec !== null) last.endSec = endSec
      // A turn's start is its first sentence's start; only backfill if it was missing.
      if (last.startSec === null) last.startSec = startSec
    } else {
      turns.push({ speaker, startSec, endSec, texts: [text] })
    }
  }
  return turns
}

/** Split one oversized turn into several, at sentence boundaries so nothing is cut mid-sentence. */
function splitTurn(turn: Turn, maxChars: number): Turn[] {
  const out: Turn[] = []
  let cur: string[] = []
  let curLen = 0
  for (const t of turn.texts) {
    // +1 for the joining space. A single sentence over the cap still goes in alone rather than
    // being chopped mid-word.
    if (cur.length && curLen + t.length + 1 > maxChars) {
      out.push({ ...turn, texts: cur })
      cur = []
      curLen = 0
    }
    cur.push(t)
    curLen += t.length + 1
  }
  if (cur.length) out.push({ ...turn, texts: cur })
  // Timing is only known for the whole turn, so only the first piece keeps the real start and the
  // last keeps the real end. Claiming precise timings for the middle would be invented precision.
  return out.map((piece, i) => ({
    ...piece,
    startSec: i === 0 ? turn.startSec : null,
    endSec: i === out.length - 1 ? turn.endSec : null,
  }))
}

export function chunkTranscript(
  sentences: TranscriptSentence[],
  options: ChunkOptions = {},
): TranscriptChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const overlapTurns = Math.max(0, options.overlapTurns ?? DEFAULT_OVERLAP_TURNS)

  if (!Array.isArray(sentences) || sentences.length === 0) return []

  // Expand any turn that alone blows the cap, so packing below never has to.
  const turns = toTurns(sentences).flatMap((t) =>
    renderTurn(t).length > maxChars ? splitTurn(t, maxChars) : [t],
  )
  if (turns.length === 0) return []

  const chunks: TranscriptChunk[] = []
  let cur: Turn[] = []
  let curChars = 0

  const flush = (): void => {
    if (cur.length === 0) return

    // The dominant speaker (by characters) labels the chunk; every speaker still appears inline.
    const bySpeaker = new Map<string, number>()
    for (const t of cur) {
      if (!t.speaker) continue
      bySpeaker.set(t.speaker, (bySpeaker.get(t.speaker) ?? 0) + t.texts.join(' ').length)
    }
    let speaker: string | null = null
    let best = -1
    for (const [name, chars] of bySpeaker) {
      if (chars > best) { best = chars; speaker = name }
    }

    const withStart = cur.find((t) => t.startSec !== null)
    const withEnd = [...cur].reverse().find((t) => t.endSec !== null)

    chunks.push({
      index: chunks.length,
      text: cur.map(renderTurn).join('\n'),
      speaker,
      startSec: withStart?.startSec ?? null,
      endSec: withEnd?.endSec ?? null,
    })
  }

  for (const turn of turns) {
    const len = renderTurn(turn).length + 1
    if (cur.length > 0 && curChars + len > maxChars) {
      flush()
      // Carry a trailing turn into the next chunk so a thought split across the boundary stays
      // retrievable whole. Dropped if the overlap alone would already fill the chunk — otherwise
      // packing could never make progress.
      const carry = overlapTurns > 0 ? cur.slice(-overlapTurns) : []
      const carryChars = carry.reduce((n, t) => n + renderTurn(t).length + 1, 0)
      cur = carryChars < maxChars ? carry : []
      curChars = carryChars < maxChars ? carryChars : 0
    }
    cur.push(turn)
    curChars += len
  }
  flush()

  return chunks
}
