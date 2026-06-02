/**
 * Location filter for the discovery pipeline.
 *
 * After profile scraping, filters candidates to those with a detectable
 * city signal in their biography or display name.
 *
 * Filter logic — differentiated by account type:
 *   Creator accounts (isBusinessAccount: false):
 *     1. Bio contains target city → pass (confirmed)
 *     2. Bio contains a known OTHER city → fail (wrong city)
 *     3. No city signal in bio → pass (assumed local; found under city hashtags)
 *   Business accounts:
 *     1. Bio contains target city → pass
 *     2. Display name (fullName) contains target city → pass
 *     3. Otherwise → fail (businesses reliably name their city if local)
 *
 * Relaxation rule (per design doc):
 *   If fewer than MIN_RESULTS candidates pass, the filter is relaxed and ALL
 *   candidates are returned. The caller renders a UI note when this happens.
 */

import type { NormalizedProfile } from './transformers'

// Minimum survivors before the filter is relaxed
const MIN_RESULTS = 15

// ----- City aliases map -----
// Maps canonical city name → alternative spellings / abbreviations.
// Covers India top-10 metros + global aliases added on demand.
const CITY_ALIASES: Record<string, string[]> = {
  mumbai: ['bombay'],
  bangalore: ['bengaluru', 'blr', 'bangalorean'],
  delhi: ['new delhi', 'ncr', 'delhi ncr', 'dilli'],
  kolkata: ['calcutta'],
  hyderabad: ['hyd', 'cyberabad'],
  chennai: ['madras'],
  pune: ['poona'],
  ahmedabad: ['amdavad'],
  jaipur: ['pink city'],
  lucknow: ['nawabi city'],
  // Global cities
  'new york': ['nyc', 'new york city', 'ny'],
  'los angeles': ['la', 'socal'],
  london: ['ldn'],
  dubai: ['dxb'],
  singapore: ['sg', 'sgp'],
  toronto: ['yyz'],
  sydney: ['syd'],
}

/**
 * Build the full set of terms to search for a given city.
 * Returns city name + all known aliases, all lowercased.
 */
function getCityTerms(city: string): string[] {
  const normalized = city.trim().toLowerCase()
  const aliases = CITY_ALIASES[normalized] ?? []
  return [normalized, ...aliases]
}

/**
 * Build all city terms for every city EXCEPT the target.
 * Used to detect creator bios that name a different city (wrong-city rejection).
 */
function getAllOtherCityTerms(city: string): string[] {
  const targetNormalized = city.trim().toLowerCase()
  const result: string[] = []
  for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
    if (canonical !== targetNormalized && !aliases.includes(targetNormalized)) {
      result.push(canonical, ...aliases)
    }
  }
  return result
}

/**
 * Check if a text field contains any of the city terms.
 */
function textContainsCitySignal(text: string, cityTerms: string[]): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return cityTerms.some((term) => lower.includes(term))
}

// ----- Public API -----

export interface FilterResult {
  filtered: NormalizedProfile[]
  /** true if the filter was relaxed (too few candidates survived) */
  relaxed: boolean
  /** Count that passed before relaxation check */
  passedCount: number
}

/**
 * Filter profiles by city signal in bio or business address.
 *
 * @param profiles  Candidate profiles to filter
 * @param city      Target city (e.g. "Mumbai")
 * @returns         FilterResult with filtered profiles + relaxed flag
 */
export function filterByLocation(
  profiles: NormalizedProfile[],
  city: string,
): FilterResult {
  const cityTerms = getCityTerms(city)
  const otherCityTerms = getAllOtherCityTerms(city)

  const passed = profiles.filter((profile) => {
    // --- Creator accounts: pass unless bio names a different city ---
    if (!profile.isBusinessAccount) {
      if (textContainsCitySignal(profile.biography, cityTerms)) return true
      if (textContainsCitySignal(profile.biography, otherCityTerms)) return false
      return true  // no city signal → assumed local (found under city-specific hashtags)
    }

    // --- Business accounts: confirm the city in bio or display name ---
    // H8: the old businessAddress branch was dead — the scraper never populates that
    // field. fullName is reliably populated and local businesses often carry the city
    // in their name (e.g. "Mumbai Pizza Co"), so this recovers matches the dead branch
    // never could, without guessing an Apify field.
    if (textContainsCitySignal(profile.biography, cityTerms)) return true
    if (textContainsCitySignal(profile.fullName, cityTerms)) return true
    return false
  })

  const passedCount = passed.length

  // Relaxation: if too few candidates survive, return all (with a note flag)
  if (passedCount < MIN_RESULTS) {
    console.warn(
      `[locationFilter] Only ${passedCount} profiles matched city "${city}" (aliases: ${cityTerms.slice(1).join(', ')}) — relaxing filter, returning all ${profiles.length} candidates`,
    )
    return { filtered: profiles, relaxed: true, passedCount }
  }

  console.log(`[locationFilter] ${passedCount}/${profiles.length} profiles matched city "${city}"`)
  return { filtered: passed, relaxed: false, passedCount }
}
