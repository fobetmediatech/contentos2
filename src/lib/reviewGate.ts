/**
 * Review gate + brief assembly — pure, so it is unit-tested directly.
 *
 * THE SEAM. `buildBriefFromExtractions` turns reviewed extractions into a plain StrategyBrief, which
 * is exactly what a human typing into the form produces. Nothing downstream can tell the difference,
 * and the 4-stage generation pipeline is not touched: it still receives a brief and runs when a
 * human presses Generate.
 *
 * THE GATE blocks handing the brief over while it would fail or mislead. Every rule below is
 * grounded in real code rather than invented:
 *   - brandName + offer are the form's own Generate gate (StrategyPage.tsx:156)
 *   - at least one handle is the PIPELINE's separate gate (useContentStrategy.ts:93) — the one that
 *     is easy to miss, because the form's button looks satisfied while generation still fails
 *   - unreviewed 'inferred' values are our judgment, not the client's words, so they need sign-off
 *     before they can shape a deck
 */
import { EMPTY_BRIEF, type StrategyBrief, type ContentLanguage } from '../domain/strategy'

export type Provenance = 'extracted' | 'inferred' | 'sheet' | 'scraped'
export type ReviewStatus = 'pending' | 'approved' | 'edited' | 'rejected'

export interface Citation {
  chunk_id: string
  quote: string
  start_sec: number | null
}

export interface ExtractionRow {
  id: string
  fieldName: string
  value: string | null
  citations: Citation[]
  provenance: Provenance
  confidence: number | null
  reviewStatus: ReviewStatus
  originalValue: string | null
}

export const COMPETITOR_SLOTS = 5
export const ASPIRATIONAL_SLOTS = 4

const isLanguage = (v: string): v is ContentLanguage =>
  v === 'english' || v === 'hindi' || v === 'hinglish'

/** Rejected values are treated as absent — a reviewer said no, so it must not reach the brief. */
const liveValue = (r: ExtractionRow): string | null =>
  r.reviewStatus === 'rejected' ? null : (r.value?.trim() || null)

/**
 * Extractions → StrategyBrief. Unset fields keep EMPTY_BRIEF's defaults, so the result is always a
 * complete, valid brief shape even from a half-filled review.
 */
export function buildBriefFromExtractions(rows: ExtractionRow[]): StrategyBrief {
  const brief: StrategyBrief = {
    ...EMPTY_BRIEF,
    competitors: [...EMPTY_BRIEF.competitors],
    aspirational: [...EMPTY_BRIEF.aspirational],
    theme: { ...EMPTY_BRIEF.theme },
  }

  for (const r of rows) {
    const v = liveValue(r)
    if (v === null) continue

    const handle = r.fieldName.match(/^(competitors|aspirational)\.(\d+)$/)
    if (handle) {
      const [, kind, idxRaw] = handle
      const idx = Number(idxRaw)
      const slots = kind === 'competitors' ? COMPETITOR_SLOTS : ASPIRATIONAL_SLOTS
      if (idx >= 0 && idx < slots) {
        if (kind === 'competitors') brief.competitors[idx] = v
        else brief.aspirational[idx] = v
      }
      continue
    }

    switch (r.fieldName) {
      case 'brandName': brief.brandName = v; break
      case 'primaryNiche': brief.primaryNiche = v; break
      case 'subNiche': brief.subNiche = v; break
      case 'offer': brief.offer = v; break
      case 'audience': brief.audience = v; break
      case 'brandColors': brief.brandColors = v; break
      case 'dislikes': brief.dislikes = v; break
      case 'offLimits': brief.offLimits = v; break
      // Anything unrecognised is ignored rather than guessed at — an unknown field name means the
      // form changed and this code has not caught up.
      case 'language': if (isLanguage(v)) brief.language = v; break
      default: break
    }
  }

  return brief
}

export interface GateBlocker {
  code: 'missing_required' | 'no_handles' | 'unreviewed_inferred'
  message: string
  /** Field names a reviewer should jump to. */
  fields: string[]
}

export interface GateResult {
  blocked: boolean
  blockers: GateBlocker[]
}

export function evaluateGate(rows: ExtractionRow[]): GateResult {
  const brief = buildBriefFromExtractions(rows)
  const blockers: GateBlocker[] = []

  const missing: string[] = []
  if (!brief.brandName.trim()) missing.push('brandName')
  if (!brief.offer.trim()) missing.push('offer')
  if (missing.length > 0) {
    blockers.push({
      code: 'missing_required',
      message: `Required ${missing.length === 1 ? 'field is' : 'fields are'} empty`,
      fields: missing,
    })
  }

  // The pipeline's own gate. The form's Generate button does NOT check this, so without surfacing
  // it here a reviewer sees a complete form, presses Generate, and gets an error instead.
  const hasHandle =
    brief.competitors.some((h) => h.trim()) || brief.aspirational.some((h) => h.trim())
  if (!hasHandle) {
    blockers.push({
      code: 'no_handles',
      message: 'Generation needs at least one competitor or aspirational handle — these come from the sales sheet',
      fields: ['competitors.0'],
    })
  }

  const unreviewed = rows.filter(
    (r) => r.provenance === 'inferred' && liveValue(r) !== null && r.reviewStatus === 'pending',
  )
  if (unreviewed.length > 0) {
    blockers.push({
      code: 'unreviewed_inferred',
      message: `${unreviewed.length} inferred ${unreviewed.length === 1 ? 'value needs' : 'values need'} sign-off`,
      fields: unreviewed.map((r) => r.fieldName),
    })
  }

  return { blocked: blockers.length > 0, blockers }
}

/** Rows an "approve all extracted" action should flip — never touches inferred. */
export const approvableRows = (rows: ExtractionRow[]): ExtractionRow[] =>
  rows.filter(
    (r) =>
      (r.provenance === 'extracted' || r.provenance === 'sheet') &&
      r.reviewStatus === 'pending' &&
      liveValue(r) !== null,
  )
