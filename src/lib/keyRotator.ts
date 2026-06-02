/**
 * Apify API key rotator with cooldown tracking.
 *
 * Cooldown timestamps stored as epoch milliseconds (numbers, not Date).
 * Zustand persist serializes Date→string on save, breaking rehydration.
 * Numbers survive the round-trip unchanged.
 *
 * TOCTOU-safe: read-then-write happens synchronously (no await between them).
 * Cross-tab sync is handled at the Zustand store layer (storage event listener).
 */

import storage from './storage'

const COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes
const STORAGE_KEY = 'apify_key_cooldowns'

interface CooldownMap {
  [key: string]: number // epoch ms when cooldown expires
}

function readCooldowns(): CooldownMap {
  try {
    const raw = storage.get(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CooldownMap) : {}
  } catch {
    return {}
  }
}

function writeCooldowns(map: CooldownMap): void {
  storage.set(STORAGE_KEY, JSON.stringify(map))
}

/**
 * Mark a key as in cooldown starting now.
 * Synchronous read-then-write prevents TOCTOU race between tabs.
 */
export function markKeyCooldown(apiKey: string): void {
  const cooldowns = readCooldowns() // read
  cooldowns[apiKey] = Date.now() + COOLDOWN_MS
  writeCooldowns(cooldowns) // write immediately (same tick)
}

/**
 * Check if a key is currently in cooldown.
 */
export function isKeyCoolingDown(apiKey: string): boolean {
  const cooldowns = readCooldowns()
  const expiresAt = cooldowns[apiKey]
  if (!expiresAt) return false
  if (Date.now() >= expiresAt) {
    // Cooldown expired — clean it up
    delete cooldowns[apiKey]
    writeCooldowns(cooldowns)
    return false
  }
  return true
}

/**
 * Get cooldown expiry time (epoch ms) for a key, or null if not cooling down.
 */
export function getKeyExpiry(apiKey: string): number | null {
  const cooldowns = readCooldowns()
  const expiresAt = cooldowns[apiKey]
  if (!expiresAt || Date.now() >= expiresAt) return null
  return expiresAt
}

/**
 * Pick the next available Apify key (round-robin, skipping cooled-down keys).
 * Returns null if all keys are cooling down.
 */
const ROTATION_KEY = 'apify_key_rotation_idx'

export function pickAvailableKey(apifyKeys: string[]): string | null {
  const available = apifyKeys.filter((k) => k.trim() && !isKeyCoolingDown(k))
  if (available.length === 0) return null
  // M10: round-robin via a persisted incrementing index. The old `Date.now()/1000 %`
  // handed EVERY pick within the same wall-clock second the same key, so a burst of
  // parallel profile scrapes (pLimit(3)) all hammered one key — defeating the whole
  // point of multiple keys. Advancing per pick spreads the load. Read-then-write is
  // synchronous (TOCTOU-safe, same as the cooldown map).
  const raw = storage.get(ROTATION_KEY)
  const prev = Number(raw)
  const next = (Number.isFinite(prev) ? prev : 0) + 1
  storage.set(ROTATION_KEY, String(next))
  return available[next % available.length]
}

/**
 * Returns true when the app has enough keys to run an analysis.
 * Requires: Gemini key present AND at least one Apify key not in cooldown.
 */
export function isReady(geminiKey: string | null, apifyKeys: string[]): boolean {
  if (!geminiKey?.trim()) return false
  return pickAvailableKey(apifyKeys) !== null
}
