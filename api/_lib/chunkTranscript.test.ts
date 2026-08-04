import { describe, it, expect } from 'vitest'
import { chunkTranscript, type TranscriptSentence } from './chunkTranscript'

const s = (speaker: string, text: string, start: number, end: number): TranscriptSentence => ({
  speaker_name: speaker,
  text,
  start_time: start,
  end_time: end,
})

describe('chunkTranscript', () => {
  it('returns nothing for empty or blank input', () => {
    expect(chunkTranscript([])).toEqual([])
    expect(chunkTranscript([{ text: '   ', speaker_name: 'A', start_time: 0 }])).toEqual([])
  })

  it('merges consecutive sentences from the same speaker into one turn', () => {
    const out = chunkTranscript([
      s('Aman', 'We did forty lakh.', 0, 2),
      s('Aman', 'Last quarter.', 2, 4),
      s('Vibhav', 'Across how many deals?', 4, 6),
    ])
    expect(out).toHaveLength(1)
    // One label per turn, not per sentence — two speakers means two labels.
    expect(out[0].text).toBe('Aman: We did forty lakh. Last quarter.\nVibhav: Across how many deals?')
  })

  it('keeps start/end seconds so citations stay clickable', () => {
    const out = chunkTranscript([s('Aman', 'Hello.', 13.68, 15.2), s('Vibhav', 'Hi.', 15.2, 16.0)])
    expect(out[0].startSec).toBe(13.68)
    expect(out[0].endSec).toBe(16.0)
  })

  it('labels the chunk with the dominant speaker by volume', () => {
    const out = chunkTranscript([
      s('Aman', 'A'.repeat(200), 0, 5),
      s('Vibhav', 'ok', 5, 6),
    ])
    expect(out[0].speaker).toBe('Aman')
  })

  it('splits across chunks and overlaps by a trailing turn', () => {
    const sentences = Array.from({ length: 10 }, (_, i) =>
      s(`Sp${i}`, `${i} ` + 'x'.repeat(90), i, i + 1),
    )
    const out = chunkTranscript(sentences, { maxChars: 300, overlapTurns: 1 })
    expect(out.length).toBeGreaterThan(1)

    // The last turn of chunk N must reappear at the head of chunk N+1.
    for (let i = 0; i < out.length - 1; i++) {
      const lastTurn = out[i].text.split('\n').at(-1)!
      expect(out[i + 1].text.split('\n')[0]).toBe(lastTurn)
    }
  })

  it('splits a single oversized turn instead of emitting one giant chunk', () => {
    const long = Array.from({ length: 12 }, (_, i) => s('Aman', `Sentence ${i} ` + 'y'.repeat(60), i, i + 1))
    const out = chunkTranscript(long, { maxChars: 200, overlapTurns: 0 })
    expect(out.length).toBeGreaterThan(1)
    // Nothing is cut mid-sentence: every sentence survives intact somewhere.
    const all = out.map((c) => c.text).join(' ')
    for (let i = 0; i < 12; i++) expect(all).toContain(`Sentence ${i}`)
  })

  it('terminates when the overlap alone would fill a chunk', () => {
    // Regression guard: carrying an oversized overlap forward could stall packing forever.
    const sentences = Array.from({ length: 6 }, (_, i) => s(`Sp${i}`, 'z'.repeat(150), i, i + 1))
    const out = chunkTranscript(sentences, { maxChars: 160, overlapTurns: 1 })
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThan(50) // would be unbounded if packing failed to advance
  })

  it('indexes chunks contiguously from zero', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => s('Aman', 'w'.repeat(80), i, i + 1))
    const out = chunkTranscript(sentences, { maxChars: 250 })
    expect(out.map((c) => c.index)).toEqual(out.map((_, i) => i))
  })
})
