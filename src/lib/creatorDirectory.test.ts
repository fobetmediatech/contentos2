import { describe, it, expect } from 'vitest'
import { directoryId, groupByCategory, type DirectoryEntry } from './creatorDirectory'

describe('directoryId', () => {
  it('is stable + normalizes handle/category', () => {
    expect(directoryId('Fitness', '@JeffNippard')).toBe('fitness:jeffnippard')
    expect(directoryId('finance', 'humphreytalks')).toBe('finance:humphreytalks')
  })
})

describe('groupByCategory', () => {
  it('groups entries by category preserving order', () => {
    const e = (id: string, category: string): DirectoryEntry => ({ id, category, handle: id, displayName: id })
    const grouped = groupByCategory([e('a', 'tech'), e('b', 'fitness'), e('c', 'tech')])
    expect(Object.keys(grouped).sort()).toEqual(['fitness', 'tech'])
    expect(grouped.tech.map((x) => x.id)).toEqual(['a', 'c'])
  })
})
