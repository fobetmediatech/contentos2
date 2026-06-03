// @vitest-environment jsdom
/**
 * MemoryPage tests — empty state + populated list, reading from the real corpus store.
 * The populated render also guards against the useSyncExternalStore infinite-loop class of
 * bug (a bad derived selector would throw "Maximum update depth" on render).
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MemoryPage } from './MemoryPage'
import { useCorpusStore } from '../store/corpusStore'
import type { CreatorRecord } from '../lib/corpus'

const creator = (username: string, over: Partial<CreatorRecord> = {}): CreatorRecord => ({
  username,
  fullName: `${username} Name`,
  profilePicUrl: '',
  verified: false,
  isBusinessAccount: false,
  followersCount: 1000,
  followsCount: 10,
  postsCount: 5,
  avgLikes: 10,
  avgComments: 1,
  engagementRate: 4,
  topHashtags: [],
  firstSeenAt: 1,
  lastSeenAt: 1,
  timesSeen: 1,
  sightings: [{ at: 1, pipeline: 'competitor', niche: 'fitness' }],
  ...over,
})

beforeEach(() => useCorpusStore.setState({ creators: {}, count: 0, hydrated: true }))
afterEach(cleanup)

describe('MemoryPage', () => {
  it('shows an empty state when nothing is remembered', () => {
    render(
      <MemoryRouter>
        <MemoryPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Nothing remembered yet/)).toBeTruthy()
  })

  it('lists remembered creators with the total count', () => {
    useCorpusStore.setState({ creators: { alice: creator('alice'), bob: creator('bob') }, count: 2 })
    render(
      <MemoryRouter>
        <MemoryPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('@alice')).toBeTruthy()
    expect(screen.getByText('@bob')).toBeTruthy()
    expect(screen.getByText(/2 creators remembered/)).toBeTruthy()
  })
})
