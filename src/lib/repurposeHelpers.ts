/** Pure helpers for the repurpose pipeline (kept out of the hook so they're unit-testable). */

const SCRIPT_CORPUS_CAP = 4000

/** Join + sanitize pasted scripts into one prompt-safe corpus, capped to avoid prompt bloat. */
export function prepareScriptCorpus(scripts: string[]): string {
  const joined = scripts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('\n\n---\n\n')
  return joined.slice(0, SCRIPT_CORPUS_CAP)
}

/** Stable, prefixed key for a pasted-scripts profile (same scripts → same key → reuse). */
export function scriptsProfileKey(scripts: string[]): string {
  const s = scripts.join('')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `__scripts__${(h >>> 0).toString(36)}`
}
