-- Migration 082: Receipt code for anonymous reports.
--
-- Workers who file an anonymous report often want to know whether
-- the safety team did anything. The current flow gives them a
-- report number but no way to look up status without revealing
-- their identity (logging in defeats the anonymity).
--
-- Solution: at submit time, the reporter optionally generates a
-- 6-character alphanumeric PIN. We store sha256(report_number || pin)
-- in incidents.anon_receipt_hash. Later they visit /report/status,
-- type the report number + PIN, and we recompute the hash to look
-- up the matching row. No PII echoed back — only public-facing
-- status fields (open/investigating/closed) and any "shareable
-- summary" the safety team chose to publish.
--
-- The hash means we never store the PIN itself. Brute-forcing 6
-- alphanumeric characters is feasible (~57 billion combinations,
-- case-insensitive ~37^6 ≈ 2.5B), but the lookup endpoint is
-- IP-throttled (migration 085) so a remote attacker is bounded by
-- network round-trip * cooldown count.

begin;

alter table public.incidents
  add column if not exists anon_receipt_hash text;

-- Sparse partial index so the lookup query is cheap when only
-- ~1-5% of anonymous reports carry a receipt hash.
create index if not exists idx_incidents_anon_receipt_hash
  on public.incidents(anon_receipt_hash)
  where anon_receipt_hash is not null;

-- Public-facing summary the safety team can publish back to a
-- receipt holder. Optional — null means "no public update yet."
-- Distinct from the internal investigation notes; never includes
-- reporter PII (we don't have any) or witness names.
alter table public.incidents
  add column if not exists anon_public_status_note text;

notify pgrst, 'reload schema';

commit;
