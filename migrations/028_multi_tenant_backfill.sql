-- Migration 028: backfill existing data into tenants
--
-- Phase 2 of the multi-tenant rollout. See:
--   docs/multi-tenant-plan.md       — base mechanics
--   docs/multi-tenancy-saas-plan.md — SaaS additions
--
-- What this does:
--   1. Creates the first two tenants — Snak King (0001) and WLS Demo (0002)
--   2. Folds the loto_org_config singleton into Snak King's tenants.settings
--   3. Backfills every domain row's tenant_id to Snak King
--   4. Grants every existing auth.users user membership in Snak King
--      (existing profiles.is_admin users become 'owner', everyone else 'member')
--   5. Reserves tenant_number 0001/0002 and parks the sequence at 2 so the
--      next allocation returns 0003
--
-- Pre-flight: migration 027 must already be applied. This migration does NOT
-- enable RLS or set NOT NULL on tenant_id — that's migration 029.
--
-- Audit silencing: backfill UPDATEs would otherwise generate one audit_log
-- row per affected row across every audited table. We use
-- session_replication_role = replica inside an explicit transaction to
-- bypass all triggers (audit + updated_at) during the bulk operation. The
-- migration filename + git SHA are the audit trail for this one-time backfill.
--
-- Idempotent. Re-running is a no-op once tenants exist and rows are backfilled.
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- Bypass audit + updated_at triggers during bulk backfill. Reverts at commit.
set local session_replication_role = replica;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Create the first two tenants
--
-- Snak King = 0001, real production data, LOTO-only configuration.
-- WLS Demo  = 0002, demo tenant, all modules on, seeded separately in
-- migration 030 (or via npm run seed:demo).
-- ────────────────────────────────────────────────────────────────────────────
insert into public.tenants (tenant_number, slug, name, status, is_demo, modules, settings)
values
  ('0001', 'snak-king', 'Snak King', 'active', false,
    jsonb_build_object(
      'loto',                       true,
      'confined-spaces',            false,
      'hot-work',                   false,
      'near-miss',                  false,
      'jha',                        false,
      'reports-scorecard',          true,
      'reports-insights',           true,
      'reports-compliance-bundle',  true,
      'reports-inspector',          true,
      'admin-loto-devices',         true,
      'admin-configuration',        true,
      'admin-webhooks',             true,
      'admin-training',             false,
      'admin-hygiene-log',          true,
      'settings-notifications',     true,
      'support',                    true
    ),
    '{}'::jsonb),
  ('0002', 'wls-demo', 'WLS Demo', 'trial', true,
    jsonb_build_object(
      'loto',                       true,
      'confined-spaces',            true,
      'hot-work',                   true,
      'near-miss',                  false,
      'jha',                        false,
      'reports-scorecard',          true,
      'reports-insights',           true,
      'reports-compliance-bundle',  true,
      'reports-inspector',          true,
      'admin-loto-devices',         true,
      'admin-configuration',        true,
      'admin-webhooks',             true,
      'admin-training',             true,
      'admin-hygiene-log',          true,
      'settings-notifications',     true,
      'support',                    true
    ),
    '{}'::jsonb)
on conflict (slug) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Fold loto_org_config into Snak King's settings
--
-- The singleton loto_org_config table holds work_order_url_template (and
-- future per-org keys). Multi-tenancy moves this into per-tenant
-- tenants.settings jsonb. The loto_org_config table itself stays for now
-- as a legacy read source; a later migration drops it once all reads have
-- been moved to tenants.settings.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  cfg jsonb;
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'loto_org_config'
  ) then
    select jsonb_strip_nulls(jsonb_build_object(
             'work_order_url_template', work_order_url_template
           ))
      into cfg
      from public.loto_org_config
     where id = 1;

    if cfg is not null and cfg <> '{}'::jsonb then
      update public.tenants
         set settings = settings || cfg
       where slug = 'snak-king';
      raise notice 'Folded loto_org_config into snak-king.settings: %', cfg;
    else
      raise notice 'loto_org_config has no values to fold';
    end if;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Park the sequence so next_tenant_number() returns 0003
--
-- 0001 + 0002 are now in use. Subsequent superadmin tenant creation calls
-- next_tenant_number() and expects sequential allocation.
-- ────────────────────────────────────────────────────────────────────────────
select setval('public.tenant_number_seq', 2, true);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Backfill tenant_id on every domain table to Snak King
--
-- Self-healing loop: iterates every public.* table that carries a tenant_id
-- column (added by 027), so the same migration applies whether a DB has 14
-- domain tables or 17. tenants and tenant_memberships are excluded because
-- their tenant_id is the row's identity, not a backfill target.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t            text;
  snak_king_id uuid;
  rows_updated bigint;
begin
  select id into snak_king_id from public.tenants where slug = 'snak-king';
  if snak_king_id is null then
    raise exception 'Snak King tenant not found — did step 1 fail?';
  end if;

  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'tenant_id'
       and c.table_name not in ('tenants', 'tenant_memberships')
     order by c.table_name
  loop
    execute format(
      'update public.%I set tenant_id = $1 where tenant_id is null',
      t
    ) using snak_king_id;
    get diagnostics rows_updated = row_count;
    raise notice 'Backfilled %: % rows', t, rows_updated;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Membership grants
--
-- Every existing auth.users user gets a Snak King membership. Existing
-- profiles.is_admin = true users are promoted to 'owner' so they can invite
-- and manage members; everyone else is 'member'.
--
-- Note: this auto-grants every user, including any test or dormant accounts.
-- If a curated list is preferred, run a manual DELETE FROM tenant_memberships
-- WHERE user_id IN (...) after this migration.
-- ────────────────────────────────────────────────────────────────────────────
insert into public.tenant_memberships (user_id, tenant_id, role)
select u.id,
       (select id from public.tenants where slug = 'snak-king'),
       case when coalesce(p.is_admin, false) then 'owner' else 'member' end
  from auth.users u
  left join public.profiles p on p.id = u.id
on conflict (user_id, tenant_id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Verification — every domain row should now have a tenant_id
--
-- audit_log is excluded from the strict check because some rows may
-- legitimately stay NULL (cross-tenant superadmin actions). Phase 3 (029)
-- enforces NOT NULL on every column except audit_log.tenant_id.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t           text;
  cnt         bigint;
  total_null  bigint := 0;
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'tenant_id'
       and c.table_name not in ('tenants', 'tenant_memberships', 'audit_log')
  loop
    execute format('select count(*) from public.%I where tenant_id is null', t)
      into cnt;
    if cnt > 0 then
      raise notice 'WARNING: % has % rows with tenant_id IS NULL', t, cnt;
      total_null := total_null + cnt;
    end if;
  end loop;

  if total_null = 0 then
    raise notice 'Verification OK: every domain row carries a tenant_id';
  else
    raise exception 'Backfill incomplete: % rows still have tenant_id is null — abort', total_null;
  end if;
end $$;

commit;

-- ────────────────────────────────────────────────────────────────────────────
-- Post-migration manual steps (do NOT automate, do NOT add to this file)
--
-- A. Promote yourself to superadmin (in SQL Editor as a separate query):
--      update public.profiles
--         set is_superadmin = true
--       where email = 'your-email@example.com';
--    The /superadmin route layer also checks SUPERADMIN_EMAILS env var, so
--    set that on Vercel (Production + Preview) to the same email before
--    deploying any UI that uses requireSuperadmin().
--
-- B. Verify Snak King tenant_number = 0001:
--      select tenant_number, name from public.tenants order by tenant_number;
--    Should show: 0001 Snak King, 0002 WLS Demo.
-- ────────────────────────────────────────────────────────────────────────────
