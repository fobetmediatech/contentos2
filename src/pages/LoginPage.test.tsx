// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { LoginPage } from './LoginPage'
import { useAuthStore } from '../store/authStore'

// Project convention: environment is 'node' globally, so RTL files need the jsdom pragma
// above; RTL auto-cleanup is off, so cleanup() each test; jest-dom is NOT installed, so use
// .toBeTruthy()/.toBeNull() (matching MemoryPage.test.tsx etc.), NOT .toBeInTheDocument().
afterEach(cleanup)
beforeEach(() => {
  vi.spyOn(useAuthStore.getState(), 'signInWithEmail').mockResolvedValue({ error: null })
})

describe('LoginPage', () => {
  it('renders an email field + send button', () => {
    render(<LoginPage />)
    expect(screen.getByPlaceholderText(/email/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /magic link|sign in|send/i })).toBeTruthy()
  })

  it('submitting an email calls signInWithEmail and shows the confirmation', async () => {
    render(<LoginPage />)
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: /magic link|sign in|send/i }))
    await waitFor(() => expect(useAuthStore.getState().signInWithEmail).toHaveBeenCalledWith('a@b.co'))
    expect(await screen.findByText(/check your email/i)).toBeTruthy()
  })

  it('shows an error when sending fails', async () => {
    vi.spyOn(useAuthStore.getState(), 'signInWithEmail').mockResolvedValue({ error: 'Could not send the magic link — try again shortly.' })
    render(<LoginPage />)
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: /magic link|sign in|send/i }))
    expect(await screen.findByText(/could not send/i)).toBeTruthy()
  })
})
