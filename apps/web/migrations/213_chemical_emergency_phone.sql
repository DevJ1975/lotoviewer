-- Migration 213: chemical_products.emergency_phone for first-aid mode.
--
-- The SDS parser already extracts the §1 emergency contact number
-- (ParsedSdsPayload.emergency_phone), but until now there was no column to
-- persist it onto the product. The first-aid emergency scan view needs a
-- tap-to-call number, so we add the column and the apply endpoint now
-- writes it (see app/api/chemicals/products/[id]/sds/[sdsId]/apply).
--
-- Idempotent — guarded with `if not exists`.

begin;

alter table chemical_products
  add column if not exists emergency_phone text;

commit;
