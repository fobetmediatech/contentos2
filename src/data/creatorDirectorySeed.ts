/**
 * Starter creator directory (Script Studio → Choose a creator).
 *
 * ⚠️ HANDLES ARE AI-SUGGESTED — VERIFY before relying on them. A wrong @handle makes the
 * voice-profile scrape return nothing. Fix/extend via the in-app editor (anyone can edit).
 * These are Instagram handles (voice profiles are synthesized from IG reels).
 */
import { directoryId, type DirectoryEntry } from '../lib/creatorDirectory'

const seed: Array<{ category: string; handle: string; displayName: string }> = [
  // Tech
  { category: 'tech', handle: 'mkbhd', displayName: 'Marques Brownlee' },
  { category: 'tech', handle: 'mrwhosetheboss', displayName: 'Arun Maini' },
  { category: 'tech', handle: 'unboxtherapy', displayName: 'Unbox Therapy' },
  { category: 'tech', handle: 'austinevans', displayName: 'Austin Evans' },
  // Business
  { category: 'business', handle: 'garyvee', displayName: 'Gary Vaynerchuk' },
  { category: 'business', handle: 'hormozi', displayName: 'Alex Hormozi' },
  { category: 'business', handle: 'thedankoe', displayName: 'Dan Koe' },
  { category: 'business', handle: 'codiesanchez', displayName: 'Codie Sanchez' },
  // Fitness
  { category: 'fitness', handle: 'jeffnippard', displayName: 'Jeff Nippard' },
  { category: 'fitness', handle: 'chrisheria', displayName: 'Chris Heria' },
  { category: 'fitness', handle: 'mrandmrsmuscle', displayName: 'Mr & Mrs Muscle' },
  { category: 'fitness', handle: 'syattfitness', displayName: 'Jordan Syatt' },
  // Finance
  { category: 'finance', handle: 'humphreytalks', displayName: 'Humphrey Yang' },
  { category: 'finance', handle: 'herfirst100k', displayName: 'Tori Dunlap' },
  { category: 'finance', handle: 'personalfinanceclub', displayName: 'Personal Finance Club' },
  // Food
  { category: 'food', handle: 'joshuaweissman', displayName: 'Joshua Weissman' },
  { category: 'food', handle: 'thefoodranger', displayName: 'The Food Ranger' },
  { category: 'food', handle: 'nick.digiovanni', displayName: 'Nick DiGiovanni' },
  // Comedy
  { category: 'comedy', handle: 'zachking', displayName: 'Zach King' },
  { category: 'comedy', handle: 'kingbach', displayName: 'King Bach' },
  { category: 'comedy', handle: 'brentrivera', displayName: 'Brent Rivera' },
]

export const DIRECTORY_SEED: DirectoryEntry[] = seed.map((e) => ({
  id: directoryId(e.category, e.handle),
  category: e.category,
  handle: e.handle,
  displayName: e.displayName,
}))
