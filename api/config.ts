/**
 * GET /api/config — server configuration status.
 *
 * Returns boolean flags indicating whether each third-party service is configured.
 * Never returns key material — only readiness signals that the client uses to
 * decide whether the UI should allow pipeline execution.
 *
 * Gate: Clerk session JWT (same as all other api/ endpoints).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './_lib/auth.js'

function hasGeminiKeys(): boolean {
  const keys = [
    ...String(process.env.GEMINI_API_KEY ?? '').split(','),
    ...String(process.env.GEMINI_KEYS ?? '').split(','),
  ].filter((k) => k.trim())
  return keys.length > 0
}

function hasApifyKeys(): boolean {
  const keys = [
    ...Array.from({ length: 10 }, (_, i) => process.env[`APIFY_KEY_${i + 1}`] ?? ''),
    ...String(process.env.APIFY_KEYS ?? '').split(','),
  ].filter((k) => k.trim())
  return keys.length > 0
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const user = await requireClerkUser(req, res)
  if (!user) return

  res.status(200).json({
    geminiReady: hasGeminiKeys(),
    apifyReady: hasApifyKeys(),
  })
}
