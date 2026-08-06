import { describe, it, expect } from 'vitest'
import { AI_SLOT_KEYS, DECK_SLOT_SCHEMA, pickSlots } from './deckSlots'
import { AI_SLOTS, SLOTS } from '../../src/lib/deckTemplate'

describe('slot key drift', () => {
  // These keys live in two places because the client module imports the .html via Vite `?raw` and
  // a serverless function cannot load it. Same guard as the cb_ column-drift test: a silent
  // divergence means a slot gets requested from the model but never rendered in the deck.
  it('the server list matches AI_SLOTS in the template module', () => {
    expect([...AI_SLOT_KEYS].sort()).toEqual([...AI_SLOTS].sort())
  })

  it('every AI slot is a real slot in the template', () => {
    for (const key of AI_SLOT_KEYS) expect(SLOTS).toHaveProperty(key)
  })

  it('the schema requires every key, so a partial response fails validation not rendering', () => {
    expect([...DECK_SLOT_SCHEMA.required].sort()).toEqual([...AI_SLOT_KEYS].sort())
  })
})

describe('pickSlots', () => {
  it('keeps usable values and collapses whitespace', () => {
    const r = pickSlots({ theGap: '  nobody   serves\nserious buyers ' })
    expect(r.slots.theGap).toBe('nobody serves serious buyers')
    expect(r.blank).not.toContain('theGap')
  })

  it('treats a missing or empty value as blank', () => {
    const r = pickSlots({ theGap: '   ' })
    expect(r.slots.theGap).toBeUndefined()
    expect(r.blank).toContain('theGap')
    expect(r.blank).toHaveLength(AI_SLOT_KEYS.length)
  })

  it('treats the literal string "null" as blank', () => {
    // A model told to return null frequently returns the word instead.
    expect(pickSlots({ theGap: 'null' }).blank).toContain('theGap')
    expect(pickSlots({ theGap: 'NULL' }).blank).toContain('theGap')
  })

  it('rejects an over-long value rather than breaking the inline layout', () => {
    const long = 'x'.repeat(300)
    expect(pickSlots({ proofLine: long }).blank).toContain('proofLine')
  })

  it('ignores unknown keys the model invents', () => {
    const r = pickSlots({ theGap: 'a real gap', somethingElse: 'ignored' })
    expect(Object.keys(r.slots)).toEqual(['theGap'])
  })

  it('survives malformed output', () => {
    expect(pickSlots(null).blank).toHaveLength(AI_SLOT_KEYS.length)
    expect(pickSlots('not an object').blank).toHaveLength(AI_SLOT_KEYS.length)
  })
})
