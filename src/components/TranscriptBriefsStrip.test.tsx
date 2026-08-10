// @vitest-environment jsdom
/**
 * TranscriptBriefsStrip tests — the entry point into the review flow.
 *
 * Access was widened to every signed-in member (20260810000000) — this used to be admin-only.
 * The remaining behaviour worth pinning is that the empty state explains what to do rather than
 * looking broken.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { listClientsMock } = vi.hoisted(() => ({ listClientsMock: vi.fn() }))

vi.mock('../lib/reviewRepo', () => ({ listClients: listClientsMock }))

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
  listClientsMock.mockResolvedValue([])
})
afterEach(cleanup)

describe('TranscriptBriefsStrip', () => {
  it('renders for any signed-in member — no longer admin-gated', () => {
    // Reversed deliberately: the cb_ tables were widened to every authenticated user, so hiding
    // this strip would leave the feature built and unreachable for most of the team.
    const { container } = renderStrip()
    expect(container.firstChild).not.toBeNull()
    expect(listClientsMock).toHaveBeenCalled()
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
