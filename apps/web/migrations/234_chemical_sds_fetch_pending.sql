-- Migration 234: chemical_products.sds_fetch_pending flag.
--
-- Phase 3 of the global SDS library introduces "adopt from library": cloning a
-- library entry into the tenant's catalog and fetching a FRESH manufacturer
-- copy of the SDS into the tenant's own storage. When that fetch fails (dead
-- link, non-PDF, host refusal), the product is still created — but we flag it
-- so the UI can prompt the safety lead to upload the SDS manually.
--
-- Deferred from migration 233 on purpose: it alters an in-use table for code
-- that only exists as of this phase (YAGNI).
--
-- Idempotent.

begin;

alter table public.chemical_products
  add column if not exists sds_fetch_pending boolean not null default false;

comment on column public.chemical_products.sds_fetch_pending is
  'Set when an adopt-from-library fetch could not retrieve the SDS PDF; the product exists but needs a manual SDS upload.';

notify pgrst, 'reload schema';

commit;
