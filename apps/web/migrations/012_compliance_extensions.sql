-- Migration 012: Three compliance gaps the audit flagged.
--
-- 1. loto_confined_space_entries  — per-entrant in/out timestamps. §1910.146(i)(4)
--    requires the attendant to know who's inside the space at any moment.
--    Today we store entrants[] as names on the permit but never timestamp
--    entry/exit; the home's "people in spaces" badge is a count of names,
--    not a count of bodies actually inside.
--
-- 2. loto_gas_meters             — bump-test / calibration register. §(d)(5)(i)
--    requires a calibrated direct-reading instrument; iNet's killer feature
--    is showing "this meter wasn't bump-tested today" before the reading
--    is even submitted. We capture instrument_id on every test but never
--    track the instrument's verification state.
--
-- 3. attendant + entrant signature columns on the permit row — §(f)(5),(6)
--    require entry-supervisor authorization, and many sites also want the
--    attendant to sign on shift and the supervisor to attest the crew was
--    briefed on hazards. Today only the supervisor signs.
--
-- Same conventions as 009-011: idempotent, RLS authenticated_all, audit
-- triggers reuse public.log_audit(pk_col) from migration 003.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. loto_confined_space_entries — attendant in/out log
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.loto_confined_space_entries (
  id            uuid primary key default gen_random_uuid(),
  permit_id     uuid not null
                  references public.loto_confined_space_permits(id)
                  on delete cascade,
  -- Name match against the permit's entrants[] array. We don't FK because
  -- entrants are name-based (no profile row) per migration 010 — the same
  -- design choice as the attendants/entrants rosters themselves.
  entrant_name  text not null,
  entered_at    timestamptz not null default now(),
  exited_at     timestamptz,
  -- The attendant on duty at the moment the in/out was logged. profiles FK
  -- because the attendant must have a login to record an entry. (The
  -- entrant is rostered by name; the attendant is the active user.)
  entered_by    uuid not null references public.profiles(id) on delete restrict,
  exited_by     uuid references public.profiles(id) on delete restrict,
  notes         text,
  created_at    timestamptz not null default now(),
  -- An exit cannot precede the entry. Equality is allowed because in/out
  -- can collapse to the same wall-clock instant if the attendant logs both
  -- after the fact. Future timestamps are NOT blocked here — there's no
  -- harm in a slightly-future entered_at if the device clock drifts.
  constraint entries_exit_after_entry
    check (exited_at is null or exited_at >= entered_at)
);

-- The hot query is "who is currently inside permit X" — exited_at IS NULL.
-- The partial index keeps it small even on a year of historical entries.
create index if not exists idx_entries_open
  on public.loto_confined_space_entries(permit_id)
  where exited_at is null;
-- Hard correctness guarantee: at most one OPEN entry per (permit, entrant).
-- Without this, a double-tap on "Log in" creates two open rows; the UI's
-- "currently inside" count over-reads and a single "Log out" only closes
-- one of them. The unique index lets the DB reject the second insert and
-- the existing error toast surfaces it cleanly. Closed entries (exited_at
-- IS NOT NULL) are exempt — re-entry is allowed once the prior cycle has
-- been closed.
create unique index if not exists idx_entries_one_open_per_entrant
  on public.loto_confined_space_entries(permit_id, entrant_name)
  where exited_at is null;
-- Full chronological history per permit for the audit trail / printed log.
create index if not exists idx_entries_permit_time
  on public.loto_confined_space_entries(permit_id, entered_at desc);

comment on table public.loto_confined_space_entries is
  'Per-entrant in/out timestamps. §1910.146(i)(4) requires the attendant to track who is inside the space at any moment. Each row corresponds to one entry/exit cycle for one named entrant.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. loto_gas_meters — bump-test / calibration register
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.loto_gas_meters (
  -- instrument_id matches loto_atmospheric_tests.instrument_id (free text on
  -- both sides; not a FK because old test rows pre-date this register and
  -- because some plants type the meter ID slightly differently each time —
  -- we'd rather show "unknown meter" on the permit than reject the reading).
  instrument_id        text primary key,
  description          text,
  -- Daily bump test per OSHA / ANSI guidance. Null = never bumped on this
  -- system. Surfaced on the permit form as "⚠ overdue" if today's date is
  -- after last_bump_at + 1 day.
  last_bump_at         timestamptz,
  -- Periodic full calibration — typically every 6 months for 4-gas meters.
  last_calibration_at  timestamptz,
  next_calibration_due timestamptz,
  decommissioned       boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_gas_meters_active
  on public.loto_gas_meters(instrument_id)
  where decommissioned = false;

comment on table public.loto_gas_meters is
  'Calibration / bump-test register for direct-reading atmospheric instruments per §1910.146(d)(5)(i). One row per physical meter (BW MicroClip, Ventis Pro5, etc.).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Multi-party signatures on the permit row
-- ────────────────────────────────────────────────────────────────────────────
-- attendant_signature_*    — the attendant on duty signs to confirm they
--                             are physically present and accept attendant
--                             responsibilities per §(i).
-- entrant_acknowledgement_at — the entry supervisor flips this once they
--                             have briefed the crew on hazards per §(f)(6).
--                             Single timestamp because the brief is a
--                             group act, not per-entrant.
alter table public.loto_confined_space_permits
  add column if not exists attendant_signature_at   timestamptz,
  add column if not exists attendant_signature_name text,
  add column if not exists entrant_acknowledgement_at timestamptz;

comment on column public.loto_confined_space_permits.attendant_signature_at is
  'Timestamp the rostered attendant clicked "I am on duty" — §1910.146(i). Optional: not all sites require an attendant sign-on, but when present it strengthens the audit trail.';
comment on column public.loto_confined_space_permits.entrant_acknowledgement_at is
  'Timestamp the entry supervisor attested entrants were briefed on hazards per §(f)(6). Single timestamp because the briefing is a group act.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS — authenticated_all pattern matching the rest of the module
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_confined_space_entries enable row level security;
alter table public.loto_gas_meters             enable row level security;

drop policy if exists "loto_confined_space_entries_authenticated_all" on public.loto_confined_space_entries;
create policy "loto_confined_space_entries_authenticated_all" on public.loto_confined_space_entries
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "loto_gas_meters_authenticated_all" on public.loto_gas_meters;
create policy "loto_gas_meters_authenticated_all" on public.loto_gas_meters
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Audit triggers — reuse public.log_audit(pk_col) from migration 003
-- ────────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_loto_confined_space_entries on public.loto_confined_space_entries;
create trigger trg_audit_loto_confined_space_entries
  after insert or update or delete on public.loto_confined_space_entries
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_loto_gas_meters on public.loto_gas_meters;
create trigger trg_audit_loto_gas_meters
  after insert or update or delete on public.loto_gas_meters
  for each row execute function public.log_audit('instrument_id');
