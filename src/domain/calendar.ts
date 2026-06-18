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

/** A manually-logged payment for a tracked account. FINANCE ROLE ONLY (Supabase RLS). */
export interface ClientPayment {
  id: string
  accountUsername: string   // → tracked_accounts.username
  amount: number
  currency: string
  paidOn: string | null     // ISO date (YYYY-MM-DD)
  status: PaymentStatus
  method: string | null
  note: string | null
  createdAt: number
}

export interface ClientPaymentInput {
  accountUsername: string
  amount: number
  currency?: string
  paidOn?: string | null
  status?: PaymentStatus
  method?: string | null
  note?: string | null
}
