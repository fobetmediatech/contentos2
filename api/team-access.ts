/**
 * POST /api/team-access — admin-only. Two actions, both behind the same admin gate:
 *
 *   (default)     grant the finance role to a person by email   [admin only]
 *   grant-hr      grant the HR role to a person by email        [admin only]
 *   list-users    list workspace members (id + display label + email)   [admin or HR]
 *
 * Both need the Clerk *secret* key — resolving an email to a user id, and enumerating users,
 * are equally impossible from the browser — so they must happen server-side.
 *
 * Flow:
 *   1. Verify the Clerk session JWT (requireClerkUser).
 *   2. Confirm the CALLER is an admin by forwarding their token to Supabase is_admin() — done
 *      FIRST, before any Clerk lookup, so a non-admin can't use this as an email-enumeration oracle.
 *   3. Dispatch on action.
 *   4. (grant) Resolve the email via the Clerk Backend API (0 → not_found, >1 → ambiguous),
 *      then grant via admin_grant_finance() / admin_grant_hr() (each re-checks is_admin()).
 *
 * `list-users` lives here rather than in a new api/ file on purpose: Vercel's Hobby plan caps a
 * deployment at 12 Serverless Functions and every file in api/ is one. This endpoint already
 * holds the Clerk secret and the admin gate, so an action costs nothing where a file costs a slot.
 *
 * A body with no `action` takes the grant path unchanged — that is the shape the existing
 * TeamAccessPage caller sends, and it must keep working untouched.
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

  const body = req.body as { email?: unknown; action?: unknown } | undefined
  const action = typeof body?.action === 'string' ? body.action : ''

  // 1. Privilege gate FIRST — no enumeration oracle for unprivileged callers.
  //
  // Granting the finance role stays strictly admin. Listing members is also open to HR, who
  // need it to staff teams and assign work; both are trusted roles, so neither turns this into
  // a directory anyone signed in can scrape.
  const isAdmin = (await rpc('is_admin', token, {})).json === true
  const mayListUsers = isAdmin || (action === 'list-users' && (await rpc('is_hr', token, {})).json === true)
  if (action === 'list-users' ? !mayListUsers : !isAdmin) {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  // 2a. list-users — the assignee picker for Performance Management.
  // Returns only what a picker needs (id, display label, email). Never role or metadata.
  if (action === 'list-users') {
    try {
      const clerk = createClerkClient({ secretKey })
      const list = await clerk.users.getUserList({ limit: 200, orderBy: '-created_at' })
      const users = list.data.map((u) => {
        const email = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress
          ?? u.emailAddresses[0]?.emailAddress
          ?? null
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
        return { userId: u.id, label: name || u.username || email || u.id, email }
      })
      res.status(200).json({ users })
    } catch {
      res.status(502).json({ error: 'lookup_failed' })
    }
    return
  }

  // 2b. Validate input for the grant path.
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

  // 4. Grant the requested role (each RPC re-checks is_admin() — defence in depth).
  //
  // The role is chosen from a fixed pair here, never taken from the request body as a free
  // string: a role parameter would let an admin mint any role, including admin itself.
  const grantFn = action === 'grant-hr' ? 'admin_grant_hr' : 'admin_grant_finance'
  const grant = await rpc(grantFn, token, { target_user_id: targetId, target_label: email })
  if (!grant.ok) {
    res.status(500).json({ error: 'grant_failed' })
    return
  }

  res.status(200).json({ ok: true, userId: targetId, email })
}
