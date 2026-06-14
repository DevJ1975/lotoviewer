-- Migration 229: EM-385 Compliance — evidence document files.
--
-- File metadata for documents attached to a register item (the signed APP PDF,
-- an AHA, a certificate, a permit scan, …). Bytes live in the existing
-- `loto-photos` bucket under a tenant-prefixed `em385/` path (migration 033 RLS
-- gates the write by tenant-UUID prefix — no new bucket or storage policy
-- needed). Mirrors incident_attachments (migration 061) plus the SHA-256
-- integrity stamp from loto_signed_pdf_artifacts (migration 150).
--
-- Child of em385_register_items: tenant_id for RLS, no facility_id.
--
-- Idempotent.

begin;

create table if not exists public.em385_document_files (
  id                uuid not null primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  register_item_id  uuid not null references public.em385_register_items(id) on delete cascade,

  -- Object key in `loto-photos`. Format (see core storagePaths.ts):
  --   {tenant_id}/em385/{register_item_id}/{ts}_{file_name}
  storage_path      text not null check (length(btrim(storage_path)) > 0),
  mime_type         text,
  file_size_bytes   int,
  -- Lowercase-hex SHA-256 integrity stamp computed client-side at upload.
  file_hash_sha256  text check (file_hash_sha256 is null or file_hash_sha256 ~ '^[0-9a-f]{64}$'),
  version_label     text,

  uploaded_by       uuid references auth.users(id),
  uploaded_at       timestamptz not null default now()
);

create index if not exists idx_em385_document_files_item
  on public.em385_document_files(register_item_id, uploaded_at desc);
create index if not exists idx_em385_document_files_tenant
  on public.em385_document_files(tenant_id);

alter table public.em385_document_files enable row level security;

drop policy if exists em385_document_files_tenant_scope on public.em385_document_files;
create policy em385_document_files_tenant_scope on public.em385_document_files
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

notify pgrst, 'reload schema';

commit;
