// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AuthGate } from './AuthGate'
import { useAuthStore } from '../store/authStore'

afterEach(cleanup) // RTL auto-cleanup is off in this project; the 'APP'-absent assertions depend on it
beforeEach(() => useAuthStore.setState({ status: 'loading', session: null, user: null }))

describe('AuthGate', () => {
  it('shows a loading splash while status is loading', () => {
    useAuthStore.setState({ status: 'loading' })
    render(<AuthGate><div>APP</div></AuthGate>)
    expect(screen.queryByText('APP')).toBeNull()
  })
  it('shows LoginPage when signed-out', () => {
    useAuthStore.setState({ status: 'signed-out' })
    render(<AuthGate><div>APP</div></AuthGate>)
    expect(screen.getByPlaceholderText(/email/i)).toBeTruthy()
    expect(screen.queryByText('APP')).toBeNull()
  })
  it('renders children when signed-in', () => {
    useAuthStore.setState({ status: 'signed-in', user: { id: 'u1', email: 'a@b.co' } as never })
    render(<AuthGate><div>APP</div></AuthGate>)
    expect(screen.getByText('APP')).toBeTruthy()
  })
})
