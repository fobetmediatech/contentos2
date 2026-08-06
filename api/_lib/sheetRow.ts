/**
 * Sales-sheet row → cb_extractions rows (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Pure, so it is unit-tested directly.
 *
 * Everything here lands with provenance 'sheet': copied verbatim from the sales sheet, no model
 * involved, no citations (the sheet is the source, there is no transcript chunk to point at). The
 * DB only demands citations for provenance 'extracted', so these rows are storable as-is.
 *
 * WHY HANDLES COME FROM HERE: the generation pipeline hard-fails without at least one competitor or
 * aspirational handle, and clients do not name Instagram handles on a call — they say "there's a
 * guy in Sector 57 doing well". So sales captures handles during the sales call, and the model is
 * forbidden (in the prompt, in verifyExtraction, and by a DB constraint) from ever authoring one.
 *
 * POSITIONAL ARRAYS: competitors is length 5 and aspirational length 4 in StrategyBrief, and each
 * slot is its own extraction row so per-item provenance survives — competitor 1 may come from the
 * sheet while competitor 3 was someone's own research later. Overflow is DROPPED and COUNTED, never
 * silently truncated: a sheet listing 7 competitors must not quietly become 5.
 */

export const COMPETITOR_SLOTS = 5
export const ASPIRATIONAL_SLOTS = 4

/** Scalar brief fields a sheet may carry. Mirrors StrategyBrief minus handles and theme. */
export const SHEET_SCALAR_FIELDS = [
  'brandName',
  'primaryNiche',
  'subNiche',
  'offer',
  'language',
  'audience',
  'brandColors',
  'dislikes',
  'offLimits',
] as const

export type SheetScalarField = (typeof SHEET_SCALAR_FIELDS)[number]

export interface SheetRow {
  displayName?: string
  emails?: string[]
  competitors?: string[]
  aspirational?: string[]
  fields?: Partial<Record<SheetScalarField, string>>
}

export interface SheetExtractionRow {
  field_name: string
  value: string
  provenance: 'sheet'
  citations: []
}

export interface SheetMapResult {
  rows: SheetExtractionRow[]
  emails: string[]
  /** Handles beyond the fixed slot count. Reported so a caller can warn rather than lose them. */
  droppedCompetitors: string[]
  droppedAspirational: string[]
}

/**
 * Instagram handles arrive inconsistently: "@name", "name", or a profile URL. Normalise to a bare
 * handle so the same account is not stored three ways across clients.
 */
export function normaliseHandle(raw: string): string {
  let h = raw.trim()
  if (!h) return ''
  const urlMatch = h.match(/instagram\.com\/([^/?#]+)/i)
  if (urlMatch) h = urlMatch[1]
  h = h.replace(/^@+/, '').trim()
  return h.replace(/\/+$/, '')
}

const cleanEmail = (raw: string): string => raw.trim().toLowerCase()

export function mapSheetRow(row: SheetRow): SheetMapResult {
  const rows: SheetExtractionRow[] = []

  // --- scalar fields ---
  for (const field of SHEET_SCALAR_FIELDS) {
    const v = row.fields?.[field]
    if (typeof v !== 'string') continue
    const value = v.trim()
    if (!value) continue
    rows.push({ field_name: field, value, provenance: 'sheet', citations: [] })
  }

  // --- positional handles ---
  const packHandles = (
    input: string[] | undefined,
    prefix: 'competitors' | 'aspirational',
    slots: number,
  ): string[] => {
    const cleaned = (input ?? [])
      .map((h) => (typeof h === 'string' ? normaliseHandle(h) : ''))
      .filter(Boolean)
    // De-dupe case-insensitively: the same account listed twice would otherwise burn two slots.
    const seen = new Set<string>()
    const unique = cleaned.filter((h) => {
      const k = h.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

    unique.slice(0, slots).forEach((handle, i) => {
      rows.push({ field_name: `${prefix}.${i}`, value: handle, provenance: 'sheet', citations: [] })
    })
    return unique.slice(slots)
  }

  const droppedCompetitors = packHandles(row.competitors, 'competitors', COMPETITOR_SLOTS)
  const droppedAspirational = packHandles(row.aspirational, 'aspirational', ASPIRATIONAL_SLOTS)

  const emails = [...new Set((row.emails ?? []).map(cleanEmail).filter((e) => e.includes('@')))]

  return { rows, emails, droppedCompetitors, droppedAspirational }
}
