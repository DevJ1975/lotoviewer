-- Migration 304: STRIKE offline devices (the Soteria STRIKE tablet app).
--
-- A tablet in a plant dead zone plays a module with no connection and uploads
-- the attempt later. That needs three things the online player never did:
--
--   strike_devices        an enrolled shared tablet. A tenant admin enrolls it
--                         once and gets a secret shown a single time; only the
--                         sha256 of it is stored. The device sends it on every
--                         request, so revoking the row cuts the tablet off.
--                         Service role only: the admin page reads it through
--                         the API, which never returns the hash.
--
--   strike_attempts       client_attempt_id is generated on the device and is
--   (new columns)         the idempotency key: syncing the same attempt twice
--                         finds the first row instead of writing a second
--                         completion. client_started_at / client_submitted_at
--                         keep what the device's clock said (submitted_at and
--                         completed_at carry the clamped value used for the
--                         record), synced_at is when the server heard, and
--                         provisional_passed is the result the device showed
--                         the worker before the server graded it.
--
--   strike_block_events   occurred_at is when the learner did it on the
--   (new column)          device; created_at stays "when the server heard".
--
-- Idempotent.

begin;

create table if not exists public.strike_devices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  -- Optional roster scope: a tablet bolted to one line only lists that line's
  -- workers. Null means the whole tenant. Same labels members.department and
  -- members.site_label carry.
  department    text check (department is null or length(department) <= 80),
  site_label    text check (site_label is null or length(site_label) <= 80),
  secret_hash   text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  enrolled_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

create index if not exists strike_devices_tenant_idx
  on public.strike_devices(tenant_id, created_at desc);

alter table public.strike_devices enable row level security;
revoke all on public.strike_devices from anon, authenticated;

alter table public.strike_attempts
  add column if not exists client_attempt_id    uuid,
  add column if not exists device_id            uuid references public.strike_devices(id) on delete set null,
  add column if not exists client_started_at    timestamptz,
  add column if not exists client_submitted_at  timestamptz,
  add column if not exists synced_at            timestamptz,
  add column if not exists provisional_passed   boolean;

create unique index if not exists strike_attempts_client_attempt_uidx
  on public.strike_attempts(tenant_id, client_attempt_id)
  where client_attempt_id is not null;

alter table public.strike_block_events
  add column if not exists occurred_at timestamptz;

notify pgrst, 'reload schema';

commit;
