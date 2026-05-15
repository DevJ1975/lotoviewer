-- Migration 154: ISO 45001 clause-to-evidence mapping.
--
-- ISO 45001 audits work clause-by-clause: the auditor opens to clause
-- 8.1.2 ("eliminating hazards and reducing OH&S risks") and asks the
-- org to show evidence. Today that evidence lives across many tables
-- (risks, incidents, near_misses, loto_*, training_records, audit_log).
-- iso45001_clause_evidence is the audit-friendly index — a row points
-- at a single evidence artifact and labels which clause it satisfies.
--
-- The canonical clause-to-module map lives in
-- packages/core/src/iso45001.ts; this table only stores user-curated
-- pinning. A clause without any pinned evidence still surfaces in
-- /admin/iso45001 because the helper's static map shows which platform
-- modules contribute by default.
--
-- Idempotent.

begin;

create table if not exists public.iso45001_clause_evidence (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,
  -- Free text — ISO 45001 clauses range from "4.1" to "10.3.3" and
  -- a check constraint would lock us out of future revisions. We
  -- validate format at the API boundary (e.g. /^\d+(\.\d+)*$/).
  clause_code          text        not null check (length(btrim(clause_code)) > 0),
  source_table         text        not null check (length(btrim(source_table)) > 0),
  -- Text because source rows include both uuids (risks.id, incidents.id)
  -- and string IDs (loto_equipment.equipment_id).
  source_id            text        not null check (length(btrim(source_id)) > 0),
  captured_at          timestamptz not null default now(),
  captured_by_user_id  uuid        references auth.users(id) on delete set null,
  notes                text,
  created_at           timestamptz not null default now(),
  -- Each (clause, source row) is pinned at most once. Re-pinning a
  -- row updates the notes / captured_at via UPSERT.
  unique (tenant_id, clause_code, source_table, source_id)
);

create index if not exists idx_iso45001_clause_evidence_clause
  on public.iso45001_clause_evidence(tenant_id, clause_code, captured_at desc);

create index if not exists idx_iso45001_clause_evidence_source
  on public.iso45001_clause_evidence(tenant_id, source_table, source_id);

comment on table public.iso45001_clause_evidence is
  'Curated pins from ISO 45001 clauses to specific evidence rows. Complements the static clause-to-module map in @soteria/core/iso45001 with hand-picked artifacts.';

alter table public.iso45001_clause_evidence enable row level security;

drop policy if exists "iso45001_clause_evidence_tenant_scope"
  on public.iso45001_clause_evidence;
create policy "iso45001_clause_evidence_tenant_scope"
  on public.iso45001_clause_evidence
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_audit_iso45001_clause_evidence
  on public.iso45001_clause_evidence;
create trigger trg_audit_iso45001_clause_evidence
  after insert or update or delete on public.iso45001_clause_evidence
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
