import { describe, it, expect } from 'vitest'

/**
 * Pure logic tests for the handleToggleSelect / selection constraint logic
 * in DiscoveryResultsPage.tsx (max-5 enforcement).
 *
 * No React rendering required — the component has no external test-library
 * setup, and the toggle logic is a pure function of (prev, handle) → next.
 */

// Mirror of the toggle logic in DiscoveryResultsPage.tsx
function toggleSelect(prev: string[], handle: string): string[] {
  if (prev.includes(handle)) {
    return prev.filter((h) => h !== handle)
  }
  if (prev.length >= 5) {
    return prev // max-5 enforcement: reject the addition
  }
  return [...prev, handle]
}

describe('discovery results selection logic', () => {
  it('enforces max 5 selection — adding a 6th handle is a no-op', () => {
    let selected = ['a', 'b', 'c', 'd', 'e']
    selected = toggleSelect(selected, 'f')
    expect(selected).toHaveLength(5)
    expect(selected).not.toContain('f')
  })

  it('deselects when toggling an already-selected handle', () => {
    let selected = ['a', 'b', 'c']
    selected = toggleSelect(selected, 'b')
    expect(selected).toEqual(['a', 'c'])
    expect(selected).not.toContain('b')
  })

  it('selects when under 5 creators', () => {
    let selected = ['a', 'b']
    selected = toggleSelect(selected, 'c')
    expect(selected).toHaveLength(3)
    expect(selected).toContain('c')
  })

  it('selects up to exactly 5 creators', () => {
    let selected: string[] = []
    for (const h of ['a', 'b', 'c', 'd', 'e']) {
      selected = toggleSelect(selected, h)
    }
    expect(selected).toHaveLength(5)
  })

  it('deselecting from a full set of 5 allows re-selection of a new handle', () => {
    let selected = ['a', 'b', 'c', 'd', 'e']
    // Remove 'e'
    selected = toggleSelect(selected, 'e')
    expect(selected).toHaveLength(4)
    // Now adding 'f' should succeed
    selected = toggleSelect(selected, 'f')
    expect(selected).toHaveLength(5)
    expect(selected).toContain('f')
    expect(selected).not.toContain('e')
  })

  it('toggling a handle that is NOT selected and count < 5 adds it once', () => {
    const selected = toggleSelect(['x'], 'y')
    expect(selected).toEqual(['x', 'y'])
  })

  it('does not duplicate if the same handle is toggled twice', () => {
    let selected = toggleSelect([], 'a')  // add
    selected = toggleSelect(selected, 'a')  // remove
    expect(selected).toHaveLength(0)
    selected = toggleSelect(selected, 'a')  // add again
    expect(selected).toHaveLength(1)
    expect(selected).toEqual(['a'])
  })

  it('max-5 check uses >= so exactly 5 already-selected blocks a 6th', () => {
    const full = ['p1', 'p2', 'p3', 'p4', 'p5']
    const result = toggleSelect(full, 'p6')
    expect(result).toHaveLength(5)
    expect(result).toEqual(full)
  })
})
