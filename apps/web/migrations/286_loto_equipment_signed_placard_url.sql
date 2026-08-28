-- Migration 286: add loto_equipment.signed_placard_url (chain-gap repair).
--
-- PROPOSED REPAIR, found during the 2026-08-28 migration reconciliation —
-- not a recovery of anything that ever ran in production.
--
-- No migration in the chain creates this column, yet the code assumes it
-- everywhere: 134_loto_review_business_rules.sql's
-- apply_loto_review_photo_replacement() nulled it on photo replacement
-- (that function was later dropped by 215), and 16 call sites in apps/web
-- still select it (e.g. app/departments/[dept]/page.tsx's placard-signing
-- readiness check). In production the column does not exist, so those
-- selects 400 and placard signing counts every item as failed — the bug
-- documented in docs/audits/saas-evaluation-2026-08-20.md §2.3. A fresh
-- rebuild reproduces the same breakage: 134's function bodies compile
-- (plpgsql defers column resolution) and then fail at first call.
--
-- Verify before/after:
--   select column_name from information_schema.columns
--    where table_name = 'loto_equipment' and column_name = 'signed_placard_url';
--
-- Idempotent: `add column if not exists`; nullable text, no default, no
-- rewrite — instant on any Postgres version this project runs.

alter table public.loto_equipment
  add column if not exists signed_placard_url text;

notify pgrst, 'reload schema';
