-- Migration 187: Soteria-authored module manuals as a knowledge_source_type.
--
-- The existing source types describe external corpora — federal OSHA
-- (regulation), Cal/OSHA (state_reg), DOT, EPA, RCRA — plus per-tenant
-- company policies. The wiki manuals at /wiki/<module>/ are a different
-- shape: Soteria authors them, they're hybrid regulatory-plus-procedural
-- content, and they're global (visible to every tenant) but not strictly
-- regulations themselves.
--
-- Adding a dedicated `module_manual` value lets the assistant filter by
-- source when an operator asks "what does Soteria's Working at Heights
-- manual say about anchor inspection" vs "what does 29 CFR 1910.140 say
-- about anchor inspection" — two related but distinct citations.

begin;

alter type public.knowledge_source_type add value if not exists 'module_manual';

commit;

-- Postgres prohibits using a newly-added enum value in the same
-- transaction it was created. Splitting into a second transaction so
-- the value is committed before any seed script can reference it.
