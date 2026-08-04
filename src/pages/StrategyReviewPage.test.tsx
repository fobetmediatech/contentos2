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

describe('SAMPLE_EXTRACTIONS fixture', () => {
  // The fixture exists so the review UI can be previewed without an ingested transcript, a Gemini
  // key or any credits. That only holds if it actually exercises every state the page renders —
  // otherwise a state can silently rot with nothing to catch it.
  it('covers every provenance and review state the page can render', async () => {
    const { SAMPLE_EXTRACTIONS } = await import('../lib/sampleStrategy')

    const provenances = new Set(SAMPLE_EXTRACTIONS.map((r) => r.provenance))
    expect(provenances.has('extracted')).toBe(true)
    expect(provenances.has('inferred')).toBe(true)
    expect(provenances.has('sheet')).toBe(true)

    const statuses = new Set(SAMPLE_EXTRACTIONS.map((r) => r.reviewStatus))
    expect(statuses.has('pending')).toBe(true)
    expect(statuses.has('approved')).toBe(true)
    expect(statuses.has('edited')).toBe(true)

    // An edited row must retain what the model originally produced, or the comparison is empty.
    expect(SAMPLE_EXTRACTIONS.find((r) => r.reviewStatus === 'edited')?.originalValue).toBeTruthy()

    // The multi-source case — a field assembled from several moments in the call.
    expect(SAMPLE_EXTRACTIONS.some((r) => r.citations.length >= 3)).toBe(true)

    // Handles are sheet-sourced and carry no citations; the model may never author them.
    const handles = SAMPLE_EXTRACTIONS.filter((r) => /^(competitors|aspirational)\./.test(r.fieldName))
    expect(handles.length).toBeGreaterThan(0)
    expect(handles.every((r) => r.provenance === 'sheet' && r.citations.length === 0)).toBe(true)

    // An inferred value must carry a confidence score — the DB rejects it otherwise.
    expect(SAMPLE_EXTRACTIONS.find((r) => r.provenance === 'inferred')?.confidence).toBeTypeOf('number')

    // brandColors is deliberately absent so the empty-field state has something to render.
    expect(SAMPLE_EXTRACTIONS.some((r) => r.fieldName === 'brandColors')).toBe(false)
  })

  it('clears the export gate, so the preview reaches the "Use this brief" state', async () => {
    const { SAMPLE_EXTRACTIONS } = await import('../lib/sampleStrategy')
    const { evaluateGate } = await import('../lib/reviewGate')

    // One inference is pending sign-off on purpose — that blocker is part of what is previewed.
    expect(evaluateGate(SAMPLE_EXTRACTIONS).blockers.map((b) => b.code)).toEqual(['unreviewed_inferred'])

    const signedOff = SAMPLE_EXTRACTIONS.map((r) =>
      r.provenance === 'inferred' ? { ...r, reviewStatus: 'approved' as const } : r,
    )
    expect(evaluateGate(signedOff).blocked).toBe(false)
  })
})
