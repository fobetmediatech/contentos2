/**
 * Reel-store persistence helpers (Phase 2).
 *
 * The reel analysis store is persisted so a finished reel/hook breakdown survives a reload
 * (it used to vanish — the store reset to empty on refresh). But a reel run is multi-step
 * (scrape → analyze → synthesize), so a reload MID-run would otherwise restore a half-done
 * state stuck on spinners. `isCleanReelRun` gates that: only a cleanly-finished run is
 * restored; an interrupted one is discarded so the UI comes back to a clean slate.
 *
 * Pure + dependency-free so the rule is unit-tested without the store or a real database.
 */

/** Minimal shape needed to judge whether a persisted reel run finished cleanly. */
export interface ReelRunShape {
  synthesisStatus: string
  creatorStates: Record<string, { status: string }>
}

/**
 * True only when the run reached a terminal synthesis state AND no creator is still
 * mid-flight (scraping/analyzing). A reload during the run fails this → the run is dropped.
 */
export function isCleanReelRun(s: ReelRunShape): boolean {
  const finished = s.synthesisStatus === 'done' || s.synthesisStatus === 'failed'
  const anyMidFlight = Object.values(s.creatorStates).some(
    (c) => c.status === 'scraping' || c.status === 'analyzing',
  )
  return finished && !anyMidFlight
}
