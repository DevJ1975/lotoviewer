-- Rollback for migration 306 (Phase 2, evidence for permits and changes).
--
-- Restores 299's subject rule and subject list. The list is restored NOT
-- VALID, so evidence already filed against a permit, an impact, an
-- occurrence or an obligation survives (evidence is never deleted); new
-- rows are held to 299's list again.
--
-- export_controlled stays, still fixed by the append-only rule, so a flag
-- set before the rollback is still there if 306 is applied again.
--
-- Revert the code that files these subjects before running this.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

alter table public.ms_evidence drop constraint if exists ms_evidence_subject_type_check;
alter table public.ms_evidence add constraint ms_evidence_subject_type_check
  check (subject_type in ('compliance_evaluation')) not valid;

-- 299's definition.
create or replace function public.ms_evidence_subject_open()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_completed_at timestamptz;
begin
  select completed_at into v_completed_at
    from public.ms_compliance_evaluations
   where id = new.subject_id and tenant_id = new.tenant_id
     for share;
  if v_completed_at is not null then
    raise exception 'evaluation % is complete and sealed; its evidence cannot change', new.subject_id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';

commit;
