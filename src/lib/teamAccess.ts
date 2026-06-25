/**
 * Team Access data layer — finance-role administration (admin only).
 *
 * Reads go through Supabase directly (RLS allows any authenticated user to READ member_roles).
 * Writes are gated:
 *   - revoke  → admin_revoke_finance RPC (SECURITY DEFINER, self-checks is_admin)
 *   - grant   → /api/team-access (server resolves email→Clerk id with the secret key, then grants)
 *   - break_glass → recovery RPC, grants the caller admin if the secret code matches
 */
import { supabase } from './supabaseClient'
import { getClerkSessionToken } from './clerkToken'

export interface FinanceMember {
  userId: string
  label: string | null
  createdAt: string | null
}

export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin')
  if (error) return false
  return data === true
}

export async function listFinanceMembers(): Promise<FinanceMember[]> {
  const { data, error } = await supabase
    .from('member_roles')
    .select('user_id, label, created_at')
    .eq('role', 'finance')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      userId: row.user_id as string,
      label: (row.label as string | null) ?? null,
      createdAt: (row.created_at as string | null) ?? null,
    }
  })
}

export async function revokeFinance(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke_finance', { target_user_id: userId })
  if (error) throw error
}

/** Break-glass: grant the current signed-in user admin if the recovery code matches. */
export async function breakGlass(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('break_glass', { code })
  if (error) return false
  return data === true
}

export type GrantReason = 'not_found' | 'ambiguous' | 'forbidden' | 'error'
export type GrantResult = { ok: true; email: string } | { ok: false; reason: GrantReason }

/** Grant finance to a person by email (server resolves the Clerk id; admin-gated server-side). */
export async function grantFinanceByEmail(email: string): Promise<GrantResult> {
  const clean = email.trim().toLowerCase()
  const token = await getClerkSessionToken()
  const res = await fetch('/api/team-access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ email: clean }),
  })
  if (res.ok) return { ok: true, email: clean }
  if (res.status === 404) return { ok: false, reason: 'not_found' }
  if (res.status === 409) return { ok: false, reason: 'ambiguous' }
  if (res.status === 403) return { ok: false, reason: 'forbidden' }
  return { ok: false, reason: 'error' }
}
