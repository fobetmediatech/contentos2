import { useEffect, useState } from 'react'

/**
 * A clock value for deriving "is this overdue yet?" during render.
 *
 * Reading Date.now() straight from a component body is impure — React may re-render at any
 * moment, so two rows in the same table could be judged against two different instants. This
 * hook holds the instant in state and only advances it from an interval callback, the same
 * sanctioned shape as useElapsedTime.
 *
 * The lazy initializer runs exactly once per mount, so the first paint is already correct — no
 * frame where an overdue task briefly reads as "not due yet".
 *
 * Default cadence is a minute because the consumers show coarse durations ("2d 4h"); a
 * per-second tick would re-render the whole table to change nothing visible.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
