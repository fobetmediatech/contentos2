/**
 * Phase-1b abort control.
 *
 * Lets the agent loop (T8) cancel an in-flight pipeline run — "latest-wins"
 * steering, e.g. the user types "actually, make them micro" mid-scrape — WITHOUT
 * the cancel being mistaken for a failure.
 *
 * Each pipeline still owns an INTERNAL timeout controller (the existing 150s/90s
 * guard). linkAbort() forwards an optional EXTERNAL signal (owned by the agent loop)
 * onto that internal controller, so the work — which listens to one combined signal —
 * stops whichever way it's cancelled.
 *
 * The distinction that matters downstream:
 *   - EXTERNAL abort  → the agent loop superseded this run → SILENT (not an error).
 *   - INTERNAL timeout → the request genuinely timed out → a real, user-visible error.
 *
 * wasSuperseded() answers exactly that, by checking the external signal directly —
 * no abort-reason sentinels needed (the internal timeout never touches the external
 * signal, so external.aborted is true ONLY when the loop steered away).
 *
 *        ┌──────────────── external (agent loop) ───────────┐
 *        │  abort() on steer                                 │
 *        ▼                                                   │
 *   [external signal] ──forward──► [internal controller] ◄── setTimeout(abort, ms)
 *                                          │
 *                                          ▼  the work listens here
 *                                     abort.signal
 *   wasSuperseded() === external?.aborted  (true → silent; false → timeout error)
 */

export interface LinkedAbort {
  /** The signal the pipeline work should pass to fetch / poll loops. */
  signal: AbortSignal
  /** True if the run was cancelled by the EXTERNAL (steer) signal — a silent cancel, not a failure. */
  wasSuperseded: () => boolean
  /** Clear the timeout + detach the external listener. Call in `finally`. */
  cleanup: () => void
}

/**
 * Create an internal timeout controller, optionally forwarding an external signal's
 * abort onto it.
 *
 * @param timeoutMs  internal hard-timeout (the existing per-pipeline guard)
 * @param external   optional signal owned by the caller (the agent loop); when it
 *                   aborts, the run is treated as superseded (silent), not failed.
 */
export function linkAbort(timeoutMs: number, external?: AbortSignal): LinkedAbort {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const onExternalAbort = () => controller.abort()
  if (external) {
    // If the loop already steered away before we even started, abort immediately.
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }

  return {
    signal: controller.signal,
    // External abort === intentional steer. Internal timeout never sets external.aborted,
    // so this is false for a genuine timeout (which stays a real error).
    wasSuperseded: () => external?.aborted ?? false,
    cleanup: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}
