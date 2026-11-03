-- Migration 305: close five privilege gaps found in the November 2026 audit.
--
-- The browser talks to PostgREST directly with the public anon key, so RLS and
-- grants are the only gate on those routes. The application-layer checks in
-- the Next.js routes never run for them. Each gap below is a place where a
-- row-scoped policy or a default grant allowed more than the app intends.
--
-- 1. update_manual() is SECURITY DEFINER with no caller check, and 080 only
--    revoked it from PUBLIC. Supabase's default privileges grant EXECUTE on new
--    functions to anon and authenticated separately (migration 124 documents
--    this), so anyone holding the anon key could rewrite the safety manual
--    shown to every tenant. The only legitimate caller is the superadmin route,
--    which uses the service-role client.
--
-- 2. hazard_hunt_finding_sequences (276) was created without row-level
--    security, so under the default grants any role could PATCH another
--    tenant's counter. The only writer is the SECURITY DEFINER trigger
--    set_hazard_hunt_finding_number(), which keeps working.
--
-- 3. memberships_tenant_admin_write (049) is `for all` for tenant admins, so an
--    admin could PATCH their own membership to 'owner', insert any user as an
--    owner, or delete an owner. A BEFORE trigger now reserves every change to
--    or from the owner role for owners and platform superadmins.
--
-- 4. tenants_owner_update (031) lets an owner UPDATE any column of their
--    tenant, including the ones that decide what the tenant has paid for and
--    whether it is suspended: modules, status, is_demo, disabled_at, slug,
--    tenant_number and custom_domain. A BEFORE trigger now reserves those for
--    superadmins. Name, logo, language and settings stay owner-editable.
--
-- 5. cmms_integrations_tenant_scope (161) is `for all` for any member, but the
--    row holds webhook_secret (the HMAC key for inbound CMMS webhooks) and
--    auth_token_encrypted. A viewer could read the secret and forge signed
--    webhooks. Reads and writes are now tenant-admin only.
--
-- Triggers are used for 3 and 4 rather than tighter policies for the same
-- reason as migration 249: an UPDATE policy is row-scoped and cannot restrict
-- which columns move, and a deny-list of named columns cannot lock out a
-- legitimate write nobody remembered. The guards act only on end-user JWTs
-- (role authenticated or anon). The service-role client and migrations carry
-- no such claim and pass straight through, which is how every current writer
-- of these tables (invite provisioning, superadmin routes, the AI operator
-- tools) reaches them.
--
-- Idempotent.

begin;

-- ── 1. update_manual(): service role only ───────────────────────────────────

revoke all on function public.update_manual(
  text, text, text, boolean, text, timestamptz, boolean, uuid, text
) from public, anon, authenticated;

grant execute on function public.update_manual(
  text, text, text, boolean, text, timestamptz, boolean, uuid, text
) to service_role;

-- ── 2. hazard_hunt_finding_sequences: deny by default ───────────────────────

alter table public.hazard_hunt_finding_sequences enable row level security;
revoke all on public.hazard_hunt_finding_sequences from anon, authenticated;

-- ── 3. tenant_memberships: owner changes are owner-only ─────────────────────

create or replace function public.tenant_memberships_guard_owner_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
begin
  -- nullif guards the cast: PostgREST sets the GUC to '' when unauthenticated,
  -- and ''::jsonb raises rather than yielding null.
  if coalesce(
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       ''
     ) not in ('authenticated', 'anon')
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if public.is_superadmin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;

  if tg_op = 'UPDATE'
     and (new.user_id is distinct from old.user_id
          or new.tenant_id is distinct from old.tenant_id)
  then
    raise exception 'A membership cannot be moved to another user or tenant'
      using errcode = 'insufficient_privilege';
  end if;

  if (tg_op = 'INSERT' and new.role = 'owner')
     or (tg_op = 'UPDATE' and new.role is distinct from old.role
         and (old.role = 'owner' or new.role = 'owner'))
     or (tg_op = 'DELETE' and old.role = 'owner')
  then
    if not (v_tenant in (select public.current_user_owner_tenant_ids())) then
      raise exception 'Only a tenant owner can grant, change or remove the owner role'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_tenant_memberships_guard_owner_role on public.tenant_memberships;
create trigger trg_tenant_memberships_guard_owner_role
  before insert or update or delete on public.tenant_memberships
  for each row execute function public.tenant_memberships_guard_owner_role();

-- ── 4. tenants: commercial and lifecycle columns are superadmin-only ────────

create or replace function public.tenants_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Compared through to_jsonb so a column dropped in a future migration
  -- compares null = null and cannot make this function raise.
  c_guarded constant text[] := array[
    'tenant_number', 'slug', 'status', 'is_demo',
    'disabled_at', 'modules', 'custom_domain'
  ];
  v_col text;
begin
  if coalesce(
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       ''
     ) not in ('authenticated', 'anon')
  then
    return new;
  end if;

  if public.is_superadmin() then
    return new;
  end if;

  foreach v_col in array c_guarded loop
    if to_jsonb(new) -> v_col is distinct from to_jsonb(old) -> v_col then
      raise exception 'tenants.% can only be changed by a platform superadmin', v_col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists trg_tenants_guard_privileged_columns on public.tenants;
create trigger trg_tenants_guard_privileged_columns
  before update on public.tenants
  for each row execute function public.tenants_guard_privileged_columns();

-- ── 5. cmms_integrations: tenant admins only ────────────────────────────────

drop policy if exists "cmms_integrations_tenant_scope" on public.cmms_integrations;
drop policy if exists "cmms_integrations_admin" on public.cmms_integrations;

create policy "cmms_integrations_admin" on public.cmms_integrations
  for all to authenticated
  using (
    tenant_id in (select public.current_user_admin_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_admin_tenant_ids())
    or public.is_superadmin()
  );

commit;
