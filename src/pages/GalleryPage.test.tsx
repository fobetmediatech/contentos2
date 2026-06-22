// @vitest-environment jsdom
/**
 * GalleryPage tests — empty state + a populated reel grid read from corpus.listAllContent().
 * The corpus module is mocked so the page renders without a live Supabase/IndexedDB.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ContentRecord } from '../lib/corpus'

const listAllContent = vi.fn()
vi.mock('../lib/corpusIdb', () => ({
  corpus: { listAllContent: (...a: unknown[]) => listAllContent(...a) },
}))

import { GalleryPage } from './GalleryPage'

const reel = (id: string, over: Partial<ContentRecord> = {}): ContentRecord => ({
  id,
  creatorUsername: 'foodie',
  kind: 'reel',
  url: `https://www.instagram.com/reel/${id}/`,
  caption: 'plating the perfect pasta',
  thumbnailUrl: 'https://cdn.example/thumb.jpg',
  transcript: 'first you boil the water',
  videoViewCount: 1_200_000,
  likesCount: 100,
  commentsCount: 10,
  analyzedAt: 1,
  ...over,
})

afterEach(cleanup)

describe('GalleryPage', () => {
  it('shows an empty state when no reels are stored', async () => {
    listAllContent.mockResolvedValue([])
    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/No reels yet/i)).toBeTruthy()
  })

  it('renders a compact card per reel with the creator handle and metrics', async () => {
    listAllContent.mockResolvedValue([reel('abc')])
    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('@foodie')).toBeTruthy()
    expect(screen.getByText(/1\.2M/)).toBeTruthy() // formatted view count
  })

  it('renders the stored thumbnail image on the card when present', async () => {
    listAllContent.mockResolvedValue([reel('abc')]) // has thumbnailUrl
    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    )
    await screen.findByText('@foodie')
    const img = document.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://cdn.example/thumb.jpg')
  })

  it('falls back to a lazy Instagram embed on the card when no thumbnail is stored', async () => {
    listAllContent.mockResolvedValue([reel('xyz', { thumbnailUrl: undefined })])
    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    )
    await screen.findByText('@foodie')
    expect(document.querySelector('img')).toBeNull()
    const iframe = document.querySelector('iframe') // card embed mounts (no IntersectionObserver in jsdom)
    expect(iframe?.getAttribute('src') ?? '').toContain('xyz')
  })

  it('first click expands a card into an Instagram-style modal with the embed, metrics, caption and transcript', async () => {
    listAllContent.mockResolvedValue([reel('abc')])
    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /expand reel/i }))

    const dialog = await screen.findByRole('dialog')
    // Instagram embed of the actual reel (left side)
    const iframe = dialog.querySelector('iframe')
    expect(iframe?.getAttribute('src') ?? '').toContain('abc')
    // Detail panel (right side): caption, transcript, metrics
    expect(within(dialog).getByText('plating the perfect pasta')).toBeTruthy()
    expect(within(dialog).getByText(/first you boil the water/)).toBeTruthy()
    expect(within(dialog).getByText(/1\.2M/)).toBeTruthy()
    // a link back to the reel on Instagram
    const links = within(dialog).getAllByRole('link')
    expect(links.some((a) => a.getAttribute('href') === 'https://www.instagram.com/reel/abc/')).toBe(true)
  })

  it('closes the modal on the close button', async () => {
    listAllContent.mockResolvedValue([reel('abc')])
    render(
      <MemoryRouter>
        <GalleryPage />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /expand reel/i }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
