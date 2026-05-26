/**
 * Location filter for the discovery pipeline.
 *
 * After profile scraping, filters candidates to those with a detectable
 * city signal in their biography or business address.
 *
 * Filter logic (any match = pass):
 *   1. biography contains city name (case-insensitive)
 *   2. biography contains any known city alias
 *   3. businessAddress contains city name (if available)
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
 * Check if a text field contains any of the city terms.
 */
function textContainsCitySignal(text: string, cityTerms: string[]): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return cityTerms.some((term) => lower.includes(term))
}

// ----- Raw profile extension for businessAddress -----
// The Apify Profile Scraper may return businessAddress — not in NormalizedProfile
// but accessible via the profile's biography field in practice.
// We check it via a duck-typed extension here to avoid changing transformers.ts.

type ProfileWithAddress = NormalizedProfile & { businessAddress?: string }

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

  const passed = profiles.filter((p) => {
    const profile = p as ProfileWithAddress

    // Check biography (primary signal — almost always populated)
    if (textContainsCitySignal(profile.biography, cityTerms)) return true

    // Check businessAddress if available (secondary signal)
    if (profile.businessAddress && textContainsCitySignal(profile.businessAddress, cityTerms)) return true

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
