/**
 * GET /api/image-proxy?u=<encoded url> — proxy an Instagram CDN image.
 *
 * Instagram's profile-pic/thumbnail CDN blocks cross-origin <img> loads, so the browser can't
 * show creator photos directly. This fetches the image server-side and serves it same-origin.
 *
 * Locked to Instagram CDN hosts only (NOT an open proxy — that would be an SSRF risk). No Clerk
 * gate: it serves nothing but public, allow-listed image bytes. The client always renders an
 * initials-avatar fallback when this fails (missing/expired signed URL), so failures degrade cleanly.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'

const ALLOWED_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).end()
    return
  }
  const u = typeof req.query.u === 'string' ? req.query.u : ''
  let url: URL
  try {
    url = new URL(u)
  } catch {
    res.status(400).end()
    return
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) {
    res.status(400).end()
    return
  }
  try {
    const upstream = await fetch(url.toString(), { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!upstream.ok) {
      res.status(upstream.status).end()
      return
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    res.status(200).send(buf)
  } catch {
    res.status(502).end()
  }
}
