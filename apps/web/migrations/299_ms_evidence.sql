-- Migration 299: the evidence store, and the rule that a compliance
-- evaluation cannot close without it.
--
--   ms_evidence   one row per uploaded file that proves something: a photo,
--                 a document, a sampling result. It lives on the row it
--                 proves (subject_type, subject_id) and is append-only: a
--                 correction supersedes it with a new row, never deletes it.
--
-- Integrity (plan guardrail "Evidence integrity"): the server computes the
-- SHA-256 when it stores the file and re-checks it on every download, so
-- rows are written only by the server. Authenticated users can read them
-- and nothing else.
--
-- Files go in a new private bucket, ms-evidence. It has no storage.objects
-- policies (the 286 pattern), so only the service role reaches it, and
-- reads go through a route that verifies the hash. The shared loto-photos
-- bucket is public, so it is no place for evidence.
--
-- Idempotent. Rollback: 299_rollback.sql.

begin;

create table if not exists public.ms_evidence (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  -- Append-only, so no on-delete action: the reference blocks deleting the facility.
  facility_id        uuid references public.facilities(id),
  -- What the evidence proves. The list grows one phase at a time.
  subject_type       text not null check (subject_type in ('compliance_evaluation')),
  subject_id         uuid not null,
  kind               text not null check (kind in ('photo','document','sample_result','signature')),
  -- Object key in the ms-evidence bucket, always under the owning tenant's prefix.
  storage_path       text not null unique check (storage_path like tenant_id::text || '/%'),
  file_name          text not null check (length(btrim(file_name)) > 0),
  mime_type          text not null,
  file_size_bytes    int  not null check (file_size_bytes > 0),
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by        uuid not null references public.profiles(id),
  uploaded_at        timestamptz not null default now(),
  superseded_by      uuid references public.ms_evidence(id),
  superseded_at      timestamptz,
  superseded_reason  text,
  constraint ms_evidence_superseded_triple check (
    (superseded_by is null) = (superseded_at is null)
    and (superseded_at is null) = (superseded_reason is null)
  ),
  -- The same file attached twice to the same subject is one piece of evidence.
  unique (tenant_id, subject_type, subject_id, sha256)
);

create index if not exists idx_ms_evidence_subject
  on public.ms_evidence (tenant_id, subject_type, subject_id);

-- Append-only: the one permitted update marks a row superseded, once.
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
      new.uploaded_by, new.uploaded_at)
     is distinct from
     (old.id, old.tenant_id, old.facility_id, old.subject_type, old.subject_id, old.kind,
      old.storage_path, old.file_name, old.mime_type, old.file_size_bytes, old.sha256,
      old.uploaded_by, old.uploaded_at) then
    raise exception 'ms_evidence % is append-only; only supersession may change it', old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_ms_evidence_append_only on public.ms_evidence;
create trigger trg_ms_evidence_append_only
  before update on public.ms_evidence
  for each row execute function public.ms_evidence_append_only();

drop trigger if exists trg_audit_ms_evidence on public.ms_evidence;
create trigger trg_audit_ms_evidence
  after insert or update or delete on public.ms_evidence
  for each row execute function public.log_audit('id');

-- Read-only for authenticated users; the upload route writes with the service role.
alter table public.ms_evidence enable row level security;

drop policy if exists ms_evidence_member_read on public.ms_evidence;
create policy ms_evidence_member_read on public.ms_evidence
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );
revoke insert, update, delete on public.ms_evidence from authenticated, anon;

-- ── A compliant or noncompliant evaluation cannot close without evidence ──
-- Mirrors evaluationCompletionGaps() in packages/core. "Not applicable" and
-- "undetermined" may close without a file; the table's checks make "not
-- applicable" carry notes.
create or replace function public.ms_compliance_evaluations_require_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.completed_at is not null
     and new.result in ('compliant', 'noncompliant')
     and not exists (
       select 1 from public.ms_evidence e
        where e.tenant_id = new.tenant_id
          and e.subject_type = 'compliance_evaluation'
          and e.subject_id = new.id
          and e.superseded_by is null
     ) then
    raise exception 'evaluation % cannot close as % without evidence', new.id, new.result
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_ms_compliance_evaluations_require_evidence on public.ms_compliance_evaluations;
create trigger trg_ms_compliance_evaluations_require_evidence
  before insert or update on public.ms_compliance_evaluations
  for each row execute function public.ms_compliance_evaluations_require_evidence();

-- ── Private bucket, no client policies ───────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ms-evidence', 'ms-evidence', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update set
  public             = false,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';

commit;
