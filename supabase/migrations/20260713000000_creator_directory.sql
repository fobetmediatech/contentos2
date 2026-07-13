-- Curated, team-shared creator directory for Script Studio "Choose a creator" mode.
-- Any authenticated teammate can read AND edit (add / update / remove) — a shared resource.
create table if not exists creator_directory (
  id            text        primary key,            -- stable `${category}:${handle}` (idempotent seeding)
  category      text        not null,
  handle        text        not null,               -- Instagram handle, no leading @
  display_name  text        not null,
  created_by    text,                               -- Clerk sub of whoever added it (audit; not enforced)
  created_at    timestamptz not null default now()
);

create index if not exists creator_directory_category_idx on creator_directory (category);

alter table creator_directory enable row level security;

create policy creator_directory_select on creator_directory for select
  using (auth.role() = 'authenticated');
create policy creator_directory_insert on creator_directory for insert
  with check (auth.role() = 'authenticated');
create policy creator_directory_update on creator_directory for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy creator_directory_delete on creator_directory for delete
  using (auth.role() = 'authenticated');
