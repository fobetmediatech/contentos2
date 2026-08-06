/**
 * FOBET strategy deck — slot filling over the raw HTML template.
 *
 * ponytail: the template is the designer's HTML, unmodified. Slots key off the placeholder TEXT
 * inside each `.fill` element (a <span> on most, a <b> in the cover meta block), so there is no
 * parallel id scheme to keep in sync and the
 * .html file stays something you can open in a browser. A test asserts every mapped placeholder
 * occurs exactly once — if a future edit duplicates one, that fails rather than silently filling
 * the wrong span.
 *
 * Only slots we can actually source are mapped. The rest (reference reel links, pricing, phone,
 * the section-02 questions) stay as dashed blanks, which is what the design intends — they are
 * filled in live on the call.
 */
import template from '../deck/fobetDeck.html?raw'
import type { StrategyBrief } from '../domain/strategy'

/** slot key -> the exact placeholder text in the template. */
export const SLOTS = {
  // --- from the brief / extractions, no model involved ---
  preparedFor: 'Client name, brand',
  monthYear: 'MONTH YEAR',
  platforms: 'Instagram, YouTube',
  whatYouSell: 'product or service',
  highestMarginOffer: 'offer',
  audienceProfile: '28 to 45, salaried, tier 1',
  neverSay: 'topics',
  language: 'Hinglish, English, Hindi',
  category: 'category',
  competitorDate: 'date',
  travelCity: 'city',

  // --- written by the model ---
  positioningRole: 'role',
  positioningOutcome: 'specific outcome',
  positioningAudience: 'specific audience',
  buyerPain: 'pain',
  buyerObjection: 'objection',
  whatTheyAllDo: 'what they all do',
  theGap: 'the gap',
  whoYouHelp: 'One line on who you help',
  proofLine: 'One line of proof or credential',
  freeResource: 'Free resource, link below',
} as const

export type SlotKey = keyof typeof SLOTS

/** Slots the model must write. Everything else comes from data we already hold. */
export const AI_SLOTS: SlotKey[] = [
  'positioningRole', 'positioningOutcome', 'positioningAudience',
  'buyerPain', 'buyerObjection', 'whatTheyAllDo', 'theGap',
  'whoYouHelp', 'proofLine', 'freeResource',
]

export const rawTemplate = (): string => template

/** The template uses <span class="fill"> in body copy and <b class="fill"> in the cover meta. */
export const slotPattern = (placeholder: string): RegExp =>
  new RegExp(`<(span|b) class="fill">${placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</\\1>`, 'g')

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Replace filled slots. A filled slot loses the dashed `.fill` styling so a real value reads as a
 * value; anything left unfilled keeps the blank, which is how a reviewer spots what is still missing.
 */
export function fillDeck(values: Partial<Record<SlotKey, string>>): string {
  let html = template

  for (const [key, placeholder] of Object.entries(SLOTS) as Array<[SlotKey, string]>) {
    const value = values[key]?.trim()
    if (!value) continue
    html = html.replace(slotPattern(placeholder), `<strong>${escapeHtml(value)}</strong>`)
  }

  // The cover headline is an <em>, not a .fill span.
  if (values.preparedFor) html = html.replace('[Client Name]', escapeHtml(values.preparedFor))

  return html
}

/** Slots derivable from the brief — everything here skips the model entirely. */
export function slotsFromBrief(brief: StrategyBrief, now: Date): Partial<Record<SlotKey, string>> {
  const month = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
  return {
    preparedFor: brief.brandName || undefined,
    monthYear: month,
    whatYouSell: brief.subNiche || undefined,
    highestMarginOffer: brief.offer || undefined,
    audienceProfile: brief.audience || undefined,
    neverSay: brief.offLimits || undefined,
    language: brief.language,
    category: brief.primaryNiche || undefined,
    competitorDate: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
  }
}
