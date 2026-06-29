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

const EXEMPLAR_MAX_CHARS = 180

/**
 * Pull 2–4 short VERBATIM opener lines from the client's real samples (reel transcripts or pasted
 * scripts) to few-shot the rewrite. Openers carry the most voice signal (that's the hook), so we
 * take the first 1–2 sentences of each sample, trim, dedup, and cap. Pure + unit-tested.
 */
export function pickExemplars(samples: string[], max = 4): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of samples) {
    const clean = (s ?? '').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    // First 1–2 sentences; fall back to a leading chunk when there's no sentence punctuation.
    const m = clean.match(/^.*?[.!?](?:\s+.*?[.!?])?/)
    let line = (m ? m[0] : clean).trim()
    if (line.length < 12) line = clean // too short to be characteristic → keep the whole sample
    line = line.slice(0, EXEMPLAR_MAX_CHARS).trim()
    const key = line.toLowerCase()
    if (line && !seen.has(key)) {
      seen.add(key)
      out.push(line)
      if (out.length >= max) break
    }
  }
  return out
}

/** Stable, prefixed key for a pasted-scripts profile (same scripts → same key → reuse). */
export function scriptsProfileKey(scripts: string[]): string {
  const s = scripts.join('')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `__scripts__${(h >>> 0).toString(36)}`
}
