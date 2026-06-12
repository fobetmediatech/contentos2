-- Corpus: drop DELETE from the shared-team policies.
--
-- The app's own invariant (supabaseCorpus.ts clear() throws — "Destructive on
-- SHARED team data") was only enforced client-side: the original FOR ALL
-- policies included DELETE, so any signed-in user could wipe the entire team
-- corpus via PostgREST directly (cascading through corpus_sightings and
-- corpus_content). Replace each FOR ALL policy with SELECT + INSERT + UPDATE
-- policies and intentionally NO delete policy — RLS then denies deletes to
-- everyone except service_role.
--
-- UPDATE must stay on all three tables: remember() upserts corpus_creators,
-- rememberContent() upserts corpus_content, setFeedback() updates
-- corpus_creators. user_state is untouched — the app legitimately deletes its
-- own rows there under the per-user user_state_rw policy.

-- corpus_creators
drop policy if exists corpus_creators_all on corpus_creators;
create policy corpus_creators_select on corpus_creators for select
  using (auth.role() = 'authenticated');
create policy corpus_creators_insert on corpus_creators for insert
  with check (auth.role() = 'authenticated');
create policy corpus_creators_update on corpus_creators for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- corpus_sightings
drop policy if exists corpus_sightings_all on corpus_sightings;
create policy corpus_sightings_select on corpus_sightings for select
  using (auth.role() = 'authenticated');
create policy corpus_sightings_insert on corpus_sightings for insert
  with check (auth.role() = 'authenticated');
create policy corpus_sightings_update on corpus_sightings for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- corpus_content
drop policy if exists corpus_content_all on corpus_content;
create policy corpus_content_select on corpus_content for select
  using (auth.role() = 'authenticated');
create policy corpus_content_insert on corpus_content for insert
  with check (auth.role() = 'authenticated');
create policy corpus_content_update on corpus_content for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Belt-and-braces: the grant-level revoke survives a future accidental
-- re-introduction of a FOR ALL policy. ON DELETE CASCADE FKs stay in place —
-- still useful for service-role admin cleanup.
revoke delete on corpus_creators, corpus_sightings, corpus_content
  from authenticated, anon;
