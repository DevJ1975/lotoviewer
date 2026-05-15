-- Migration 140: Structured procedure steps for 29 CFR 1910.147(c)(4)(ii).
--
-- §1910.147(c)(4)(ii)(A-D) requires the documented procedure to spell
-- out a specific sequence: shutdown, isolation, release of stored
-- energy, lockout, and verification of de-energization (tryout). Today
-- loto_energy_steps stores the steps as free-text tag_description +
-- isolation_procedure pairs, which means the auditor reading a placard
-- has to infer which sentence is the "verify zero energy" step.
--
-- This migration adds two columns + one CHECK to loto_energy_steps so
-- each row is explicitly tagged with its phase and ordering. The
-- placard renderer + validator can then guarantee:
--   - every procedure has at least one verify_zero_energy / tryout step
--   - the rendered placard groups steps by phase in OSHA's order
--   - sequence_order disambiguates multi-energy procedures (e.g. two
--     "isolate" steps for separate disconnects on the same machine)
--
-- Backfill: existing rows get step_type = 'isolate' (the dominant
-- phase in the historical free-text) and sequence_order = step_number
-- (preserves the existing ordering invariant). tryout_required defaults
-- to false on backfill; the validator only fails when a procedure has
-- NO verify_zero_energy step at all, so existing rows that contained
-- "attempt restart to verify" text but were tagged 'isolate' won't
-- block placard regeneration — they just need an admin to retag one
-- step as verify_zero_energy.
--
-- Idempotent: re-runs are safe (columns are added if missing; the
-- backfill skips rows that already have a non-null step_type).

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. Columns
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_energy_steps
  add column if not exists step_type text;

alter table public.loto_energy_steps
  add column if not exists sequence_order integer;

alter table public.loto_energy_steps
  add column if not exists tryout_required boolean not null default false;

comment on column public.loto_energy_steps.step_type is
  'Which §147(c)(4)(ii) phase this step covers. shutdown | isolate | release_stored_energy | lockout | verify_zero_energy. The placard groups by this column.';
comment on column public.loto_energy_steps.sequence_order is
  'Display order within the procedure. Independent of step_number so renumbering does not require a write storm on every row.';
comment on column public.loto_energy_steps.tryout_required is
  'True when this step is the §147(d)(6) tryout — the attempted operation that verifies de-energization. The placard prints a TRYOUT badge next to the step.';

-- ────────────────────────────────────────────────────────────────────
-- 2. Backfill — tag legacy rows with a best-effort phase + ordering
-- ────────────────────────────────────────────────────────────────────
-- Heuristic only. Admins should re-tag verify_zero_energy steps after
-- this migration runs; the validator surfaces the gap.
update public.loto_energy_steps
   set step_type = 'isolate'
 where step_type is null;

update public.loto_energy_steps
   set sequence_order = step_number
 where sequence_order is null;

-- ────────────────────────────────────────────────────────────────────
-- 3. Constraints (after backfill so they don't reject existing data)
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_energy_steps
  alter column step_type set not null;

alter table public.loto_energy_steps
  alter column sequence_order set not null;

-- Drop-and-create so re-runs are safe and the predicate stays correct
-- if the enum membership ever changes.
alter table public.loto_energy_steps
  drop constraint if exists loto_energy_steps_step_type_check;

alter table public.loto_energy_steps
  add constraint loto_energy_steps_step_type_check
    check (step_type in ('shutdown', 'isolate', 'release_stored_energy', 'lockout', 'verify_zero_energy'));

create index if not exists idx_loto_energy_steps_phase_order
  on public.loto_energy_steps(equipment_id, tenant_id, sequence_order);

notify pgrst, 'reload schema';

commit;
