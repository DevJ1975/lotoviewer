-- Migration 303: converge legal_register onto the environmental legal register.
--
-- legal_register exists in production with an unknown column and policy set (it
-- was applied out-of-band; migration 298 reconstructs it). This migration adds
-- what the suite needs and then makes production and a fresh rebuild IDENTICAL by
-- dropping every existing policy (found dynamically, so unknown names are fine)
-- and creating one known set:
--
--   facility_id          which site (null = a requirement for the whole tenant)
--   program, library_key, library_version   where a library entry came from; the
--                        unique index on (tenant, facility, library_key) stops the
--                        same library entry being added twice for a site
--   applicability, compliance_status, last_evaluated_*, evaluation_note,
--   evidence_path, owner_user_id            the evaluation: does it apply, do we
--                        meet it, who looked, when, and what proves it
--   source               'library' | 'tenant' | 'ai'
--
-- The register is 0 rows in production, so convergence carries no data risk.
-- Existing columns (last_reviewed_at, next_review_due, review_frequency, status,
-- ai_generated, ai_model, ...) are untouched and reused.
--
-- Access: members read; tenant admins write. Facility scoping as in 211, with
-- facility_id null visible in both modes.
--
-- Depends on 298. Idempotent. Rollback: 303_rollback.sql.

begin;

alter table public.legal_register
  add column if not exists facility_id uuid,
  add column if not exists program text
    check (program is null or program in ('stormwater','outfall','air','wastewater','hazardous_waste','manifest','spcc','epcra')),
  add column if not exists library_key text check (library_key is null or length(library_key) <= 120),
  add column if not exists library_version text check (library_version is null or length(library_version) <= 40),
  add column if not exists applicability text not null default 'under_review'
    check (applicability in ('applicable', 'not_applicable', 'under_review')),
  add column if not exists compliance_status text not null default 'not_evaluated'
    check (compliance_status in ('not_evaluated', 'compliant', 'attention', 'non_compliant')),
  add column if not exists last_evaluated_at timestamptz,
  add column if not exists last_evaluated_by uuid references public.profiles(id) on delete set null,
  add column if not exists evaluation_note text check (evaluation_note is null or length(evaluation_note) <= 2000),
  add column if not exists evidence_path text check (evidence_path is null or length(evidence_path) <= 300),
  add column if not exists owner_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists source text not null default 'tenant' check (source in ('library', 'tenant', 'ai'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.legal_register'::regclass and conname = 'legal_register_facility_fkey'
  ) then
    alter table public.legal_register
      add constraint legal_register_facility_fkey
      foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade;
  end if;

  -- A "not applicable" requirement is not rated.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.legal_register'::regclass and conname = 'legal_register_na_not_rated'
  ) then
    alter table public.legal_register
      add constraint legal_register_na_not_rated
      check (applicability <> 'not_applicable' or compliance_status = 'not_evaluated') not valid;
  end if;
end $$;

-- PostgREST cannot upsert against an expression index, so the seeding code does
-- select-then-insert; the index is the guard that keeps a race from duplicating.
create unique index if not exists uq_legal_register_library
  on public.legal_register (tenant_id, coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid), library_key)
  where library_key is not null;
create index if not exists idx_legal_register_facility on public.legal_register (tenant_id, facility_id);

-- One known policy set, whatever production had.
do $$
declare
  p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'legal_register'
  loop
    execute format('drop policy %I on public.legal_register', p.policyname);
  end loop;
end $$;

alter table public.legal_register enable row level security;

create policy legal_register_read on public.legal_register
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy legal_register_admin_write on public.legal_register
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

-- Maintain updated_at and the audit trail, unless the table already has them
-- (production may carry its own triggers under other names; do not double-log).
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid
     where t.tgrelid = 'public.legal_register'::regclass and not t.tgisinternal and f.proname = 'touch_updated_at'
  ) then
    create trigger trg_legal_register_touch before update on public.legal_register
      for each row execute function public.touch_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid
     where t.tgrelid = 'public.legal_register'::regclass and not t.tgisinternal and f.proname = 'log_audit'
  ) then
    create trigger trg_audit_legal_register after insert or update or delete on public.legal_register
      for each row execute function public.log_audit('id');
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
