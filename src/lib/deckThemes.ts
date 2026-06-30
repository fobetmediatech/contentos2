/**
 * Deck themes — per-client palettes for the Content Strategy slide deck.
 *
 * A preset sets the base palette; the client's brand color (a hex in the brief's brandColors,
 * or theme.accent) overrides the accent. Resolved to a flat color set + CSS custom properties
 * the StrategyDeck spreads onto its wrapper, so one renderer styles every theme — and re-themes
 * instantly (presentation only, no regeneration).
 */
import type { DeckPreset, StrategyBrief } from '../domain/strategy'

export interface DeckColors {
  bg: string
  surface: string
  text: string
  muted: string
  accent: string
  accentText: string
  divider: string
}

export const PRESET_LABELS: Record<DeckPreset, string> = {
  'black-gold': 'Black + Gold',
  'cream-yellow': 'Cream + Yellow',
  chai: 'Chai Dark',
  light: 'Light',
}

const PRESETS: Record<DeckPreset, DeckColors> = {
  'black-gold': { bg: '#0A0A0A', surface: '#1A1212', text: '#F5F5F5', muted: '#B8B0A8', accent: '#C9A227', accentText: '#0A0A0A', divider: 'rgba(255,255,255,0.12)' },
  'cream-yellow': { bg: '#F0EFEA', surface: '#FFFFFF', text: '#1A1410', muted: '#6B6258', accent: '#F2C53D', accentText: '#1A1410', divider: 'rgba(0,0,0,0.12)' },
  chai: { bg: '#1A1410', surface: '#2C2218', text: '#F5EDD6', muted: '#C4A882', accent: '#E07B3A', accentText: '#FFFFFF', divider: 'rgba(245,237,214,0.12)' },
  light: { bg: '#FFFFFF', surface: '#F7F6F3', text: '#1C1C1C', muted: '#6B6B6B', accent: '#2563EB', accentText: '#FFFFFF', divider: 'rgba(0,0,0,0.10)' },
}

const isHex = (s: string): boolean => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim())

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
export const alpha = (hex: string, a: number): string => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})` }

/** A small palette derived from one accent (for multi-series charts like the format-mix donut). */
export function shades(hex: string, count: number): string[] {
  const steps = [1, 0.7, 0.45, 0.28, 0.18]
  return Array.from({ length: count }, (_, i) => alpha(hex, steps[i] ?? 0.15))
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b)
  const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`
}

/** Pick readable text (black/white) for a given background. */
function contrastText(hex: string): string {
  const [r, g, b] = rgb(hex)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1A1410' : '#FFFFFF'
}

/** Resolve a brief's preset + typed custom background/accent into a coherent color set. */
export function resolveDeckColors(brief: StrategyBrief): DeckColors {
  let colors: DeckColors = { ...(PRESETS[brief.theme?.preset] ?? PRESETS['black-gold']) }

  // Custom background (typed hex) — derive surface/muted/divider + auto-contrast text.
  const bg = (brief.theme?.bg ?? '').trim()
  if (isHex(bg)) {
    const text = contrastText(bg)
    colors = { ...colors, bg, text, surface: mix(bg, text, 0.08), muted: alpha(text, 0.62), divider: alpha(text, 0.16) }
  }

  // Accent (typed hex, or the brand color).
  const accentSource = (brief.theme?.accent || brief.brandColors || '').trim()
  if (isHex(accentSource)) {
    colors = { ...colors, accent: accentSource, accentText: contrastText(accentSource) }
  }

  return colors
}

/** CSS custom properties for the deck wrapper's inline style. */
export function themeVars(c: DeckColors): Record<string, string> {
  return {
    '--dk-bg': c.bg,
    '--dk-surface': c.surface,
    '--dk-text': c.text,
    '--dk-muted': c.muted,
    '--dk-accent': c.accent,
    '--dk-accent-text': c.accentText,
    '--dk-divider': c.divider,
  }
}
