-- Migration 250: finish the *_number_sequences RLS sweep.
--
-- risk_number_sequences (039), near_miss_number_sequences (042) and
-- jha_number_sequences (043) never had RLS enabled, so the anon and
-- authenticated roles can read and write them directly through PostgREST.
-- They are internal per-tenant counters — the leak is per-tenant record
-- volume, and the write is a nuisance (skewing or resetting the next issued
-- number), not an escalation. All three are live rls_disabled_in_public
-- advisor ERRORs.
--
-- Migration 246's header comment asserts these were already RLS-enabled and
-- that em385 was "the lone outlier". That was wrong, and it is corrected in
-- the same commit so the next auditor is not misled by it.
--
-- Safe by the same argument as 165 and 246: each counter is written only by
-- its SECURITY DEFINER trigger (set_risk_number, set_near_miss_number,
-- set_jha_number), which runs as the definer and bypasses RLS. Migration 124
-- already revoked EXECUTE on all three from anon/authenticated, so no
-- invoker-rights path reaches these tables and number assignment is
-- unaffected.
--
-- Idempotent: drop-policy-if-exists + enable-RLS are both safe to re-run.

begin;

drop policy if exists "risk_number_sequences_deny_app"
  on public.risk_number_sequences;

alter table public.risk_number_sequences enable row level security;

create policy "risk_number_sequences_deny_app"
  on public.risk_number_sequences
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists "near_miss_number_sequences_deny_app"
  on public.near_miss_number_sequences;

alter table public.near_miss_number_sequences enable row level security;

create policy "near_miss_number_sequences_deny_app"
  on public.near_miss_number_sequences
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists "jha_number_sequences_deny_app"
  on public.jha_number_sequences;

alter table public.jha_number_sequences enable row level security;

create policy "jha_number_sequences_deny_app"
  on public.jha_number_sequences
  for all to authenticated
  using (false)
  with check (false);

comment on table public.risk_number_sequences is
  'Per-tenant risk-number counter. Written only by the SECURITY DEFINER trigger set_risk_number on risks. RLS enabled with a deny-all policy for the authenticated role; the trigger bypasses RLS via its owner privileges.';

comment on table public.near_miss_number_sequences is
  'Per-tenant near-miss-number counter. Written only by the SECURITY DEFINER trigger set_near_miss_number. RLS enabled with a deny-all policy for the authenticated role; the trigger bypasses RLS via its owner privileges.';

comment on table public.jha_number_sequences is
  'Per-tenant JHA-number counter. Written only by the SECURITY DEFINER trigger set_jha_number. RLS enabled with a deny-all policy for the authenticated role; the trigger bypasses RLS via its owner privileges.';

notify pgrst, 'reload schema';

commit;
