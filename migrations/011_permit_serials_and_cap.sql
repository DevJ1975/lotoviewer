-- Migration 011: traceable permit serials + 8-hour duration cap.
--
-- Two changes to loto_confined_space_permits:
--
-- 1. Add `serial` text column populated by a BEFORE INSERT trigger.
--    Format:  CSP-YYYYMMDD-NNNN  (e.g. CSP-20260423-0003)
--    The date component comes from started_at so the serial is human-
--    readable and orderable; NNNN is a per-day sequence so collisions
--    can't happen across days even on a busy site.
--
-- 2. Add a CHECK constraint enforcing expires_at - started_at ≤ 8 hours.
--    OSHA §1910.146(f)(3) says permits cannot exceed task time, and
--    site policy here treats a single shift (8h) as the hard maximum.
--    A supervisor who needs longer must cancel and re-issue — that
--    forces a fresh atmospheric test, which is the safety win.
--
-- Idempotent — both adds are guarded so re-running is a no-op.

-- ── 1. serial column + generator + trigger ─────────────────────────────────

alter table public.loto_confined_space_permits
  add column if not exists serial text;

create or replace function public.next_permit_serial(p_started_at timestamptz)
  returns text
  language plpgsql
  stable
as $$
declare
  date_part text := to_char(p_started_at, 'YYYYMMDD');
  seq int;
begin
  -- Sequence by-day: count permits already issued on this calendar day,
  -- bump by 1. Postgres serializes the BEFORE INSERT trigger relative
  -- to the unique index below so the rare race produces a duplicate-
  -- key error, not a silent duplicate serial.
  select coalesce(max(substring(serial from 14)::int), 0) + 1
    into seq
    from public.loto_confined_space_permits
   where serial like 'CSP-' || date_part || '-%';

  return 'CSP-' || date_part || '-' || lpad(seq::text, 4, '0');
end $$;

create or replace function public.set_permit_serial()
  returns trigger
  language plpgsql
as $$
begin
  if new.serial is null then
    new.serial := public.next_permit_serial(new.started_at);
  end if;
  return new;
end $$;

drop trigger if exists trg_set_permit_serial on public.loto_confined_space_permits;
create trigger trg_set_permit_serial
  before insert on public.loto_confined_space_permits
  for each row execute function public.set_permit_serial();

-- Backfill any pre-existing rows using a per-day ROW_NUMBER window.
--
-- Why not call next_permit_serial(started_at) here directly? That
-- function does a SELECT max(serial) inside a stable function called
-- once per UPDATE row — but a set-based UPDATE in Postgres reads from
-- the table snapshot BEFORE the update, so every backfilled row sees
-- the same max (initially NULL → 0001) and they all collide on the
-- unique index. ROW_NUMBER over a date-partitioned window numbers
-- rows consistently in a single set-based pass.
--
-- Idempotent: re-running this against an already-numbered table is a
-- no-op via the WHERE clause that skips rows whose serial already
-- matches what the window would assign. Also recovers from a
-- partially-applied earlier version of this migration that produced
-- duplicate serials — those rows get re-numbered here.
with numbered as (
  select id,
         'CSP-' || to_char(started_at, 'YYYYMMDD') || '-' ||
         lpad(row_number() over (
           partition by date_trunc('day', started_at)
           order by started_at, id
         )::text, 4, '0') as new_serial
    from public.loto_confined_space_permits
)
update public.loto_confined_space_permits p
   set serial = n.new_serial
  from numbered n
 where p.id = n.id
   and (p.serial is null or p.serial <> n.new_serial);

-- Unique constraint catches the (rare) race between two concurrent
-- inserts on the same day — second one will retry on app side.
create unique index if not exists idx_permits_serial_unique
  on public.loto_confined_space_permits(serial);

alter table public.loto_confined_space_permits
  alter column serial set not null;

comment on column public.loto_confined_space_permits.serial is
  'Human-readable serial CSP-YYYYMMDD-NNNN. Populated automatically by the BEFORE INSERT trigger. Date component reflects started_at.';

-- ── 2. 8-hour cap on expires_at ────────────────────────────────────────────

-- Drop the constraint first so re-running picks up an updated definition
-- if we ever change the cap.
alter table public.loto_confined_space_permits
  drop constraint if exists permit_duration_cap_8h;

alter table public.loto_confined_space_permits
  add constraint permit_duration_cap_8h
  check (expires_at - started_at <= interval '8 hours' and expires_at > started_at);

comment on constraint permit_duration_cap_8h on public.loto_confined_space_permits is
  'Site policy: permits cap at one shift (8h). Longer work requires cancel + re-issue, which forces a fresh atmospheric test per §1910.146(d)(5).';
