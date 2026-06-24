import { useEffect, useState } from 'react'

/**
 * Live elapsed-time counter for long-running pipelines. Returns whole seconds
 * since `active` last flipped true; 0 when inactive. Re-renders once per second.
 *
 * Drives the "honest waits" UX — users watching a 2–4 minute scrape need a real,
 * updating signal, not just step labels or a fixed estimate that can be wildly off.
 *
 * Reset-on-transition uses the React-sanctioned "adjust state during render" pattern
 * (not an effect), and the 1s interval only updates state from its callback — so
 * neither the set-state-in-effect nor the refs-in-render lint rules are tripped.
 */
export function useElapsedTime(active: boolean): number {
  const [sec, setSec] = useState(0)
  const [prevActive, setPrevActive] = useState(active)

  if (active !== prevActive) {
    setPrevActive(active)
    setSec(0)
  }

  useEffect(() => {
    if (!active) return
    const start = Date.now()
    const id = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [active])

  return active ? sec : 0
}

/** Format a second count as "45s" or "1m 24s". */
export function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}
