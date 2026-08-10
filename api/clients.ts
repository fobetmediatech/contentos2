/**
 * POST /api/clients — admin-only. Client identity + sales-sheet import.
 *
 * This is the piece that makes everything else usable: until a client exists WITH a registered
 * email, every ingested transcript resolves to 'unmatched' (the join has nothing to match against)
 * and extraction has no clientId to run for.
 *
 * Importing the sales-sheet row does three jobs at once, which is why they live in one endpoint:
 *   - creates the client (identity)
 *   - registers the email (the transcript join key)
 *   - fills competitor/aspirational handles as provenance 'sheet'
 *
 * That last one matters: the generation pipeline hard-fails without at least one handle, and the
 * model is forbidden from authoring them (prompt, verifyExtraction, and a DB constraint all say so).
 * Without a sheet import, the handle slots can only ever be filled by typing.
 *
 * Actions: list | create | add-email | link-strategy | list-meetings | ingest-meeting
 *
 * The two meeting actions delegate to _lib/handlerIngest — merged here because Vercel's Hobby plan
 * caps a deployment at 12 Serverless Functions and every file in api/ counts as one.
 *
 * AUTH: the caller's own token is forwarded to PostgREST, so the admin-only RLS on the cb_ tables
 * evaluates against the real user. No service_role, so no new secret.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireClerkUser } from './_lib/auth.js'
import { mapSheetRow, type SheetRow } from './_lib/sheetRow.js'
import { handleIngest } from './_lib/handlerIngest.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

const bearer = (req: VercelRequest): string => {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

async function rest(
  path: string,
  token: string,
  init: { method: string; body?: unknown; prefer?: string },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  let json: unknown = null
  try { json = await res.json() } catch { /* 204 */ }
  return { ok: res.ok, status: res.status, json }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const user = await requireClerkUser(req, res)
  if (!user) return
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const token = bearer(req)
  // Signed-in is enough — this feature is open to the whole team (20260810000000).

  const body = req.body as {
    action?: unknown
    clientId?: unknown
    displayName?: unknown
    email?: unknown
    strategyId?: unknown
    sheet?: unknown
  } | undefined
  const action = typeof body?.action === 'string' ? body.action : ''

  // ---- Fireflies meetings (delegated; keeps its own admin gate) ---------------------------------
  if (action === 'list-meetings' || action === 'ingest-meeting') {
    return handleIngest(req, res)
  }

  // ---- list -----------------------------------------------------------------------------------
  if (action === 'list') {
    const r = await rest(
      'cb_clients?select=id,display_name,created_at,cb_client_emails(email)&order=created_at.desc',
      token,
      { method: 'GET' },
    )
    if (!r.ok) { res.status(502).json({ error: 'list_failed' }); return }
    res.status(200).json({ clients: r.json })
    return
  }

  // ---- create (+ optional sheet import) ---------------------------------------------------------
  if (action === 'create') {
    const sheet = (body?.sheet ?? {}) as SheetRow
    const mapped = mapSheetRow(sheet)

    const displayName =
      (typeof body?.displayName === 'string' && body.displayName.trim()) ||
      (typeof sheet.displayName === 'string' && sheet.displayName.trim()) ||
      (typeof sheet.fields?.brandName === 'string' && sheet.fields.brandName.trim()) ||
      ''
    if (!displayName) {
      res.status(400).json({ error: 'displayName required' })
      return
    }

    // Pre-check the emails. The unique index is the real guarantee (it wins any race), but
    // checking first means the common case fails BEFORE creating a client we'd have to clean up.
    if (mapped.emails.length > 0) {
      const list = mapped.emails.map((e) => `"${e}"`).join(',')
      const taken = await rest(
        `cb_client_emails?select=email,client_id&email=in.(${encodeURIComponent(list)})`,
        token,
        { method: 'GET' },
      )
      const rows = Array.isArray(taken.json) ? (taken.json as Array<{ email: string; client_id: string }>) : []
      if (rows.length > 0) {
        res.status(409).json({
          error: 'email_already_registered',
          conflicts: rows,
          hint: 'This address already identifies another client. Use add-email on that client, or fix the sheet.',
        })
        return
      }
    }

    const created = await rest('cb_clients', token, {
      method: 'POST',
      prefer: 'return=representation',
      body: [{ display_name: displayName }],
    })
    if (!created.ok) { res.status(502).json({ error: 'client_create_failed' }); return }
    const clientId = (created.json as Array<{ id: string }>)?.[0]?.id
    if (!clientId) { res.status(502).json({ error: 'client_create_no_id' }); return }

    // Emails next — they are the join key, so if this fails the client is useless. Remove it
    // rather than leaving an unreachable record behind.
    if (mapped.emails.length > 0) {
      const emailsRes = await rest('cb_client_emails', token, {
        method: 'POST',
        prefer: 'return=minimal',
        body: mapped.emails.map((email) => ({ client_id: clientId, email })),
      })
      if (!emailsRes.ok) {
        await rest(`cb_clients?id=eq.${clientId}`, token, { method: 'DELETE' })
        res.status(409).json({ error: 'email_insert_failed', detail: emailsRes.status })
        return
      }
    }

    // Sheet-sourced field values. Non-fatal if this fails: the client and its join key exist, and
    // an import can be retried without recreating identity.
    let sheetRowsWritten = 0
    if (mapped.rows.length > 0) {
      const ext = await rest('cb_extractions?on_conflict=client_id,field_name', token, {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: mapped.rows.map((r) => ({
          client_id: clientId,
          field_name: r.field_name,
          value: r.value,
          citations: r.citations,
          provenance: r.provenance,
          review_status: 'pending',
          updated_at: new Date().toISOString(),
        })),
      })
      if (ext.ok) sheetRowsWritten = mapped.rows.length
    }

    res.status(200).json({
      ok: true,
      clientId,
      displayName,
      emails: mapped.emails,
      sheetRowsWritten,
      // Surfaced, never silently swallowed — a sheet listing 7 competitors must not quietly become 5.
      droppedCompetitors: mapped.droppedCompetitors,
      droppedAspirational: mapped.droppedAspirational,
      handlesFilled: mapped.rows.filter((r) => r.field_name.includes('.')).length,
    })
    return
  }

  // ---- add-email --------------------------------------------------------------------------------
  // The person on the sales call is often not the person on the onboarding invite, so a client
  // legitimately accumulates addresses over time.
  if (action === 'add-email') {
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!clientId || !email.includes('@')) {
      res.status(400).json({ error: 'clientId and a valid email required' })
      return
    }
    const r = await rest('cb_client_emails', token, {
      method: 'POST',
      prefer: 'return=minimal',
      body: [{ client_id: clientId, email }],
    })
    if (!r.ok) {
      // The normalised-unique index rejects case/whitespace variants too.
      res.status(409).json({ error: 'email_taken_or_invalid', detail: r.status })
      return
    }
    res.status(200).json({ ok: true, clientId, email })
    return
  }

  // ---- link-strategy ----------------------------------------------------------------------------
  // Connects a client to an existing saved strategy. strategy_id is UNIQUE, so a strategy can
  // belong to at most one client — the constraint that stops two records drifting apart.
  if (action === 'link-strategy') {
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
    const strategyId = typeof body?.strategyId === 'string' ? body.strategyId.trim() : ''
    if (!clientId || !strategyId) {
      res.status(400).json({ error: 'clientId and strategyId required' })
      return
    }
    const r = await rest('cb_client_strategies', token, {
      method: 'POST',
      prefer: 'return=minimal',
      body: [{ client_id: clientId, strategy_id: strategyId }],
    })
    if (!r.ok) {
      res.status(409).json({ error: 'already_linked_or_invalid', detail: r.status })
      return
    }
    res.status(200).json({ ok: true, clientId, strategyId })
    return
  }

  res.status(400).json({
    error: 'unknown action',
    allowed: ['list', 'create', 'add-email', 'link-strategy', 'list-meetings', 'ingest-meeting'],
  })
}
