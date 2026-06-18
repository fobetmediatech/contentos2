/**
 * Parse an Instagram reel/post permalink into its shortCode + a canonical /reel/ URL.
 *
 * Accepts /reel/, /reels/, and /p/ paths (Instagram serves the same content under all
 * three). Tolerates missing scheme-host case, query strings, and a missing trailing
 * slash. Returns null when the input is not a recognisable IG post permalink.
 */
export interface ParsedReel {
  shortCode: string
  canonicalUrl: string
}

const PATH_RE = /\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/

export function parseReelUrl(input: string): ParsedReel | null {
  if (typeof input !== 'string') return null
  let host = ''
  let pathname = input
  try {
    const u = new URL(input)
    host = u.host
    pathname = u.pathname
  } catch {
    // Not a full URL — fall through and regex the raw string.
  }
  if (host && !/(^|\.)instagram\.com$/i.test(host)) return null
  const m = PATH_RE.exec(pathname)
  if (!m) return null
  const shortCode = m[1]
  return { shortCode, canonicalUrl: `https://www.instagram.com/reel/${shortCode}/` }
}

export function isReelUrl(input: string): boolean {
  return parseReelUrl(input) !== null
}
