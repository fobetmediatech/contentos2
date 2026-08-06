// @vitest-environment jsdom
/**
 * TranscriptBriefsStrip tests — the entry point into the review flow.
 *
 * The important behaviours are the two that are easy to get wrong: it must stay hidden from
 * non-admins (the cb_ tables carry margins), and its empty state must explain what to do rather
 * than looking broken.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { listClientsMock, isAdminMock } = vi.hoisted(() => ({
  listClientsMock: vi.fn(),
  isAdminMock: vi.fn(),
}))

vi.mock('../lib/reviewRepo', () => ({ listClients: listClientsMock }))
vi.mock('../hooks/useIsAdmin', () => ({ useIsAdmin: isAdminMock }))

import { TranscriptBriefsStrip } from './TranscriptBriefsStrip'

const renderStrip = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TranscriptBriefsStrip />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  isAdminMock.mockReturnValue({ isAdmin: true, isLoading: false })
  listClientsMock.mockResolvedValue([])
})
afterEach(cleanup)

describe('TranscriptBriefsStrip', () => {
  it('renders nothing at all for a non-admin', () => {
    isAdminMock.mockReturnValue({ isAdmin: false, isLoading: false })
    const { container } = renderStrip()
    expect(container.firstChild).toBeNull()
    // And never queries — a permanently-empty section would just confuse.
    expect(listClientsMock).not.toHaveBeenCalled()
  })

  it('explains what to do when there are no clients yet', async () => {
    renderStrip()
    expect(await screen.findByText(/No transcript clients yet/i)).toBeTruthy()
    expect(screen.getByText(/Import a sales-sheet row/i)).toBeTruthy()
  })

  it('links each client to its review page and shows the join-key email', async () => {
    listClientsMock.mockResolvedValue([
      { id: 'abc-123', displayName: 'Ankur Sharma', emails: ['ankur@example.com'], createdAt: 1754300000000 },
    ])
    renderStrip()

    const link = await screen.findByRole('link', { name: /Ankur Sharma/i })
    expect(link.getAttribute('href')).toBe('/strategy/review/abc-123')
    // The email is the transcript join key — showing it makes an unmatched transcript diagnosable.
    expect(screen.getByText('ankur@example.com')).toBeTruthy()
  })

  it('always offers the credit-free sample preview', async () => {
    renderStrip()
    const sample = await screen.findByRole('link', { name: /Preview sample/i })
    expect(sample.getAttribute('href')).toBe('/strategy/review/sample')
  })
})
