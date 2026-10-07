-- Migration 296: environmental document reader — uploaded permits, manifests and
-- SWPPPs, read by the Python service and staged for human review.
--
-- A person uploads a PDF (stormwater/air/wastewater permit, hazardous waste
-- manifest, SWPPP). The web app records it here in status 'processing' and queues
-- a `document_extract` job (migration 295). The service reads the file — OCR for
-- scans — and moves the row to 'needs_review' with the fields it found, each with
-- the text it came from and a confidence. NOTHING is filed automatically: a tenant
-- admin approves, and approving a permit expiry creates a compliance-calendar
-- obligation. A scan is never better than a proposal.
--
-- Access model (same as service_jobs, 295):
--   * Members READ their facility's rows. Nobody writes through RLS: the API
--     routes check the caller's role, then write with the service role, and the
--     service writes the extraction. A browser session cannot forge a result.
--   * The `environmental-docs` bucket has NO storage.objects policies, so it is
--     default-deny for browsers (as `medical-records`, 286). The server mints a
--     signed upload URL under a path IT generates, and signed download URLs after
--     an authorization check, so there is no client-chosen object path to abuse.
--
-- Idempotent. Rollback: 296_rollback.sql.

begin;

create table if not exists public.document_extractions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  facility_id         uuid not null references public.facilities(id) on delete cascade,

  -- Object key in the private `environmental-docs` bucket: <tenant_id>/<uuid>.pdf.
  -- The tenant prefix is enforced here, not trusted from the caller.
  storage_path        text not null
                        check (storage_path like (tenant_id::text || '/%'))
                        check (length(storage_path) <= 300),
  file_name           text not null check (length(trim(file_name)) between 1 and 255),

  -- processing   : uploaded, waiting for / being read by the service
  -- needs_review : read; a person has not yet approved or rejected the proposal
  -- approved     : a person confirmed the fields (see reviewed_fields)
  -- rejected     : a person discarded the proposal
  -- failed       : the file could not be read (see error)
  status              text not null default 'processing'
                        check (status in ('processing','needs_review','approved','rejected','failed')),

  -- Must match DOC_TYPES in services/sds-parser/app/documents/classify.py.
  doc_type            text check (doc_type is null or doc_type in (
                        'hazardous_waste_manifest','stormwater_permit','swppp',
                        'air_permit','wastewater_permit','monitoring_report','other')),
  doc_type_confidence text check (doc_type_confidence is null or doc_type_confidence in ('high','medium','low')),
  overall_confidence  text check (overall_confidence is null or overall_confidence in ('high','medium','low')),
  via_ocr             boolean not null default false,

  -- The service's full proposal: { fields: [{ key, label, value, confidence,
  -- evidence, repaired }], notes, ... }. Evidence is a short snippet of the
  -- document, so the reviewer can check each value against its source.
  extraction          jsonb check (extraction is null or (
                        jsonb_typeof(extraction) = 'object'
                        and octet_length(extraction::text) <= 262144)),
  -- User-facing reason when status = 'failed'. Never raw exception text.
  error               text check (error is null or length(error) <= 1000),

  -- What the reviewer confirmed (they may correct a value): [{ key, value, edited }].
  reviewed_fields     jsonb not null default '[]'::jsonb check (jsonb_typeof(reviewed_fields) = 'array'),
  -- Compliance-calendar obligations created on approval.
  obligation_ids      uuid[] not null default '{}',
  reviewed_by         uuid references public.profiles(id) on delete set null,
  reviewed_at         timestamptz,

  job_id              uuid references public.service_jobs(id) on delete set null,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (storage_path),
  -- A decision has a time; nothing else does.
  check ((status in ('approved','rejected')) = (reviewed_at is not null))
);

create index if not exists idx_document_extractions_facility
  on public.document_extractions (tenant_id, facility_id, created_at desc);
-- The "N documents need review" badge.
create index if not exists idx_document_extractions_needs_review
  on public.document_extractions (tenant_id, facility_id)
  where status = 'needs_review';

drop trigger if exists trg_document_extractions_touch on public.document_extractions;
create trigger trg_document_extractions_touch
  before update on public.document_extractions
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_document_extractions on public.document_extractions;
create trigger trg_audit_document_extractions
  after insert or update or delete on public.document_extractions
  for each row execute function public.log_audit('id');

alter table public.document_extractions enable row level security;

-- Read-only for browsers. Facility scoping follows migration 211: a facility
-- header narrows to that facility; no header is the tenant-wide roll-up.
drop policy if exists document_extractions_read on public.document_extractions;
create policy document_extractions_read on public.document_extractions
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
  );

-- Private bucket, PDF only. Deliberately no storage.objects policies: see header.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'environmental-docs',
  'environmental-docs',
  false,
  26214400,  -- 25 MB
  array['application/pdf']::text[]
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public             = excluded.public;

notify pgrst, 'reload schema';

commit;
