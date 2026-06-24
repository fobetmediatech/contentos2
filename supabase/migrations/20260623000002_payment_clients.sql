-- Payments gets its OWN standalone client database, independent of the Dashboard.
--
-- Previously Payments referenced the Dashboard's tracked_accounts by @username
-- (see 20260618000000_calendar_payments_reference_tracking.sql). That coupling is
-- removed for Payments only: a paying *company* is not the same as a tracked Instagram
-- *account*. The finance team now manages its own client list entirely within Payments.
--
-- NOTE: the main Calendar section is UNCHANGED — scheduled_posts still reference
-- tracked_accounts. This migration only repoints client_payments.
--
-- Run in the Supabase SQL editor (the app's anon key cannot run DDL).

-- ---------- Payment clients (FINANCE ROLE ONLY) ----------
create table if not exists payment_clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,                       -- company / client name (required)
  contact_person  text,
  email           text,
  phone           text,
  tax_id          text,                                -- GST / billing tax id
  currency        text default 'INR',                  -- default billing currency
  instagram_handle text,                               -- free-text reference only — NOT linked to tracked_accounts
  notes           text,
  created_by      text default (auth.jwt() ->> 'sub'),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table payment_clients enable row level security;

-- Finance-only: the client list lives inside the finance-gated Payments section.
drop policy if exists payment_clients_finance on payment_clients;
create policy payment_clients_finance on payment_clients for all
  using (is_finance()) with check (is_finance());

-- ---------- Repoint client_payments → payment_clients ----------
-- Discard existing rows (test data, approved): their reference column is changing.
delete from client_payments;

alter table client_payments drop column if exists account_username;
alter table client_payments
  add column if not exists payment_client_id uuid references payment_clients(id) on delete cascade;
create index if not exists client_payments_client_idx on client_payments(payment_client_id);
