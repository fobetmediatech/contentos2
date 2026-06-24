/**
 * Domain types for the Content Calendar + Payments feature.
 *
 * Posts + payments reference a Dashboard tracked account by its Instagram @username
 * (the dashboard's `tracked_accounts` table is the single source of accounts). CamelCase
 * here; the Supabase columns are snake_case — calendarRepo.ts maps between them.
 */

/** A tracked Instagram account (from the Dashboard) — used in the Calendar/Payments pickers. */
export interface Account {
  username: string
  fullName: string | null
}

export type ContentType = 'reel' | 'post' | 'story' | 'carousel'
export type PostStatus = 'idea' | 'draft' | 'scheduled' | 'posted' | 'skipped'

/** One planned piece of content on the calendar (plan-only — never auto-published). */
export interface ScheduledPost {
  id: string
  accountUsername: string   // → tracked_accounts.username
  scheduledFor: number      // epoch ms (stored UTC)
  contentType: ContentType
  title: string | null
  caption: string | null
  hook: string | null
  status: PostStatus
  assignee: string | null
  notes: string | null
}

export interface ScheduledPostInput {
  accountUsername: string
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

/**
 * A client in the Payments section's OWN standalone database (independent of the
 * Dashboard's tracked_accounts). Managed entirely by finance from within Payments.
 * FINANCE ROLE ONLY (Supabase RLS).
 */
export interface PaymentClient {
  id: string
  name: string                 // company / client name (required)
  contactPerson: string | null
  email: string | null
  phone: string | null
  taxId: string | null         // GST / billing tax id
  currency: string             // default billing currency
  instagramHandle: string | null  // free-text reference only — NOT linked to tracked_accounts
  notes: string | null
  createdAt: number
}

export interface PaymentClientInput {
  name: string
  contactPerson?: string | null
  email?: string | null
  phone?: string | null
  taxId?: string | null
  currency?: string
  instagramHandle?: string | null
  notes?: string | null
}

/** A manually-logged payment for a payment client. FINANCE ROLE ONLY (Supabase RLS). */
export interface ClientPayment {
  id: string
  paymentClientId: string   // → payment_clients.id
  amount: number
  currency: string
  paidOn: string | null     // ISO date (YYYY-MM-DD)
  status: PaymentStatus
  method: string | null
  note: string | null
  createdAt: number
}

export interface ClientPaymentInput {
  paymentClientId: string
  amount: number
  currency?: string
  paidOn?: string | null
  status?: PaymentStatus
  method?: string | null
  note?: string | null
}
