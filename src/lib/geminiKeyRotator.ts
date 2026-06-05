/**
 * Gemini API key rotator — round-robin selection with a SHORT cooldown.
 *
 * Separate from the Apify keyRotator on purpose: a Gemini 429 is a PER-MINUTE rate limit
 * that clears in seconds, so a key that just got limited should be skipped only briefly
 * (60s), not benched for 15 min like an out-of-credit Apify account. Same TOCTOU-safe
 * synchronous read-then-write pattern; its own storage namespace ('gemini_*').
 *
 * The pool comes from VITE_GEMINI_KEYS (comma-separated) + VITE_GEMINI_KEY (keysStore).
 * Round-robin spreads concurrent multi-user load across every key so no single key's
 * RPM/TPM is the bottleneck; the cooldown routes around a key that just 429'd.
 */

import storage from './storage'

const COOLDOWN_MS = 60 * 1000 // 60s — Gemini 429s are per-minute; recover fast
const STORAGE_KEY = 'gemini_key_cooldowns'
const ROTATION_KEY = 'gemini_key_rotation_idx'

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

/** Mark a key as cooling down for 60s (it just 429'd). Synchronous read-then-write (TOCTOU-safe). */
export function markGeminiKeyCooldown(apiKey: string): void {
  const cooldowns = readCooldowns()
  cooldowns[apiKey] = Date.now() + COOLDOWN_MS
  writeCooldowns(cooldowns)
}

function isGeminiKeyCoolingDown(apiKey: string): boolean {
  const cooldowns = readCooldowns()
  const expiresAt = cooldowns[apiKey]
  if (!expiresAt) return false
  if (Date.now() >= expiresAt) {
    delete cooldowns[apiKey]
    writeCooldowns(cooldowns)
    return false
  }
  return true
}

/** Advance the round-robin index and return the next key (whether or not it's cooling down). */
function roundRobin(keys: string[]): string {
  const raw = storage.get(ROTATION_KEY)
  const prev = Number(raw)
  const next = (Number.isFinite(prev) ? prev : 0) + 1
  storage.set(ROTATION_KEY, String(next))
  return keys[next % keys.length]
}

/**
 * Pick the next Gemini key to use.
 *
 * Returns a round-robin key that is NOT cooling down when one is available (spreads load +
 * routes around a key that just 429'd). When EVERY key is cooling down, returns a round-robin
 * key anyway (`exhausted: true`) so a single-key pool — or an all-busy moment — still makes the
 * call after the caller's backoff, instead of failing outright.
 */
export function pickGeminiKey(apiKeys: string[]): { key: string; exhausted: boolean } | null {
  const keys = apiKeys.map((k) => k.trim()).filter(Boolean)
  if (keys.length === 0) return null
  const available = keys.filter((k) => !isGeminiKeyCoolingDown(k))
  if (available.length > 0) {
    // Round-robin within the available set so concurrent calls fan out across keys.
    const raw = storage.get(ROTATION_KEY)
    const prev = Number(raw)
    const next = (Number.isFinite(prev) ? prev : 0) + 1
    storage.set(ROTATION_KEY, String(next))
    return { key: available[next % available.length], exhausted: false }
  }
  // Everything is cooling down — hand back a key anyway so the caller can retry after a backoff.
  return { key: roundRobin(keys), exhausted: true }
}

/** True when at least one key isn't cooling down (used for "another key to fail over to?"). */
export function hasFreshGeminiKey(apiKeys: string[]): boolean {
  return apiKeys.map((k) => k.trim()).filter(Boolean).some((k) => !isGeminiKeyCoolingDown(k))
}
