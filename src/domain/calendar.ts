/**
 * Domain types for the Content Calendar + Payments feature.
 *
 * CamelCase here; the Supabase columns are snake_case — calendarRepo.ts maps between
 * them. Mirrors the project's domain-type-in-src/domain convention.
 */

export type ClientStatus = 'active' | 'paused' | 'archived'

/** A brand the agency manages. Owned by this feature for now; the future dashboard shares it. */
export interface Client {
  id: string
  handle: string | null     // Instagram handle (optional)
  name: string
  status: ClientStatus
  notes: string | null
  createdAt: number         // epoch ms
}

export interface ClientInput {
  name: string
  handle?: string | null
  status?: ClientStatus
  notes?: string | null
}

export type ContentType = 'reel' | 'post' | 'story' | 'carousel'
export type PostStatus = 'idea' | 'draft' | 'scheduled' | 'posted' | 'skipped'

/** One planned piece of content on the calendar (plan-only — never auto-published). */
export interface ScheduledPost {
  id: string
  clientId: string
  scheduledFor: number      // epoch ms (stored UTC)
  contentType: ContentType
  title: string | null
  caption: string | null
  hook: string | null
  status: PostStatus
  assignee: string | null   // Clerk user id (optional)
  notes: string | null
}

export interface ScheduledPostInput {
  clientId: string
  scheduledFor: number
  contentType?: ContentType
  title?: string | null
  caption?: string | null
  hook?: string | null
  status?: PostStatus
  assignee?: string | null
  notes?: string | null
}

export type PaymentStatus = 'due' | 'paid' | 'overdue'

/** A manually-logged payment. FINANCE ROLE ONLY (enforced by Supabase RLS). */
export interface ClientPayment {
  id: string
  clientId: string
  amount: number
  currency: string
  paidOn: string | null     // ISO date (YYYY-MM-DD)
  status: PaymentStatus
  method: string | null
  note: string | null
  createdAt: number
}

export interface ClientPaymentInput {
  clientId: string
  amount: number
  currency?: string
  paidOn?: string | null
  status?: PaymentStatus
  method?: string | null
  note?: string | null
}
