-- Migration 300: facility scoping for the remaining ISO 14001 tables.
--
-- Migration 210 gave domain tables a facility_id and migration 211 added
-- the facility clause to their policies, but both skipped the EMS tables
-- from migrations 204-207 (docs/ems/adr/0001, Consequences). Aspects got
-- theirs in 297; this does the rest, with migration 210's two cases:
--
--   facility records (default = the caller's active facility; existing rows
--   go to the tenant's primary facility):
--     environmental_objectives, nonconformities
--   organization-wide records (nullable, no default; null = whole organization):
--     management_reviews, iso14001_clause_evidence
--
-- Child tables (environmental_objective_readings, nonconformity_actions)
-- inherit through their parent and get no column, per migration 210.
--
-- These pages still write from the browser, so members keep write access;
-- Phases 3 and 6 move those writes behind the API. Only the facility clause
-- (migration 211's three-clause form) is added to each policy.
--
-- It also fixes active_tenant_id() and active_facility_id() (migrations 032
-- and 209). Both did coalesce(current_setting('request.headers', true), '')::jsonb,
-- which raises "invalid input syntax for type json" whenever no request
-- headers are set: in the SQL Editor, a migration, or a hand-applied seed.
-- PostgREST always sets them, which is why production never noticed. Now
-- that aspects, objectives and nonconformities default facility_id to
-- active_facility_id(), a hand-run seed inserting them would fail. With no
-- headers both functions now return null ("no active tenant/facility", the
-- service-role meaning); with headers they behave exactly as before.
--
-- Idempotent. Rollback: 300_rollback.sql.

begin;

-- ── Header readers that tolerate "no headers" ────────────────────────────
create or replace function public.active_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-active-tenant',
    ''
  )::uuid
$$;

create or replace function public.active_facility_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-active-facility',
    ''
  )::uuid
$$;

-- ── Facility records ─────────────────────────────────────────────────────
-- Existing rows go to the tenant's primary facility only when the column is
-- first added, so a re-run never moves a row since made organization-wide
-- (a nonconformity from an organization-wide obligation, say). The touch
-- trigger is off meanwhile: a backfill is bookkeeping, and updated_at keeps
-- the date someone last changed the record.
do $$
declare
  t text;
begin
  foreach t in array array['environmental_objectives', 'nonconformities'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'facility_id') then
      execute format('alter table public.%I add column facility_id uuid', t);
      execute format('alter table public.%I disable trigger %I', t, 'trg_' || t || '_touch');
      execute format(
        'update public.%I r set facility_id = f.id from public.facilities f where f.tenant_id = r.tenant_id and f.is_primary', t);
      execute format('alter table public.%I enable trigger %I', t, 'trg_' || t || '_touch');
    end if;
    execute format('alter table public.%I alter column facility_id set default public.active_facility_id()', t);
    execute format('create index if not exists %I on public.%I (facility_id)', 'idx_' || t || '_facility', t);
  end loop;
end $$;

-- ── Organization-wide records ────────────────────────────────────────────
alter table public.management_reviews add column if not exists facility_id uuid;
create index if not exists idx_management_reviews_facility
  on public.management_reviews (facility_id) where facility_id is not null;

alter table public.iso14001_clause_evidence add column if not exists facility_id uuid;
create index if not exists idx_iso14001_clause_evidence_facility
  on public.iso14001_clause_evidence (facility_id) where facility_id is not null;

-- Same-tenant facility on all four (uq_facilities_tenant_id_pair), so a stale
-- or foreign facility header cannot stamp another tenant's facility.
do $$
declare
  t text;
begin
  foreach t in array array['environmental_objectives', 'nonconformities', 'management_reviews', 'iso14001_clause_evidence'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_facility_fk');
    execute format(
      'alter table public.%I add constraint %I foreign key (tenant_id, facility_id) references public.facilities (tenant_id, id)',
      t, t || '_facility_fk');
  end loop;
end $$;

-- ── Policies: migration 211's three-clause form ──────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['environmental_objectives', 'nonconformities', 'management_reviews', 'iso14001_clause_evidence'] loop
    execute format('drop policy if exists %I on public.%I', t || '_tenant_scope', t);
    execute format($p$
      create policy %I on public.%I
        for all to authenticated
        using (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
          and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
        )
        with check (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
          and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
        )
    $p$, t || '_tenant_scope', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
