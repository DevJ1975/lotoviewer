-- Migration 246: enable RLS on public.em385_project_number_sequences.
--
-- Closes the rls_disabled_in_public advisor finding that migration 243
-- (243_security_advisor_fixes.sql) deliberately DEFERRED on this table,
-- pending verification of the write access path. That verification is now
-- done: the per-tenant EM 385 project-number counter is written ONLY by the
-- SECURITY DEFINER trigger function set_em385_project_number (fired
-- before insert on public.em385_projects via trg_set_em385_project_number,
-- migration 229). That function is owned by postgres — which owns this table
-- and has BYPASSRLS — so it writes the counter as the definer, never as the
-- client role. A deny-all policy for the authenticated role is therefore
-- safe: no invoker-rights path writes this table, so number assignment is
-- unaffected while the anon/authenticated roles lose direct table access.
--
-- Mirrors the canonical *_number_sequences hardening on bbs_number_sequences
-- (migration 165) and incident_number_sequences.
--
-- Correction (migration 250): this comment originally claimed
-- risk_number_sequences was already RLS-enabled and that em385 was the lone
-- outlier. Neither was true — risk_, near_miss_ and jha_number_sequences all
-- still had RLS off, and 250 is what actually finishes the sweep.
--
-- Idempotent: drop-policy-if-exists + enable-RLS are both safe to re-run.

begin;

drop policy if exists "em385_project_number_sequences_deny_app"
  on public.em385_project_number_sequences;

alter table public.em385_project_number_sequences enable row level security;

create policy "em385_project_number_sequences_deny_app"
  on public.em385_project_number_sequences
  for all to authenticated
  using (false)
  with check (false);

comment on table public.em385_project_number_sequences is
  'Per-tenant EM 385 project-number counter. Written only by the SECURITY DEFINER trigger set_em385_project_number on em385_projects. RLS is enabled with a deny-all policy for the authenticated role; the trigger bypasses RLS via its owner privileges.';

notify pgrst, 'reload schema';

commit;
