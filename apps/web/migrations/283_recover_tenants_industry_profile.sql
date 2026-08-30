-- Migration 263: RECOVERY of out-of-band migration 20260806042305
-- ("tenants_industry_profile", applied to production 2026-08-06 via MCP).
--
-- This SQL ran against production on 2026-08-06 but was never committed to
-- the repository — a rebuild from migrations/ would silently drop it. The
-- body below is byte-identical to production's
-- supabase_migrations.schema_migrations record for version 20260806042305
-- (verified by md5 e3285224016f25df55fecf49c98e1c04 during the 2026-08-28
-- migration reconciliation; see docs/audits/migration-reconciliation-2026-08-28.md).
--
-- Adds tenants.industry_profile ('general' | 'construction'), the switch the
-- construction vertical (264) hangs off.
--
-- Idempotent: `add column if not exists`; `comment on` is a plain overwrite.
-- Safe to run both where the column already exists (production) and where it
-- does not (a fresh rebuild).

begin;

alter table public.tenants
  add column if not exists industry_profile text
    not null default 'general'
    check (industry_profile in ('general', 'construction'));

comment on column public.tenants.industry_profile is
  'Industry vertical for this tenant. Drives navigation, the default working context, and which construction-owned record types are available. It does NOT change the internals of any other module. ''general'' (default) is the pre-construction behaviour.';

notify pgrst, 'reload schema';

commit;
