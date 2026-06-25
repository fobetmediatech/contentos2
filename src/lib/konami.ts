/**
 * The Konami code, used as the hidden trigger for the break-glass recovery popup.
 *
 *   ↑ ↑ ↓ ↓ ← → ← → b a   (b and a are lowercase)
 *
 * The sequence is just obscurity (a hidden door) — the real security is the recovery code
 * entered afterward, which is verified server/DB-side. Kept as a pure module so it's testable.
 */
export const KONAMI_SEQUENCE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
] as const

/** Normalize a KeyboardEvent.key to how the sequence stores it (letters lowercased). */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/** True when the most recent keys end with the full Konami sequence. */
export function matchesKonami(recentKeys: string[]): boolean {
  if (recentKeys.length < KONAMI_SEQUENCE.length) return false
  const tail = recentKeys.slice(-KONAMI_SEQUENCE.length)
  return tail.every((k, i) => k === KONAMI_SEQUENCE[i])
}
