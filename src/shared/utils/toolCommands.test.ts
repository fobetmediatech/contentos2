/**
 * toolCommands tests — the shared tool list + the slash-menu filter.
 * Pure functions, no DOM.
 */

import { describe, it, expect } from 'vitest'
import { CHAT_TOOL_COMMANDS, filterToolCommands } from './toolCommands'

describe('CHAT_TOOL_COMMANDS', () => {
  it('lists all six chat tools', () => {
    expect(CHAT_TOOL_COMMANDS).toHaveLength(6)
  })

  it('has non-empty id/label/hint/placeholder for every entry', () => {
    for (const c of CHAT_TOOL_COMMANDS) {
      expect(c.id.length).toBeGreaterThan(0)
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.hint.length).toBeGreaterThan(0)
      expect(c.placeholder.length).toBeGreaterThan(0)
    }
  })

  it('no longer carries the old prefilled fake accounts anywhere', () => {
    // The redesign removed fake example accounts. Generic guidance like
    // "@handle" is fine; specific fake accounts are the regression to prevent.
    const blob = JSON.stringify(
      CHAT_TOOL_COMMANDS.map((c) => ({ ...c, prompt: c.buildPrompt('X') })),
    ).toLowerCase()
    expect(blob).not.toContain('nike.training')
    expect(blob).not.toContain('garyvee')
  })

  it('buildPrompt wraps the user input into a routing phrase for every tool', () => {
    for (const c of CHAT_TOOL_COMMANDS) {
      const prompt = c.buildPrompt('MY_INPUT')
      expect(prompt).toContain('MY_INPUT')
      expect(prompt.length).toBeGreaterThan('MY_INPUT'.length)
    }
  })

  it('buildPrompt produces tool-appropriate routing language', () => {
    const byId = Object.fromEntries(CHAT_TOOL_COMMANDS.map((c) => [c.id, c]))
    expect(byId['discover_by_location'].buildPrompt('Mumbai food')).toMatch(/based in Mumbai food/i)
    expect(byId['get_reel_transcript'].buildPrompt('URL')).toMatch(/transcript only/i)
    expect(byId['analyze_single_reel'].buildPrompt('URL')).toMatch(/in depth/i)
  })

  it('ids match the agentTools dispatch names', () => {
    const ids = CHAT_TOOL_COMMANDS.map((c) => c.id).sort()
    expect(ids).toEqual(
      [
        'analyze_reels',
        'analyze_single_reel',
        'discover_by_location',
        'discover_competitors',
        'get_reel_transcript',
        'repurpose_reel',
      ].sort(),
    )
  })

  it('surfaces the two previously-hidden tools (the whole point of the feature)', () => {
    const ids = CHAT_TOOL_COMMANDS.map((c) => c.id)
    expect(ids).toContain('repurpose_reel')
    expect(ids).toContain('get_reel_transcript')
  })

  it('has no duplicate ids', () => {
    const ids = CHAT_TOOL_COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('filterToolCommands', () => {
  it('returns the full list for an empty query', () => {
    expect(filterToolCommands('')).toHaveLength(6)
  })

  it('returns the full list for a whitespace-only query', () => {
    expect(filterToolCommands('   ')).toHaveLength(6)
  })

  it('matches on the label, case-insensitively', () => {
    // "competitors" appears only in the "Find competitors" label.
    const res = filterToolCommands('COMPETITORS')
    expect(res.map((c) => c.id)).toEqual(['discover_competitors'])
  })

  it('matches on the hint', () => {
    const res = filterToolCommands('viral hook')
    expect(res.map((c) => c.id)).toContain('analyze_reels')
  })

  it('matches across label AND hint, so a shared word returns every relevant tool', () => {
    // "transcript" is in the get_reel_transcript id AND the analyze_single_reel
    // hint ("Full breakdown + transcript…") — both should surface.
    const ids = filterToolCommands('transcript').map((c) => c.id)
    expect(ids).toContain('get_reel_transcript')
    expect(ids).toContain('analyze_single_reel')
  })

  it('matches short intent words via the id ("reel")', () => {
    const ids = filterToolCommands('reel').map((c) => c.id)
    expect(ids).toContain('analyze_reels')
    expect(ids).toContain('analyze_single_reel')
    expect(ids).toContain('repurpose_reel')
    expect(ids).toContain('get_reel_transcript')
  })

  it('matches the unique label word "transcribe" to only the transcript tool', () => {
    expect(filterToolCommands('transcribe').map((c) => c.id)).toEqual(['get_reel_transcript'])
  })

  it('matches "location" to the discovery tool via its id', () => {
    expect(filterToolCommands('location').map((c) => c.id)).toEqual(['discover_by_location'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterToolCommands('zzzznope')).toEqual([])
  })

  it('does not mutate the source list', () => {
    filterToolCommands('reel')
    expect(CHAT_TOOL_COMMANDS).toHaveLength(6)
  })
})
