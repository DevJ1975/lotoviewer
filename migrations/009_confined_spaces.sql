-- Migration 009: Confined Space module — federal OSHA 29 CFR 1910.146.
--
-- Adds three tables modelled on the inventory + permit + reading shape
-- mandated by §1910.146:
--   loto_confined_spaces            — the inventory of permit-required spaces
--   loto_confined_space_permits     — entry permits (15-element form per §(f))
--   loto_atmospheric_tests          — pre-entry + periodic readings per §(d)(5)
--
-- Design notes:
--   • Same naming prefix (`loto_*`) as the existing tables to keep schema
--     navigation consistent. The product surface ("Confined Spaces" vs
--     "LOTO") is a UI concern, not a schema one.
--   • RLS uses the same authenticated_all pattern as loto_equipment /
--     loto_energy_steps from migration 003. Department-scoping is a
--     deliberate non-goal for this slice — open question in the plan.
--   • text-with-CHECK rather than CREATE TYPE so we can add values
--     without a follow-up migration (matches the existing style on
--     loto_equipment.photo_status).
--   • Audit triggers reuse the public.log_audit(pk_col) function from
--     migration 003 — every insert/update/delete on these new tables
--     lands in audit_log with the same shape as equipment edits.
--   • Photo URLs reuse the existing `loto-photos` bucket from
--     migration 005 under a `confined-spaces/{space_id}/...` prefix —
--     no new storage RLS needed.
--   • Idempotent (`if not exists`, `drop policy if exists`) so re-runs
--     in the SQL editor are safe.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. loto_confined_spaces — inventory
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.loto_confined_spaces (
  space_id              text primary key,
  description           text not null,
  department            text not null,
  classification        text not null default 'permit_required'
                          check (classification in ('permit_required', 'non_permit', 'reclassified')),
  space_type            text not null default 'other'
                          check (space_type in (
                            'tank', 'silo', 'vault', 'pit', 'hopper',
                            'vessel', 'sump', 'plenum', 'manhole', 'other'
                          )),
  entry_dimensions      text,
  -- Persistent hazards always present in this space — informs default
  -- permit hazard list. Free-form to allow site-specific terminology.
  known_hazards         text[] not null default '{}',
  -- Per-space override of atmospheric thresholds. NULL = use site defaults
  -- (O2 19.5–23.5%, LEL <10%, H2S <10ppm, CO <35ppm). Shape:
  --   { o2_min, o2_max, lel_max, h2s_max, co_max, other?: [{name,unit,max}] }
  acceptable_conditions jsonb,
  isolation_required    text,
  equip_photo_url       text,
  interior_photo_url    text,
  internal_notes        text,
  decommissioned        boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_loto_confined_spaces_department
  on public.loto_confined_spaces(department);
create index if not exists idx_loto_confined_spaces_classification
  on public.loto_confined_spaces(classification)
  where decommissioned = false;

comment on table public.loto_confined_spaces is
  'Inventory of confined spaces per OSHA 29 CFR 1910.146. One row per physical space.';
comment on column public.loto_confined_spaces.acceptable_conditions is
  'Per-space override of atmospheric thresholds. NULL means use site defaults.';
comment on column public.loto_confined_spaces.internal_notes is
  'Private staff notes — never printed on the permit. Mirrors the loto_equipment.internal_notes pattern (migration 008).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. loto_confined_space_permits — entry permits
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.loto_confined_space_permits (
  id                              uuid primary key default gen_random_uuid(),
  space_id                        text not null
                                    references public.loto_confined_spaces(space_id)
                                    on update cascade
                                    on delete restrict,
  -- §1910.146(f)(2)
  purpose                         text not null,
  -- §1910.146(f)(3) — duration cannot exceed task time. Validated in app.
  started_at                      timestamptz not null default now(),
  expires_at                      timestamptz not null,
  canceled_at                     timestamptz,
  -- §1910.146(f)(6) — entry supervisor authorizes the permit. The signature
  -- is a click-while-logged-in: capture user_id + the time the click landed.
  -- A drawn-signature flow can layer on top later without a schema change.
  entry_supervisor_id             uuid not null references public.profiles(id) on delete restrict,
  entry_supervisor_signature_at   timestamptz,
  -- §1910.146(f)(4)(5) — rosters. uuid arrays referencing profiles. Postgres
  -- doesn't enforce FK on array elements, so the app layer must validate.
  attendants                      uuid[] not null default '{}',
  entrants                        uuid[] not null default '{}',
  -- §1910.146(f)(7)
  hazards_present                 text[] not null default '{}',
  -- §1910.146(f)(8) — `[{type: 'LOTO', ref: 'EQ-123'}, {type: 'ventilation', method: 'forced air'}]`
  isolation_measures              jsonb not null default '[]'::jsonb,
  -- §1910.146(f)(9) — same shape as loto_confined_spaces.acceptable_conditions
  acceptable_conditions_override  jsonb,
  -- §1910.146(f)(11) — `{name, phone, eta_minutes, equipment: text[]}`
  rescue_service                  jsonb not null default '{}'::jsonb,
  -- §1910.146(f)(12)
  communication_method            text,
  -- §1910.146(f)(13)
  equipment_list                  text[] not null default '{}',
  -- §1910.146(f)(15) — concurrent permits (hot work, etc). Free-text for now.
  concurrent_permits              text,
  -- §1910.146(f)(14) — additional safety info
  notes                           text,
  -- §1910.146(e)(5) — cancellation requires a reason
  cancel_reason                   text
                                    check (cancel_reason is null or cancel_reason in (
                                      'task_complete', 'prohibited_condition', 'expired', 'other'
                                    )),
  cancel_notes                    text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  -- Cancellation rules: canceled_at and cancel_reason go together
  constraint cancel_state_consistent
    check ((canceled_at is null) = (cancel_reason is null))
);

create index if not exists idx_permits_space_id
  on public.loto_confined_space_permits(space_id);
create index if not exists idx_permits_open
  on public.loto_confined_space_permits(space_id, started_at desc)
  where canceled_at is null;
-- Annual-review query (§1910.146(d)(14)): "all canceled permits in the past
-- 12 months grouped by reason". canceled_at is the natural sort key.
create index if not exists idx_permits_canceled_at
  on public.loto_confined_space_permits(canceled_at desc)
  where canceled_at is not null;

comment on table public.loto_confined_space_permits is
  'Permit-required confined space entry permits per OSHA 29 CFR 1910.146(f). Canceled permits are retained ≥1 year per §(e)(6) — never hard-delete.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. loto_atmospheric_tests — readings tied to a permit
-- ────────────────────────────────────────────────────────────────────────────
-- §1910.146(d)(5) requires tests in this order: O2, then combustibles (LEL),
-- then toxics (H2S/CO most commonly). All four are stored on the row to keep
-- the typical 4-gas reading flat; rare additional channels go in
-- other_readings as `[{name, value, unit, threshold}]`.
create table if not exists public.loto_atmospheric_tests (
  id              uuid primary key default gen_random_uuid(),
  permit_id       uuid not null
                    references public.loto_confined_space_permits(id)
                    on delete cascade,
  tested_at       timestamptz not null default now(),
  tested_by       uuid not null references public.profiles(id) on delete restrict,
  o2_pct          numeric(4, 1),
  lel_pct         numeric(4, 1),
  h2s_ppm         numeric(6, 1),
  co_ppm          numeric(6, 1),
  other_readings  jsonb not null default '[]'::jsonb,
  -- Calibrated direct-reading instrument required by §(d)(5)(i). Capture
  -- the meter ID so the app can surface stale calibration.
  instrument_id   text,
  kind            text not null default 'pre_entry'
                    check (kind in ('pre_entry', 'periodic', 'post_alarm')),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_atmos_tests_permit
  on public.loto_atmospheric_tests(permit_id, tested_at desc);

comment on table public.loto_atmospheric_tests is
  'Atmospheric test readings tied to a permit. §1910.146(d)(5) mandates tester ID + timestamp on every reading.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS — same authenticated_all pattern as migration 003
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_confined_spaces        enable row level security;
alter table public.loto_confined_space_permits enable row level security;
alter table public.loto_atmospheric_tests      enable row level security;

drop policy if exists "loto_confined_spaces_authenticated_all" on public.loto_confined_spaces;
create policy "loto_confined_spaces_authenticated_all" on public.loto_confined_spaces
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "loto_confined_space_permits_authenticated_all" on public.loto_confined_space_permits;
create policy "loto_confined_space_permits_authenticated_all" on public.loto_confined_space_permits
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "loto_atmospheric_tests_authenticated_all" on public.loto_atmospheric_tests;
create policy "loto_atmospheric_tests_authenticated_all" on public.loto_atmospheric_tests
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Audit triggers — reuse public.log_audit(pk_col) from migration 003
-- ────────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_loto_confined_spaces on public.loto_confined_spaces;
create trigger trg_audit_loto_confined_spaces
  after insert or update or delete on public.loto_confined_spaces
  for each row execute function public.log_audit('space_id');

drop trigger if exists trg_audit_loto_confined_space_permits on public.loto_confined_space_permits;
create trigger trg_audit_loto_confined_space_permits
  after insert or update or delete on public.loto_confined_space_permits
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_loto_atmospheric_tests on public.loto_atmospheric_tests;
create trigger trg_audit_loto_atmospheric_tests
  after insert or update or delete on public.loto_atmospheric_tests
  for each row execute function public.log_audit('id');
