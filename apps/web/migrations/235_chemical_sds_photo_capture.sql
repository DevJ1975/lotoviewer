-- Migration 235: allow 'photo_capture' as an SDS document source.
--
-- Phase 4 of the global SDS library adds camera capture of a PAPER SDS:
-- a worker photographs the pages, the app assembles them into a PDF and
-- runs the existing parse → review pipeline. Those documents are tagged
-- source='photo_capture' so the review queue / audit can tell a photographed
-- sheet (lower OCR fidelity) apart from a born-digital upload or AI fetch.
--
-- chemical_sds_documents.source carries an inline CHECK (migration 089,
-- auto-named chemical_sds_documents_source_check). Replace it with the
-- widened allowlist.
--
-- Deferred from migration 233 on purpose (YAGNI): the value only has a
-- producer as of this phase.
--
-- Idempotent.

begin;

alter table public.chemical_sds_documents
  drop constraint if exists chemical_sds_documents_source_check;

alter table public.chemical_sds_documents
  add constraint chemical_sds_documents_source_check
  check (source in ('upload', 'ai_fetch', 'manufacturer_portal', 'photo_capture'));

notify pgrst, 'reload schema';

commit;
