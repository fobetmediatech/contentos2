/**
 * Script Studio field references — identifies one single-string slot of a generated script
 * so the page/panel can regenerate or update just that field. Pure + unit-tested.
 */
import type { ReelRewriteResult } from '../ai/prompts/reelRewrite'

export type FieldRef =
  | { kind: 'hook' }
  | { kind: 'caption' }
  | { kind: 'cta' }
  | { kind: 'beatScript'; i: number }
  | { kind: 'beatOverlay'; i: number }
  | { kind: 'onScreen'; j: number }

/** Stable id for a field (used to mark which regen is in-flight). */
export function fieldKey(f: FieldRef): string {
  switch (f.kind) {
    case 'beatScript': return `beatScript:${f.i}`
    case 'beatOverlay': return `beatOverlay:${f.i}`
    case 'onScreen': return `onScreen:${f.j}`
    default: return f.kind
  }
}

/** Human label passed to the regen prompt. */
export function fieldLabel(f: FieldRef): string {
  switch (f.kind) {
    case 'hook': return 'the spoken hook'
    case 'caption': return 'the caption'
    case 'cta': return 'the call-to-action'
    case 'beatScript': return `beat ${f.i + 1}'s spoken line`
    case 'beatOverlay': return `beat ${f.i + 1}'s on-screen overlay`
    case 'onScreen': return `on-screen text line ${f.j + 1}`
  }
}

/** Immutably write a new value into the targeted slot. */
export function applyFieldValue(r: ReelRewriteResult, f: FieldRef, value: string): ReelRewriteResult {
  switch (f.kind) {
    case 'hook': return { ...r, spokenHook: value }
    case 'caption': return { ...r, caption: value }
    case 'cta': return { ...r, cta: value }
    case 'beatScript':
      return { ...r, beatScript: r.beatScript.map((b, i) => (i === f.i ? { ...b, script: value } : b)) }
    case 'beatOverlay':
      return { ...r, beatScript: r.beatScript.map((b, i) => (i === f.i ? { ...b, onScreenText: value } : b)) }
    case 'onScreen':
      return { ...r, onScreenText: r.onScreenText.map((t, j) => (j === f.j ? value : t)) }
  }
}
