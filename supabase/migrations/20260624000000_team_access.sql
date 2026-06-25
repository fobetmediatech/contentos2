-- Team Access: an admin role that can self-serve grant/revoke the finance role from the app,
-- plus a "break-glass" recovery path. Builds on member_roles + is_finance() (20260617) and the
-- member_roles.label column (20260623000000). Run in the Supabase SQL editor.
--
-- Security model:
--   * member_roles is locked from the app (revoke insert/update/delete). The grant/revoke
--     functions below are SECURITY DEFINER so they CAN write it, but each self-checks is_admin()
--     FIRST, so only admins can mutate roles. role is HARDCODED to 'finance' in the grant fn —
--     this path can never mint another admin (admins are seeded by SQL only).
--   * SECURITY DEFINER functions pin search_path (prevents search_path hijacking).
--   * break_glass() authorizes by a SECRET (bcrypt hash in a locked table), not is_admin — it's
--     the recovery path for when no admin is reachable. It elevates the CURRENT signed-in user.

create extension if not exists pgcrypto;

-- Optional expiry on a role row. NULL = permanent (seeded admins, all finance grants).
-- Break-glass admin rows get a short expiry so the recovery path is temporary, not a backdoor.
alter table member_roles add column if not exists expires_at timestamptz;

-- ---------- is_admin() ----------
-- True iff the calling user (request JWT sub) holds a NON-EXPIRED 'admin' role.
create or replace function is_admin() returns boolean
  language sql stable
  set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from member_roles
    where user_id = auth.jwt() ->> 'sub' and role = 'admin'
      and (expires_at is null or expires_at > now())
  );
$$;

-- ---------- admin_grant_finance(target_user_id, label) ----------
create or replace function admin_grant_finance(target_user_id text, target_label text)
  returns void
  language plpgsql security definer
  set search_path = pg_catalog, public
as $$
begin
  if not is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if target_user_id is null or btrim(target_user_id) = '' then
    raise exception 'target_user_id required' using errcode = '22023';
  end if;
  insert into member_roles (user_id, role, label)
  values (target_user_id, 'finance', target_label)
  on conflict (user_id, role) do update set label = excluded.label;
end;
$$;

-- ---------- admin_revoke_finance(target_user_id) ----------
create or replace function admin_revoke_finance(target_user_id text)
  returns void
  language plpgsql security definer
  set search_path = pg_catalog, public
as $$
begin
  if not is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from member_roles where user_id = target_user_id and role = 'finance';
end;
$$;

-- ---------- Break-glass recovery ----------
-- Locked config table holding the bcrypt hash of the recovery code. RLS ON with NO policies
-- => no API role (anon/authenticated) can read or write it; only SECURITY DEFINER functions
-- (table owner) and the SQL editor can touch it. The hash is set once via SQL (see runbook).
create table if not exists app_config (
  key   text primary key,
  value text not null
);
alter table app_config enable row level security;

-- break_glass(code): if the code matches the stored bcrypt hash, grant the CURRENT signed-in
-- user the 'admin' role (logged via label). Returns true on success, false on wrong/unset code.
-- NB: search_path includes `extensions` because Supabase installs pgcrypto (crypt/gen_salt)
-- into the `extensions` schema, not `public`. Without it, crypt() fails to resolve here.
create or replace function break_glass(code text)
  returns boolean
  language plpgsql security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  stored_hash text;
  caller text := auth.jwt() ->> 'sub';
begin
  if caller is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  select value into stored_hash from app_config where key = 'break_glass_hash';
  if stored_hash is null then
    return false; -- recovery code not configured
  end if;
  if crypt(code, stored_hash) = stored_hash then
    -- Temporary admin: 3-minute expiry. Never downgrade an existing PERMANENT admin
    -- (expires_at IS NULL) — keep them permanent; only (re)stamp temporary ones.
    insert into member_roles (user_id, role, label, expires_at)
    values (caller, 'admin', 'via break-glass ' || to_char(now(), 'YYYY-MM-DD HH24:MI'), now() + interval '3 minutes')
    on conflict (user_id, role) do update
      set expires_at = case when member_roles.expires_at is null then null else now() + interval '3 minutes' end,
          label      = case when member_roles.expires_at is null then member_roles.label else excluded.label end;
    return true;
  end if;
  return false;
end;
$$;

-- ---------- Execute grants (revoke from public/anon; allow authenticated; internal checks gate) ----------
revoke all on function admin_grant_finance(text, text) from public;
revoke all on function admin_revoke_finance(text) from public;
revoke all on function break_glass(text) from public;
grant execute on function is_admin() to authenticated;
grant execute on function admin_grant_finance(text, text) to authenticated;
grant execute on function admin_revoke_finance(text) to authenticated;
grant execute on function break_glass(text) to authenticated;
