// @vitest-environment jsdom
/**
 * StrategyReviewPage tests — the review surface renders provenance honestly.
 *
 * The page sits behind Clerk + admin-only RLS, so it cannot be exercised in a browser without
 * credentials. These tests verify the things that actually matter for the five-minute review
 * target: that blockers are stated, that inferred is visually distinguished from cited, that an
 * empty field looks empty, and that "approve all" never sweeps up an inference.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ExtractionRow } from '../lib/reviewGate'

const { navigateSpy, listExtractionsMock, approveRowsMock } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  listExtractionsMock: vi.fn(),
  approveRowsMock: vi.fn(),
}))

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateSpy,
  useParams: () => ({ clientId: 'client-1' }),
}))
vi.mock('../hooks/useIsAdmin', () => ({ useIsAdmin: () => ({ isAdmin: true, isLoading: false }) }))
vi.mock('../lib/reviewRepo', () => ({
  listClients: vi.fn(async () => [{ id: 'client-1', displayName: 'Abhijeet MAS', emails: [], createdAt: 0 }]),
  listExtractions: listExtractionsMock,
  saveRow: vi.fn(async () => undefined),
  approveRows: approveRowsMock,
}))

import { StrategyReviewPage } from './StrategyReviewPage'

const row = (p: Partial<ExtractionRow> & { fieldName: string }): ExtractionRow => ({
  id: p.fieldName,
  value: null,
  citations: [],
  provenance: 'extracted',
  confidence: null,
  reviewStatus: 'pending',
  originalValue: null,
  ...p,
})

const renderPage = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StrategyReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText(/Review brief/i)
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('StrategyReviewPage', () => {
  it('states blockers up front rather than only disabling the button', async () => {
    listExtractionsMock.mockResolvedValue([row({ fieldName: 'brandName', value: 'Abhijeet MAS' })])
    await renderPage()

    expect(await screen.findByText(/Not ready to generate/i)).toBeTruthy()
    // Both the form's own gate and the pipeline's separate handle gate are named.
    expect(screen.getByText(/Required field is empty/i)).toBeTruthy()
    expect(screen.getByText(/at least one competitor or aspirational handle/i)).toBeTruthy()
  })

  it('clears the blocker banner once the brief is viable', async () => {
    listExtractionsMock.mockResolvedValue([
      row({ fieldName: 'brandName', value: 'Abhijeet MAS' }),
      row({ fieldName: 'offer', value: 'Dubai relocation' }),
      row({ fieldName: 'competitors.0', value: 'dubai_homes', provenance: 'sheet' }),
    ])
    await renderPage()
    expect(screen.queryByText(/Not ready to generate/i)).toBeNull()
  })

  it('marks an inferred value distinctly and offers sign-off', async () => {
    listExtractionsMock.mockResolvedValue([
      row({ fieldName: 'audience', value: 'affluent NRIs', provenance: 'inferred', confidence: 0.62 }),
    ])
    await renderPage()

    // /inferred/i also matches the blocker line, so assert the badge's own confidence chip.
    expect(screen.getByText(/inferred 62%/i)).toBeTruthy()
    expect(screen.getByText(/Sign off on this inference/i)).toBeTruthy()
  })

  it('shows a citation count for cited values and the quote when opened', async () => {
    listExtractionsMock.mockResolvedValue([
      row({
        fieldName: 'offer',
        value: 'Dubai relocation',
        citations: [{ chunk_id: 'c1', quote: 'we do end to end Dubai relocation', start_sec: 92 }],
      }),
    ])
    await renderPage()

    const badge = screen.getByRole('button', { name: /show 1 citation/i })
    expect(badge.getAttribute('aria-expanded')).toBe('false')
    badge.click()
    expect(await screen.findByText(/we do end to end Dubai relocation/i)).toBeTruthy()
    expect(screen.getByText(/1:32/)).toBeTruthy() // 92s rendered as mm:ss
  })

  it('leaves an unextracted field visually empty, with no provenance badge', async () => {
    listExtractionsMock.mockResolvedValue([row({ fieldName: 'brandName', value: 'Abhijeet MAS' })])
    await renderPage()

    // Every field the model never returned shares this placeholder — assert they are all blank.
    const unextracted = screen.getAllByPlaceholderText(/Not extracted/i) as HTMLInputElement[]
    expect(unextracted.length).toBeGreaterThan(1)
    expect(unextracted.every((i) => i.value === '')).toBe(true)
  })

  it('counts only cited and sheet rows as approvable — never an inference', async () => {
    listExtractionsMock.mockResolvedValue([
      row({ fieldName: 'offer', value: 'Dubai relocation' }),
      row({ fieldName: 'competitors.0', value: 'dubai_homes', provenance: 'sheet' }),
      row({ fieldName: 'audience', value: 'affluent NRIs', provenance: 'inferred', confidence: 0.6 }),
    ])
    await renderPage()
    expect(screen.getByText(/Approve all cited \(2\)/)).toBeTruthy()
  })

  it('shows the original value after an edit so the change is comparable', async () => {
    listExtractionsMock.mockResolvedValue([
      row({ fieldName: 'offer', value: 'corrected offer', reviewStatus: 'edited', originalValue: 'model guess' }),
    ])
    await renderPage()
    expect(screen.getByText(/model guess/i)).toBeTruthy()
    expect(screen.getByText(/edited/i)).toBeTruthy()
  })

  it('explains the empty case instead of rendering a blank form', async () => {
    listExtractionsMock.mockResolvedValue([])
    await renderPage()
    expect(screen.getByText(/No extractions yet/i)).toBeTruthy()
  })
})
