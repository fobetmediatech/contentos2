import { useState } from 'react'
import { useAuthStore } from '../store/authStore'

/**
 * LoginPage — magic-link sign-in screen.
 *
 * DESIGN.md tokens: chai bg (#1A1410), saffron accent (#E07B3A / #F4A97B),
 * Instrument Serif italic for display, Outfit for body/UI.
 * Matches ChatPage / AppLayout class patterns — no Inter, no slate, no indigo.
 */
export function LoginPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || sending) return
    setSending(true)
    setError(null)
    // Call the action at event time (not captured at module load) so vi.spyOn intercepts it.
    const { error: err } = await useAuthStore.getState().signInWithEmail(email.trim())
    setSending(false)
    if (err) {
      setError(err)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="h-[100dvh] flex items-center justify-center bg-chai px-4">
      <div
        className="w-full max-w-sm rounded-[10px] border border-[rgba(245,237,214,0.08)] bg-surface p-8"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(245,237,214,0.08)' }}
      >
        {/* Wordmark */}
        <h1 className="font-serif italic text-2xl text-primary tracking-tight mb-1">
          Content OS
        </h1>
        <p className="text-sm text-secondary mb-8">
          Sign in to continue
        </p>

        {sent ? (
          /* Confirmation state */
          <div className="text-center py-4">
            <p className="text-[#F4A97B] font-medium text-sm mb-2">Check your email</p>
            <p className="text-secondary text-sm">
              We sent a sign-in link to <span className="text-primary">{email}</span>.
              Open it in this browser to continue.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-muted mb-1.5 uppercase tracking-wide font-mono">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoComplete="email"
                className="w-full bg-[#1A1410] border border-[rgba(245,237,214,0.12)] rounded-md px-3 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-[rgba(224,123,58,0.5)] focus:ring-1 focus:ring-[rgba(224,123,58,0.3)] transition-colors"
              />
            </div>

            {error && (
              <p className="text-[#E05C5C] text-sm">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="w-full bg-[#E07B3A] hover:bg-[#C4612A] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm rounded-md px-4 py-2.5 transition-colors"
            >
              {sending ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
