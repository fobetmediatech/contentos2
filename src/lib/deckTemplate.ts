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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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

// ---------------------------------------------------------------------------------------------
// Section 04 — the competitor table
// ---------------------------------------------------------------------------------------------

export interface CompetitorRow {
  username: string
  followers: number
  /** MEDIAN views from the reel benchmarks — not a mean. The header is relabelled to match. */
  medianViews: number | null
  engagementRate: number | null
  /** Dominant hook patterns, which is the closest real signal we have to "their top formats". */
  formats: string[]
}

const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n)

/** A blank a strategist must fill, styled like every other unfilled slot in the template. */
const BLANK = (label: string) => `<span class="fill">${label}</span>`

/**
 * Replace the hardcoded @competitor_1..4 rows with the accounts actually analysed.
 *
 * TWO COLUMNS STAY BLANK ON PURPOSE. "Posts / week" is not something the pipeline measures, and
 * "What they are missing" is a judgment nobody has made yet. Filling either with a plausible guess
 * would put invented numbers in front of a client — the whole point of this table is that the other
 * four columns are real.
 *
 * The "Avg views" header is rewritten to "Median views" because that is what the number is.
 */
export function fillCompetitorTable(html: string, rows: CompetitorRow[]): string {
  if (rows.length === 0) return html

  const body = rows
    .map((r) => {
      const er = r.engagementRate == null ? '' : ` <span class="muted">(${r.engagementRate.toFixed(1)}% ER)</span>`
      return (
        '<tr>' +
        `<td><b>@${escapeHtml(r.username)}</b></td>` +
        `<td>${compact(r.followers)}${er}</td>` +
        `<td>${r.medianViews == null ? BLANK('no reels analysed') : compact(r.medianViews)}</td>` +
        `<td>${BLANK('n')}</td>` +
        `<td>${r.formats.length ? escapeHtml(r.formats.slice(0, 2).join(', ')) : BLANK('formats')}</td>` +
        `<td>${BLANK('the gap')}</td>` +
        '</tr>'
      )
    })
    .join('')

  return html
    .replace(/<th>Avg views<\/th>/, '<th>Median views</th>')
    .replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>${body}</tbody>`)
    // The four screenshot placeholders name the accounts we actually analysed.
    .replace(/<div class="shot">SCREENSHOT<br>@competitor_(\d)<br>(top reel|profile grid)<\/div>/g,
      (full, n: string, kind: string) => {
        const row = rows[Number(n) - 1]
        return row
          ? `<div class="shot">SCREENSHOT<br>@${escapeHtml(row.username)}<br>${kind}</div>`
          : full
      })
}
