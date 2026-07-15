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
  const eligible = rows
    .filter((r) => !existingHandles.has(r.handle))
    .filter((r) => r.warm_attempts < MAX_ATTEMPTS)
    .filter((r) => r.warm_last_attempt_at == null || nowMs - Date.parse(r.warm_last_attempt_at) >= BACKOFF_MS)
    .sort((a, b) => at(a) - at(b))
  // Dedupe by handle: creator_directory's PK is `${category}:${handle}`, so one handle can occupy
  // several rows across categories. A voice profile is handle-keyed + team-shared, so building it
  // once covers every category — selecting the same handle twice would waste a per-run slot.
  const seen = new Set<string>()
  const deduped: DirectoryRow[] = []
  for (const r of eligible) {
    if (seen.has(r.handle)) continue
    seen.add(r.handle)
    deduped.push(r)
  }
  return deduped.slice(0, limit)
}
