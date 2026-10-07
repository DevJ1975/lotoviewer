-- Rollback for migration 303: legal register convergence.
--
-- DESTRUCTIVE: drops the evaluation columns (applicability, compliance status,
-- who evaluated and when, notes, evidence), the library link and the facility link,
-- which discards every evaluation recorded. The table and its original columns
-- stay. The convergence policies are replaced by the same baseline tenant-scope
-- policy migration 298 creates; production's original policies were unknown and
-- are not restored.
--
-- Idempotent.

begin;

-- Policies first: the convergence policies reference facility_id, and Postgres
-- refuses to drop a column a policy depends on.
do $$
declare
  p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'legal_register'
  loop
    execute format('drop policy %I on public.legal_register', p.policyname);
  end loop;
end $$;

-- Only the triggers 303 itself creates; production's own, if any, are untouched.
drop trigger if exists trg_legal_register_touch on public.legal_register;
drop trigger if exists trg_audit_legal_register on public.legal_register;

drop index if exists public.uq_legal_register_library;
drop index if exists public.idx_legal_register_facility;
alter table public.legal_register drop constraint if exists legal_register_na_not_rated;
alter table public.legal_register drop constraint if exists legal_register_facility_fkey;

alter table public.legal_register
  drop column if exists facility_id,
  drop column if exists program,
  drop column if exists library_key,
  drop column if exists library_version,
  drop column if exists applicability,
  drop column if exists compliance_status,
  drop column if exists last_evaluated_at,
  drop column if exists last_evaluated_by,
  drop column if exists evaluation_note,
  drop column if exists evidence_path,
  drop column if exists owner_user_id,
  drop column if exists source;

create policy legal_register_tenant_scope on public.legal_register
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
