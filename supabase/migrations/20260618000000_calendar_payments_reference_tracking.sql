-- Phase 2: Calendar + Payments reference the Dashboard's tracked_accounts (by @username)
-- instead of our standalone clients table. The Dashboard (tracked_accounts) is now the
-- single source of accounts/clients. Discards prior test data (approved by user).
--
-- Run AFTER the dashboard's 20260617000000_tracking_tables.sql (tracked_accounts must exist).

-- Clear test rows that referenced clients (their reference column is about to change).
delete from scheduled_posts;
delete from client_payments;

-- Repoint scheduled_posts → a tracked account (by username).
alter table scheduled_posts drop column if exists client_id;
alter table scheduled_posts
  add column if not exists account_username text references tracked_accounts(username) on delete cascade;
create index if not exists scheduled_posts_account_idx on scheduled_posts(account_username);

-- Repoint client_payments → a tracked account (by username).
alter table client_payments drop column if exists client_id;
alter table client_payments
  add column if not exists account_username text references tracked_accounts(username) on delete cascade;
create index if not exists client_payments_account_idx on client_payments(account_username);

-- The standalone clients table is no longer used (the Dashboard's tracked_accounts replaces it).
drop table if exists clients;
