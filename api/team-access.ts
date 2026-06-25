/**
 * POST /api/team-access — admin-only: grant the finance role to a person by email.
 *
 * Resolving email → Clerk user id needs the Clerk *secret* key, so it must happen server-side.
 * Flow:
 *   1. Verify the Clerk session JWT (requireClerkUser).
 *   2. Confirm the CALLER is an admin by forwarding their token to Supabase is_admin() — done
 *      FIRST, before any Clerk lookup, so a non-admin can't use this as an email-enumeration oracle.
 *   3. Resolve the email via the Clerk Backend API (0 → not_found, >1 → ambiguous).
 *   4. Grant finance via admin_grant_finance() (the RPC re-checks is_admin() — defence in depth).
 *
 * No new secrets: reuses CLERK_SECRET_KEY + the Supabase URL/anon key already in the env.
 * The same Clerk session token is accepted by both our JWT gate and Supabase RLS, so forwarding
 * it lets the DB evaluate is_admin() against the real caller.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClerkClient } from '@clerk/backend'
import { requireClerkUser } from './_lib/auth.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

function bearer(req: VercelRequest): string {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

/** Call a Supabase Postgres function as the caller (their forwarded token drives RLS/auth.jwt()). */
async function rpc(fn: string, token: string, body: Record<string, unknown>): Promise<{ ok: boolean; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  let json: unknown = null
  try { json = await res.json() } catch { /* void RPC → empty body */ }
  return { ok: res.ok, json }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const user = await requireClerkUser(req, res)
  if (!user) return

  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey || !SUPABASE_URL || !SUPABASE_ANON) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const token = bearer(req)

  // 1. Admin gate FIRST — no enumeration oracle for non-admins.
  const adminCheck = await rpc('is_admin', token, {})
  if (adminCheck.json !== true) {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  // 2. Validate input.
  const body = req.body as { email?: unknown } | undefined
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) {
    res.status(400).json({ error: 'email required' })
    return
  }

  // 3. Resolve email → Clerk user.
  let matches: { id: string }[]
  try {
    const clerk = createClerkClient({ secretKey })
    const list = await clerk.users.getUserList({ emailAddress: [email] })
    matches = list.data
  } catch {
    res.status(502).json({ error: 'lookup_failed' })
    return
  }
  if (!matches || matches.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  if (matches.length > 1) {
    res.status(409).json({ error: 'ambiguous' })
    return
  }
  const targetId = matches[0].id

  // 4. Grant finance (RPC re-checks is_admin()).
  const grant = await rpc('admin_grant_finance', token, { target_user_id: targetId, target_label: email })
  if (!grant.ok) {
    res.status(500).json({ error: 'grant_failed' })
    return
  }

  res.status(200).json({ ok: true, userId: targetId, email })
}
