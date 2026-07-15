import { describe, it, expect } from 'vitest'
import { pickHandlesToWarm, type DirectoryRow } from './warmSelector'

const row = (o: Partial<DirectoryRow>): DirectoryRow => ({
  id: o.handle ?? 'x', handle: o.handle ?? 'x', display_name: 'n',
  warm_attempts: o.warm_attempts ?? 0, warm_last_attempt_at: o.warm_last_attempt_at ?? null,
})
const NOW = Date.parse('2026-07-14T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

describe('pickHandlesToWarm', () => {
  it('excludes handles that already have a profile', () => {
    const rows = [row({ handle: 'a' }), row({ handle: 'b' })]
    expect(pickHandlesToWarm(rows, new Set(['a']), NOW, 5).map((r) => r.handle)).toEqual(['b'])
  })
  it('excludes handles at the attempt cap', () => {
    const rows = [row({ handle: 'a', warm_attempts: 5 }), row({ handle: 'b', warm_attempts: 4 })]
    expect(pickHandlesToWarm(rows, new Set(), NOW, 5).map((r) => r.handle)).toEqual(['b'])
  })
  it('excludes handles that failed within the 24h backoff', () => {
    const rows = [row({ handle: 'a', warm_last_attempt_at: hoursAgo(2) }), row({ handle: 'b', warm_last_attempt_at: hoursAgo(30) })]
    expect(pickHandlesToWarm(rows, new Set(), NOW, 5).map((r) => r.handle)).toEqual(['b'])
  })
  it('orders never-attempted first, then oldest attempt, and caps to limit', () => {
    const rows = [
      row({ handle: 'old', warm_last_attempt_at: hoursAgo(48) }),
      row({ handle: 'new' }), // never attempted
      row({ handle: 'older', warm_last_attempt_at: hoursAgo(72) }),
    ]
    expect(pickHandlesToWarm(rows, new Set(), NOW, 2).map((r) => r.handle)).toEqual(['new', 'older'])
  })
  it('dedupes the same handle across categories (distinct rows, one profile)', () => {
    // creator_directory PK is `${category}:${handle}` → same handle can be two rows.
    const rows: DirectoryRow[] = [
      { id: 'fashion:dup', handle: 'dup', display_name: 'n', warm_attempts: 0, warm_last_attempt_at: null },
      { id: 'beauty:dup', handle: 'dup', display_name: 'n', warm_attempts: 0, warm_last_attempt_at: null },
      { id: 'travel:other', handle: 'other', display_name: 'n', warm_attempts: 0, warm_last_attempt_at: null },
    ]
    const picked = pickHandlesToWarm(rows, new Set(), NOW, 2)
    expect(picked.map((r) => r.handle)).toEqual(['dup', 'other']) // 'dup' selected once, not twice
    expect(picked).toHaveLength(2)
  })
})
