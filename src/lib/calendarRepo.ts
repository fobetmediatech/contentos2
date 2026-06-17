/**
 * Supabase data access for the Calendar + Payments feature.
 *
 * Thin CRUD over the `clients`, `scheduled_posts`, `client_payments`, and
 * `member_roles` tables (created in 20260617000000_calendar_payments.sql).
 * Maps snake_case rows ↔ camelCase domain types. RLS does the real access control:
 * clients/posts are team-shared; payments are finance-role-only.
 *
 * Bookkeeping columns (created_by / entered_by) are server-defaulted from the Clerk
 * JWT (auth.jwt()->>'sub'), so the client never sends them.
 */
import { supabase } from './supabaseClient'
import type {
  Client, ClientInput, ClientStatus,
  ScheduledPost, ScheduledPostInput, ContentType, PostStatus,
  ClientPayment, ClientPaymentInput, PaymentStatus,
} from '../domain/calendar'

const ms = (t: string | null): number => (t ? new Date(t).getTime() : 0)

// ---------- Clients ----------

function rowToClient(r: Record<string, unknown>): Client {
  return {
    id: r.id as string,
    handle: (r.handle as string | null) ?? null,
    name: (r.name as string) ?? '',
    status: ((r.status as string) ?? 'active') as ClientStatus,
    notes: (r.notes as string | null) ?? null,
    createdAt: ms(r.created_at as string | null),
  }
}

export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowToClient)
}

export async function createClient(input: ClientInput): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .insert({
      name: input.name,
      handle: input.handle ?? null,
      status: input.status ?? 'active',
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return rowToClient(data as Record<string, unknown>)
}

export async function updateClient(id: string, patch: Partial<ClientInput>): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Delete a client. Cascades to its scheduled posts + payments (ON DELETE CASCADE). */
export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
}

// ---------- Scheduled posts ----------

function rowToPost(r: Record<string, unknown>): ScheduledPost {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    scheduledFor: ms(r.scheduled_for as string | null),
    contentType: ((r.content_type as string) ?? 'reel') as ContentType,
    title: (r.title as string | null) ?? null,
    caption: (r.caption as string | null) ?? null,
    hook: (r.hook as string | null) ?? null,
    status: ((r.status as string) ?? 'idea') as PostStatus,
    assignee: (r.assignee as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }
}

/** List scheduled posts, optionally filtered by client and/or an [from,to) date window (epoch ms). */
export async function listScheduledPosts(opts?: {
  clientId?: string
  from?: number
  to?: number
}): Promise<ScheduledPost[]> {
  let q = supabase.from('scheduled_posts').select('*').order('scheduled_for', { ascending: true })
  if (opts?.clientId) q = q.eq('client_id', opts.clientId)
  if (opts?.from != null) q = q.gte('scheduled_for', new Date(opts.from).toISOString())
  if (opts?.to != null) q = q.lt('scheduled_for', new Date(opts.to).toISOString())
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map(rowToPost)
}

export async function createScheduledPost(input: ScheduledPostInput): Promise<ScheduledPost> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .insert({
      client_id: input.clientId,
      scheduled_for: new Date(input.scheduledFor).toISOString(),
      content_type: input.contentType ?? 'reel',
      title: input.title ?? null,
      caption: input.caption ?? null,
      hook: input.hook ?? null,
      status: input.status ?? 'idea',
      assignee: input.assignee ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return rowToPost(data as Record<string, unknown>)
}

export async function updateScheduledPost(
  id: string,
  patch: Partial<Omit<ScheduledPostInput, 'clientId'>>,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.scheduledFor != null) row.scheduled_for = new Date(patch.scheduledFor).toISOString()
  if (patch.contentType !== undefined) row.content_type = patch.contentType
  if (patch.title !== undefined) row.title = patch.title
  if (patch.caption !== undefined) row.caption = patch.caption
  if (patch.hook !== undefined) row.hook = patch.hook
  if (patch.status !== undefined) row.status = patch.status
  if (patch.assignee !== undefined) row.assignee = patch.assignee
  if (patch.notes !== undefined) row.notes = patch.notes
  const { error } = await supabase.from('scheduled_posts').update(row).eq('id', id)
  if (error) throw error
}

export async function deleteScheduledPost(id: string): Promise<void> {
  const { error } = await supabase.from('scheduled_posts').delete().eq('id', id)
  if (error) throw error
}

// ---------- Payments (finance-only via RLS) ----------

function rowToPayment(r: Record<string, unknown>): ClientPayment {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    amount: Number(r.amount) || 0,
    currency: (r.currency as string) ?? 'INR',
    paidOn: (r.paid_on as string | null) ?? null,
    status: ((r.status as string) ?? 'due') as PaymentStatus,
    method: (r.method as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdAt: ms(r.created_at as string | null),
  }
}

export async function listPayments(clientId?: string): Promise<ClientPayment[]> {
  let q = supabase.from('client_payments').select('*').order('paid_on', { ascending: false, nullsFirst: false })
  if (clientId) q = q.eq('client_id', clientId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map(rowToPayment)
}

export async function createPayment(input: ClientPaymentInput): Promise<ClientPayment> {
  const { data, error } = await supabase
    .from('client_payments')
    .insert({
      client_id: input.clientId,
      amount: input.amount,
      currency: input.currency ?? 'INR',
      paid_on: input.paidOn ?? null,
      status: input.status ?? 'due',
      method: input.method ?? null,
      note: input.note ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return rowToPayment(data as Record<string, unknown>)
}

export async function updatePayment(id: string, patch: Partial<ClientPaymentInput>): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.amount !== undefined) row.amount = patch.amount
  if (patch.currency !== undefined) row.currency = patch.currency
  if (patch.paidOn !== undefined) row.paid_on = patch.paidOn
  if (patch.status !== undefined) row.status = patch.status
  if (patch.method !== undefined) row.method = patch.method
  if (patch.note !== undefined) row.note = patch.note
  const { error } = await supabase.from('client_payments').update(row).eq('id', id)
  if (error) throw error
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await supabase.from('client_payments').delete().eq('id', id)
  if (error) throw error
}

// ---------- Roles ----------

/**
 * Whether the signed-in user has the finance role. Calls the Postgres is_finance()
 * helper (scoped to the caller's Clerk JWT), so the client never needs the user id.
 * Returns false on any error (fail-closed — payments stay hidden).
 */
export async function isFinance(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_finance')
  if (error) return false
  return data === true
}
