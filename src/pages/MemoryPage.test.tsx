// @vitest-environment jsdom
/**
 * MemoryPage tests — empty state + populated list, reading from the real corpus store.
 * The populated render also guards against the useSyncExternalStore infinite-loop class of
 * bug (a bad derived selector would throw "Maximum update depth" on render).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MemoryPage } from './MemoryPage'
import { useCorpusStore } from '../store/corpusStore'
import type { CreatorRecord } from '../lib/corpus'

// Spy on navigation so we can assert the Memory → chat deep-analysis handoff.
const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateSpy,
}))

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

beforeEach(() => {
  useCorpusStore.setState({ creators: {}, count: 0, hydrated: true })
  navigateSpy.mockClear()
})
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

describe('MemoryPage — batch deep analysis', () => {
  const renderPage = () => {
    useCorpusStore.setState({ creators: { alice: creator('alice'), bob: creator('bob') }, count: 2 })
    render(
      <MemoryRouter>
        <MemoryPage />
      </MemoryRouter>,
    )
  }

  it('shows no action bar until a creator is selected', () => {
    renderPage()
    expect(screen.queryByText(/selected/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Analyze reels/ })).toBeNull()
  })

  it('reveals the action bar with a live count as creators are selected', () => {
    renderPage()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select @alice' }))
    expect(screen.getByText('1 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select @bob' }))
    expect(screen.getByText('2 selected')).toBeTruthy()
  })

  it('toggling a selected creator off removes it from the count', () => {
    renderPage()
    const alice = screen.getByRole('checkbox', { name: 'Select @alice' })
    fireEvent.click(alice)
    expect(screen.getByText('1 selected')).toBeTruthy()
    fireEvent.click(alice)
    // Bar disappears entirely at zero.
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('Clear drops the whole selection', () => {
    renderPage()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select @alice' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select @bob' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('Analyze reels navigates to chat with the selected handles in router state', () => {
    renderPage()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select @alice' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select @bob' }))
    fireEvent.click(screen.getByRole('button', { name: /Analyze reels/ }))
    expect(navigateSpy).toHaveBeenCalledTimes(1)
    expect(navigateSpy).toHaveBeenCalledWith('/', { state: { analyzeHandles: ['alice', 'bob'] } })
  })
})
