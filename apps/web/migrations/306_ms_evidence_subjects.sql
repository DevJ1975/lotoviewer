-- Migration 306: Phase 2, evidence for permits and changes
-- (docs/ems/phase-2-plan.md D15, Q3).
--
--   ms_evidence.subject_type      four more subjects: the permit document,
--                                 a change impact's evidence, proof a
--                                 condition was done, and an obligation's
--                                 rule or permit text
--   ms_evidence.export_controlled set at upload and never changed; the
--                                 download route limits such files to
--                                 owners and admins
--   ms_evidence_subject_open()    checks every subject type, not just
--                                 evaluations
--
-- An evaluation keeps its Phase 1 rule exactly. Every new subject type must
-- exist in the same tenant, so a file can no longer attach to nothing.
--
-- Idempotent. Rollback: 306_rollback.sql.

begin;

alter table public.ms_evidence drop constraint if exists ms_evidence_subject_type_check;
alter table public.ms_evidence add constraint ms_evidence_subject_type_check check (subject_type in (
  'compliance_evaluation', 'environmental_permit', 'ms_change_impact',
  'compliance_calendar_event', 'compliance_obligation'));

-- Export-controlled drawings (ITAR/EAR-adjacent) are a label and an access
-- rule, not a legal determination.
alter table public.ms_evidence add column if not exists export_controlled boolean not null default false;

-- 299's append-only rule, with export_controlled among the fixed columns.
create or replace function public.ms_evidence_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.superseded_by is not null then
    raise exception 'ms_evidence % is already superseded', old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  if (new.id, new.tenant_id, new.facility_id, new.subject_type, new.subject_id, new.kind,
      new.storage_path, new.file_name, new.mime_type, new.file_size_bytes, new.sha256,
      new.uploaded_by, new.uploaded_at, new.export_controlled)
     is distinct from
     (old.id, old.tenant_id, old.facility_id, old.subject_type, old.subject_id, old.kind,
      old.storage_path, old.file_name, old.mime_type, old.file_size_bytes, old.sha256,
      old.uploaded_by, old.uploaded_at, old.export_controlled) then
    raise exception 'ms_evidence % is append-only; only supersession may change it', old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

-- The subject must be open to new evidence. FOR SHARE makes a concurrent
-- seal (a completed evaluation, a resolved impact, a retired permit) wait for
-- this write, or this write wait for it, so a sealed record never rests on a
-- file its author did not see.
create or replace function public.ms_evidence_subject_open()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_completed_at timestamptz;
  v_retired_at   timestamptz;
  v_resolved_at  timestamptz;
  v_status       text;
begin
  case new.subject_type
    when 'compliance_evaluation' then
      -- Unchanged from 299: sealed once complete; a subject not written yet passes (a seed may file evidence first).
      select completed_at into v_completed_at
        from public.ms_compliance_evaluations
       where id = new.subject_id and tenant_id = new.tenant_id
         for share;
      if v_completed_at is not null then
        raise exception 'evaluation % is complete and sealed; its evidence cannot change', new.subject_id
          using errcode = 'integrity_constraint_violation';
      end if;

    when 'environmental_permit' then
      select retired_at into v_retired_at
        from public.environmental_permits
       where id = new.subject_id and tenant_id = new.tenant_id
         for share;
      if not found then
        raise exception 'permit % is not a record of this organization', new.subject_id
          using errcode = 'foreign_key_violation';
      end if;
      if v_retired_at is not null then
        raise exception 'This permit is retired, so its documents can no longer change.'
          using errcode = 'integrity_constraint_violation';
      end if;

    when 'ms_change_impact' then
      select i.resolved_at, c.status into v_resolved_at, v_status
        from public.ms_change_impacts i
        join public.ms_changes c on c.tenant_id = i.tenant_id and c.id = i.change_id
       where i.id = new.subject_id and i.tenant_id = new.tenant_id
         for share of i, c;
      if not found then
        raise exception 'impact % is not a record of this organization', new.subject_id
          using errcode = 'foreign_key_violation';
      end if;
      if v_resolved_at is not null or v_status <> 'open' then
        raise exception 'This impact is resolved, or its change has ended, so its evidence can no longer change.'
          using errcode = 'integrity_constraint_violation';
      end if;

    when 'compliance_calendar_event' then
      perform 1 from public.compliance_calendar_events
       where id = new.subject_id and tenant_id = new.tenant_id;
      if not found then
        raise exception 'occurrence % is not a record of this organization', new.subject_id
          using errcode = 'foreign_key_violation';
      end if;

    when 'compliance_obligation' then
      perform 1 from public.compliance_calendar_obligations
       where id = new.subject_id and tenant_id = new.tenant_id;
      if not found then
        raise exception 'obligation % is not a record of this organization', new.subject_id
          using errcode = 'foreign_key_violation';
      end if;
    else
      -- The subject_type check refuses anything else.
      null;
  end case;
  return new;
end $$;

notify pgrst, 'reload schema';

commit;
