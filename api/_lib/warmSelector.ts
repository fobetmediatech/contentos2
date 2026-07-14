/** Pure selector for the voice warmer — which directory handles to build next. Unit-tested. */
export interface DirectoryRow {
  id: string
  handle: string
  display_name: string
  warm_attempts: number
  warm_last_attempt_at: string | null
}

const MAX_ATTEMPTS = 5
const BACKOFF_MS = 24 * 60 * 60 * 1000

/** Handles with no profile, under the attempt cap, past backoff — never-attempted first, oldest next, capped. */
export function pickHandlesToWarm(
  rows: DirectoryRow[],
  existingHandles: Set<string>,
  nowMs: number,
  limit: number,
): DirectoryRow[] {
  const at = (r: DirectoryRow) => (r.warm_last_attempt_at == null ? -1 : Date.parse(r.warm_last_attempt_at))
  return rows
    .filter((r) => !existingHandles.has(r.handle))
    .filter((r) => r.warm_attempts < MAX_ATTEMPTS)
    .filter((r) => r.warm_last_attempt_at == null || nowMs - Date.parse(r.warm_last_attempt_at) >= BACKOFF_MS)
    .sort((a, b) => at(a) - at(b))
    .slice(0, limit)
}
