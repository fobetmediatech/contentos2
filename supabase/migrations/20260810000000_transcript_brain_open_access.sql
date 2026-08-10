-- Transcript Intelligence Layer — open access to every signed-in team member.
--
-- REVERSES the day-one posture. 20260804000000 shipped these tables CLOSED (is_admin() only) on the
-- reasoning that transcripts carry client margins, ticket sizes and closed-deal detail — the most
-- sensitive data in this database — and that widening later is a one-line change while retrofitting
-- scoping onto already-open data needs an audit trail that does not exist.
--
-- This IS that one-line change, requested deliberately. The tables now match the convention every
-- other table here follows: any authenticated member reads and writes.
--
-- WHAT THIS MEANS IN PRACTICE: every signed-in user can now read every transcript, including the
-- revenue figures and margins clients state on sales calls. There is no per-client scoping and no
-- audit trail of who read what. `cb_transcripts.owner_user_id` still exists, unused, so per-owner
-- scoping can be added later without a migration.
--
-- Run in the Supabase SQL editor, or `supabase db push --linked`.

drop policy if exists cb_clients_admin on cb_clients;
create policy cb_clients_all on cb_clients for all to authenticated
  using (true) with check (true);

drop policy if exists cb_client_emails_admin on cb_client_emails;
create policy cb_client_emails_all on cb_client_emails for all to authenticated
  using (true) with check (true);

drop policy if exists cb_client_strategies_admin on cb_client_strategies;
create policy cb_client_strategies_all on cb_client_strategies for all to authenticated
  using (true) with check (true);

drop policy if exists cb_transcripts_admin on cb_transcripts;
create policy cb_transcripts_all on cb_transcripts for all to authenticated
  using (true) with check (true);

drop policy if exists cb_transcript_chunks_admin on cb_transcript_chunks;
create policy cb_transcript_chunks_all on cb_transcript_chunks for all to authenticated
  using (true) with check (true);

drop policy if exists cb_extractions_admin on cb_extractions;
create policy cb_extractions_all on cb_extractions for all to authenticated
  using (true) with check (true);

-- cb_match_chunks stays SECURITY INVOKER. It runs as the caller, so it inherits whatever the
-- policies above allow — no change needed, and it must NOT become definer.
