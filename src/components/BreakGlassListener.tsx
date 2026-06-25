/**
 * BreakGlassListener — mounts app-wide. Listens for the Konami code (↑↑↓↓←→←→ b a) and,
 * on a match, opens a "Recovery access" popup. The code typed in is verified server/DB-side
 * (break_glass RPC, bcrypt-hashed); on success the current user is granted admin and routed
 * to Team Access. Wrong guesses are throttled after a few tries.
 *
 * The Konami sequence is only a hidden door — the real lock is the recovery code.
 */
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { X, ShieldCheck } from 'lucide-react'
import { matchesKonami, normalizeKey, KONAMI_SEQUENCE } from '../lib/konami'
import { breakGlass } from '../lib/teamAccess'

const MAX_TRIES = 5
const LOCK_MS = 30_000
// Break-glass grants a 3-minute admin (enforced in the DB). Mirror it on the client so the
// Team Access menu/page drops once it expires, without needing a manual reload.
const BREAK_GLASS_TTL_MS = 3 * 60 * 1000

export function BreakGlassListener() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const buffer = useRef<string[]>([])
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [tries, setTries] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Global Konami listener — opens the recovery popup on the full sequence.
  // State resets happen in the event callback (allowed), not synchronously in the effect body.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      buffer.current = [...buffer.current, normalizeKey(e.key)].slice(-KONAMI_SEQUENCE.length)
      if (matchesKonami(buffer.current)) {
        buffer.current = []
        setCode('')
        setStatus('idle')
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Focus the input when the popup opens (DOM-only effect — no state writes).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  // Auto-clear the lockout when it expires (setState only inside the timer callback).
  useEffect(() => {
    if (lockedUntil === 0) return
    const t = setTimeout(() => {
      setLockedUntil(0)
      setTries(0)
    }, Math.max(0, lockedUntil - Date.now()))
    return () => clearTimeout(t)
  }, [lockedUntil])

  const locked = lockedUntil > 0
  const close = () => setOpen(false)

  const submit = async () => {
    if (!code.trim() || status === 'submitting' || locked) return
    setStatus('submitting')
    const ok = await breakGlass(code.trim())
    if (ok) {
      setStatus('success')
      await qc.invalidateQueries({ queryKey: ['is-admin'] })
      // Re-check admin status when the 3-minute window expires (permanent admins stay; temporary ones drop).
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['is-admin'] }), BREAK_GLASS_TTL_MS + 2000)
      setTimeout(() => {
        setOpen(false)
        navigate('/team-access')
      }, 900)
    } else {
      const n = tries + 1
      setTries(n)
      setStatus('error')
      if (n >= MAX_TRIES) setLockedUntil(Date.now() + LOCK_MS)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={close}>
      <div
        className="bg-surface border border-[rgba(245,237,214,0.14)] rounded-lg w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-primary text-lg font-medium flex items-center gap-2">
            <ShieldCheck size={18} className="text-[#E07B3A]" /> Recovery access
          </h2>
          <button onClick={close} aria-label="Close" className="text-muted hover:text-primary">
            <X size={18} />
          </button>
        </div>

        {status === 'success' ? (
          <p className="text-success text-sm py-4">You now have admin access. Opening Team Access…</p>
        ) : (
          <>
            <p className="text-secondary text-sm mb-3">Enter the recovery code to regain admin access.</p>
            <input
              ref={inputRef}
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              placeholder="Recovery code"
              disabled={locked}
              className="w-full bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[#E07B3A] disabled:opacity-50"
            />
            {status === 'error' && !locked && <p className="text-danger text-xs mt-2">Incorrect code.</p>}
            {locked && <p className="text-danger text-xs mt-2">Too many attempts — wait a moment and try again.</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={close} className="text-sm text-secondary hover:text-primary px-3 py-2">
                Cancel
              </button>
              <button
                onClick={() => void submit()}
                disabled={!code.trim() || status === 'submitting' || locked}
                className="bg-[#E07B3A] hover:bg-[#C4612A] disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
              >
                {status === 'submitting' ? 'Checking…' : 'Unlock'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
