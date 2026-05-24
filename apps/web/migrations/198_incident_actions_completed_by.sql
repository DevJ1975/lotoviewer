-- Migration 198: give incident_actions the ISO 45001 §10.2 different-verifier
-- guarantee (CAPA consolidation — phase 1, additive).
--
-- We're consolidating the two CAPA surfaces (incident_actions +
-- incident_capas, migration 152) onto incident_actions. incident_actions
-- (063) documented a "different person verifies the close" rule but never
-- recorded WHO completed the action, so it could not actually enforce it —
-- only incident_capas could (via completed_by_user_id + a trigger).
--
-- This adds completed_by + the same trigger guarantee to incident_actions.
-- It is purely additive: the column is nullable (legacy completed rows keep
-- a null completer and are unaffected), and the trigger only fires when both
-- completer and verifier are present. No data is migrated and no table is
-- dropped here — those are later phases, once this lands and is verified.
--
-- Idempotent.

begin;

alter table public.incident_actions
  add column if not exists completed_by uuid references auth.users(id);

-- Enforce separation of duty at the DB boundary so a hand-crafted update
-- can't let the completer sign off on their own work. Mirrors
-- incident_capas_enforce_different_verifier (migration 152).
create or replace function public.incident_actions_enforce_different_verifier()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
begin
  if new.verified_by is not null
     and new.completed_by is not null
     and new.verified_by = new.completed_by
  then
    raise exception 'verification must be performed by a different user from the completer (separation of duty)';
  end if;
  return new;
end $$;

drop trigger if exists trg_incident_actions_different_verifier on public.incident_actions;
create trigger trg_incident_actions_different_verifier
  before insert or update on public.incident_actions
  for each row execute function public.incident_actions_enforce_different_verifier();

notify pgrst, 'reload schema';

commit;
