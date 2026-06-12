/**
 * Shared Clerk JWT gate for Vercel serverless handlers.
 *
 * Fails closed:
 *   - CLERK_SECRET_KEY unset → 500 (misconfigured server)
 *   - Missing or invalid Bearer token → 401
 *
 * Returns { userId } on success; sends the error response and returns null on failure.
 * Callers must return immediately when null is returned.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyToken } from '@clerk/backend'

export async function requireClerkUser(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ userId: string } | null> {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY
  if (!clerkSecretKey) {
    res.status(500).json({ error: 'Server not configured' })
    return null
  }
  const authHeader = req.headers.authorization ?? ''
  const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!sessionToken) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  try {
    const payload = await verifyToken(sessionToken, { secretKey: clerkSecretKey })
    return { userId: payload.sub }
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
}
