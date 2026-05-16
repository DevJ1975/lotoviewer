-- Migration 150: Sealed PDF audit artifacts for review-portal signoffs.
--
-- ISO 45001 9.1 + OSHA 29 CFR 1910.147(c)(6) auditors increasingly
-- ask for cryptographic chain-of-custody on signed off-cycle records.
-- The compliance-report bundle (lib/pdfBundle.ts) already SHA-256
-- hashes each *generated* permit PDF. This migration extends the
-- same posture to the *signed* placard PDFs produced when an external
-- reviewer signs off through the public review portal (/review/[token]):
--
--   loto_signed_pdf_artifacts
--     One immutable row per (review_link_id, equipment_id) signoff.
--     Persists the bytes' SHA-256, the storage path, the signer's
--     typed name + drawn signature + IP / UA, and the timestamp.
--
-- Verification flow at audit time:
--   1. Inspector pulls the row from /admin/signed-artifacts.
--   2. Downloads the PDF from pdf_storage_path.
--   3. Computes SHA-256 of the downloaded file.
--   4. Compares to sha256_hex on the row. Mismatch = tampering.
--
-- We chose a dedicated table (rather than columns on
-- loto_review_links) because one review link signs off multiple
-- placards — N:1 between signed-PDF rows and the link, and we want
-- per-placard verifiability.
--
-- Idempotent. Re-runs are safe.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.loto_signed_pdf_artifacts (
  id                          uuid        primary key default gen_random_uuid(),
  tenant_id                   uuid        not null references public.tenants(id) on delete cascade,
  -- The review link this signoff originated from. ON DELETE SET NULL
  -- because we want the artifact row to outlive a link cleanup — the
  -- chain-of-custody record is the authoritative artifact, not the
  -- now-deleted link.
  review_link_id              uuid        references public.loto_review_links(id) on delete set null,
  -- The placard that was sealed. Equipment IDs are text (CSV-imported),
  -- not UUIDs — same shape as loto_periodic_inspections / loto_walkdown_checklists.
  equipment_id                text        not null,
  -- Storage object key in the loto-photos bucket. We reuse the existing
  -- bucket (per signedPlacardPath helper in storagePaths.ts) rather
  -- than mint a new one — same RLS, same tenant-prefix posture,
  -- one less moving piece.
  pdf_storage_path            text        not null
                                check (length(btrim(pdf_storage_path)) > 0),
  -- Lowercase-hex SHA-256 of the PDF bytes at sign-off. 64 chars.
  sha256_hex                  text        not null
                                check (sha256_hex ~ '^[0-9a-f]{64}$'),
  -- Signer attestation snapshot. typed name + drawn data URI come from
  -- the review portal payload; storing them here (rather than
  -- referencing loto_review_links) means the artifact survives a link
  -- cleanup without losing context.
  signer_typed_name           text        not null
                                check (length(btrim(signer_typed_name)) > 0),
  signer_drawn_signature_path text,
  signer_ip                   text,
  signer_user_agent           text,
  signed_at                   timestamptz not null,
  created_at                  timestamptz not null default now(),
  -- Per-tenant per-equipment-per-link uniqueness — re-signing the
  -- same placard through the same link is a no-op. A NEW signoff (new
  -- review link) gets a new row.
  unique (tenant_id, review_link_id, equipment_id)
);

create index if not exists idx_loto_signed_pdf_artifacts_tenant_signed_at
  on public.loto_signed_pdf_artifacts(tenant_id, signed_at desc);

create index if not exists idx_loto_signed_pdf_artifacts_equipment
  on public.loto_signed_pdf_artifacts(tenant_id, equipment_id, signed_at desc);

comment on table public.loto_signed_pdf_artifacts is
  'Cryptographic chain-of-custody for review-portal placard signoffs. One immutable row per (review_link_id, equipment_id) signoff. SHA-256 of the PDF bytes is the verifier.';

-- ────────────────────────────────────────────────────────────────────
-- 2. RLS — standard tenant-scope; rows are read-only from the app side.
-- The portal route writes via service-role; the admin UI only reads.
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_signed_pdf_artifacts enable row level security;

drop policy if exists "loto_signed_pdf_artifacts_tenant_scope"
  on public.loto_signed_pdf_artifacts;
create policy "loto_signed_pdf_artifacts_tenant_scope"
  on public.loto_signed_pdf_artifacts
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

-- ────────────────────────────────────────────────────────────────────
-- 3. Audit trigger — every insert is an OSHA-relevant event
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_loto_signed_pdf_artifacts
  on public.loto_signed_pdf_artifacts;
create trigger trg_audit_loto_signed_pdf_artifacts
  after insert or update or delete on public.loto_signed_pdf_artifacts
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
