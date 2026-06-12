-- Migration 226: drop the duplicate index on loto_audit_equipment_results.
--
-- Migration 218 created loto_audit_equipment_results with BOTH:
--   • a `unique (run_id, equipment_id)` table constraint, whose backing index
--     loto_audit_equipment_results_run_id_equipment_id_key covers
--     (run_id, equipment_id), and
--   • a separate non-unique index idx_loto_audit_results_run on the SAME
--     columns in the SAME order.
--
-- The non-unique index is fully redundant: the unique index serves every query
-- the non-unique one would (identical leading columns + order), and the audit
-- engine upserts one row per (run_id, equipment_id) many times across a run, so
-- maintaining a second identical index is pure write amplification on the
-- busiest audit table. Drop it.
--
-- NOTE on audit_log: an earlier plan proposed adding (created_at desc) and
-- (actor_id, created_at desc) indexes to audit_log, but the live schema already
-- carries audit_log_actor_time_idx (actor_id, created_at desc),
-- idx_audit_log_tenant_time (tenant_id, created_at desc), and
-- audit_log_table_time_idx (table_name, created_at desc). Those additions would
-- be redundant and only add write cost on the hottest-written table, so they
-- are intentionally NOT included here.
--
-- Idempotent (IF EXISTS) and safe to re-run. DROP INDEX takes a brief lock on
-- loto_audit_equipment_results; the table is written only during audit runs and
-- read during review, so the momentary lock is negligible.

begin;

drop index if exists public.idx_loto_audit_results_run;

commit;
