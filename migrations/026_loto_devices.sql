-- Migration 026: physical lock + tag inventory and checkouts.
--
-- Today the LOTO module is procedural — placards say "apply lock", but
-- nothing tracks WHICH physical lock is on WHICH equipment, who owns
-- it, or how long it's been out. That's the most common cause of LOTO
-- violations: a forgotten lock, a worker who left for the weekend with
-- their lock still on a panel, a lock pile on a workbench with no
-- accountability.
--
-- Two tables:
--   - loto_devices         the physical inventory (each lock + tag
--                          combo is one row).
--   - loto_device_checkouts ownership log: who has device X right now,
--                          when did they take it, what equipment is it
--                          on, when was it returned.
--
-- We keep the "current owner" on the device row as a denormalized
-- pointer (last open checkout) for fast read; the source of truth is
-- the checkouts table.
--
-- Idempotent — re-running this migration is a no-op.

-- ── 1. loto_devices ────────────────────────────────────────────────────────
create table if not exists public.loto_devices (
  id              uuid primary key default gen_random_uuid(),
  -- Human-readable label printed/etched on the lock body — e.g. the
  -- engraving "MNT-014". Free text because plants use whatever scheme
  -- their hardware vendor sells (numeric, alpha, alphanumeric).
  -- Unique because nobody owns two locks with the same engraving and
  -- the field staff would lose track immediately.
  device_label    text not null unique,
  -- Optional human description ("electrical room cabinet 4 lock #2").
  description     text,
  -- Lock kind. Free-text-with-CHECK so we can extend without a
  -- migration; the front end picks from a fixed list.
  kind            text not null default 'padlock'
                  check (kind in ('padlock', 'cable', 'hasp', 'group_box', 'other')),
  -- Lifecycle:
  --   available    = sitting on the rack, ready to be checked out
  --   checked_out  = on equipment somewhere; see open checkout row
  --   maintenance  = bench, cleaning, key cutting, awaiting return to service
  --   lost         = worker reported it missing — supervisor must clear
  status          text not null default 'available'
                  check (status in ('available', 'checked_out', 'maintenance', 'lost')),
  -- FK to the open checkout row (when status = 'checked_out'). Null
  -- when the device is available, in maintenance, or lost. Reset to
  -- null when the open checkout is closed. Helps the worker UI render
  -- "you currently hold lock MNT-014" without a JOIN.
  current_checkout_id uuid,
  notes           text,
  decommissioned  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_loto_devices_status
  on public.loto_devices(status)
  where decommissioned = false;

create index if not exists idx_loto_devices_label
  on public.loto_devices(device_label);

-- ── 2. loto_device_checkouts ───────────────────────────────────────────────
create table if not exists public.loto_device_checkouts (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.loto_devices(id) on delete cascade,
  -- The user who owns the lock for this checkout — the "lock-out
  -- responsible employee" per §1910.147. profiles FK because they
  -- must have a login to check out a device.
  owner_id      uuid not null references public.profiles(id) on delete restrict,
  -- The equipment this lock is being applied to. Free-text because
  -- some plants apply group locks to bays / circuits that don't map
  -- to a single equipment_id row. NULL = "I'm taking this lock with
  -- me, not on a specific tag yet" (rare).
  equipment_id  text,
  checked_out_at timestamptz not null default now(),
  -- Who recorded the checkout. Most often the same as owner_id (the
  -- worker checks out their own lock); a supervisor recording on
  -- behalf of a worker fills in their own profile here.
  recorded_by   uuid not null references public.profiles(id) on delete restrict,
  returned_at   timestamptz,
  returned_by   uuid references public.profiles(id) on delete restrict,
  notes         text,
  created_at    timestamptz not null default now(),
  -- Same constraint as confined-space entries — return after checkout.
  constraint checkouts_return_after_checkout
    check (returned_at is null or returned_at >= checked_out_at)
);

-- Hot lookup — open checkouts only. Like the entries table, this is
-- the "who has what right now" question.
create index if not exists idx_device_checkouts_open
  on public.loto_device_checkouts(device_id)
  where returned_at is null;

-- At most one open checkout per device. A second checkout while one is
-- open is the bug we want the DB to catch.
create unique index if not exists idx_device_checkouts_one_open
  on public.loto_device_checkouts(device_id)
  where returned_at is null;

create index if not exists idx_device_checkouts_owner_time
  on public.loto_device_checkouts(owner_id, checked_out_at desc);

-- ── 3. updated_at trigger on devices ───────────────────────────────────────
create or replace function public.touch_loto_device_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_loto_devices_updated on public.loto_devices;
create trigger trg_loto_devices_updated
  before update on public.loto_devices
  for each row
  execute function public.touch_loto_device_updated_at();

-- ── 4. RLS — admin read/write, authenticated read ──────────────────────────
--
-- Any authenticated user can SEE the device inventory and checkout
-- log (so a worker knows whether MNT-014 is available before walking
-- to the rack), but writes are admin-only at the API layer. Inserting
-- a checkout from the worker UI is the one exception — that's done
-- via service-role API routes, which bypass RLS regardless.

alter table public.loto_devices enable row level security;
drop policy if exists "loto_devices_authenticated_read" on public.loto_devices;
create policy "loto_devices_authenticated_read" on public.loto_devices
  for select to authenticated using (true);
drop policy if exists "loto_devices_admin_write" on public.loto_devices;
create policy "loto_devices_admin_write" on public.loto_devices
  for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

alter table public.loto_device_checkouts enable row level security;
drop policy if exists "loto_device_checkouts_authenticated_read" on public.loto_device_checkouts;
create policy "loto_device_checkouts_authenticated_read" on public.loto_device_checkouts
  for select to authenticated using (true);
drop policy if exists "loto_device_checkouts_admin_write" on public.loto_device_checkouts;
create policy "loto_device_checkouts_admin_write" on public.loto_device_checkouts
  for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- ── 5. comments ────────────────────────────────────────────────────────────
comment on table public.loto_devices is
  'Physical lock + tag inventory. One row per individually-trackable lock. Status is denormalized from the latest open checkout for fast read; loto_device_checkouts is the source of truth.';

comment on table public.loto_device_checkouts is
  'Per-checkout ownership log. open row (returned_at IS NULL) means the device is currently in the field on equipment_id under owner_id. Unique partial index ensures at most one open checkout per device.';
