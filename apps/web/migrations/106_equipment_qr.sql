-- Migration 106: QR tokens on loto_equipment.
--
-- PR3 of the AI redesign. Each equipment row gets a stable
-- random qr_token used as the QR-code payload printed on its
-- placard. Format: lowercase base32-without-padding, 16 chars
-- (≈80 bits). Globally unique so a token alone identifies
-- the equipment without requiring tenant context.
--
-- Why a separate token rather than the (tenant_id, equipment_id)
-- pair: keeps the QR payload short, side-steps the issue that
-- equipment_id is human-friendly and may collide across tenants,
-- and the token is opaque so a future revoke/rotate flow doesn't
-- have to invalidate a public-facing identifier.

begin;

-- Helper: generate a base32-ish 16-char token from a UUID.
-- We don't need cryptographic strength — pgcrypto's gen_random_uuid()
-- is sufficient entropy and we store unique ones anyway.
create or replace function public._gen_qr_token() returns text
language sql volatile
set search_path = public, pg_catalog
as $$
  select substr(
    -- Use the v4 UUID's hex digits as a 32-char alphabet of [0-9a-f].
    -- That's only 4 bits/char (vs 5 for true base32) but the column
    -- is 16 chars × 4 bits = 64 bits of entropy — plenty for placard
    -- IDs and avoids pulling in pgsodium just for a base32 helper.
    replace(gen_random_uuid()::text, '-', ''),
    1, 16
  );
$$;

alter table public.loto_equipment
  add column if not exists qr_token text;

-- Backfill rows without a token. The unique constraint blocks
-- collisions; in practice gen_random_uuid is collision-free at this
-- scale, but the loop guarantees forward progress if a freak repeat
-- happens.
do $$
declare
  remaining int;
begin
  loop
    update public.loto_equipment e
       set qr_token = public._gen_qr_token()
     where qr_token is null
       and not exists (
         select 1 from public.loto_equipment e2
          where e2.qr_token = public._gen_qr_token()
       );
    get diagnostics remaining = row_count;
    exit when remaining = 0;
  end loop;
end $$;

-- Now lock it down: NOT NULL + unique.
alter table public.loto_equipment
  alter column qr_token set not null;

create unique index if not exists ux_loto_equipment_qr_token
  on public.loto_equipment (qr_token);

-- New rows auto-generate a token. Apps still see the column on
-- insert; this is a safety net for direct SQL inserts.
create or replace function public._loto_equipment_qr_token_default()
returns trigger language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.qr_token is null or length(new.qr_token) = 0 then
    new.qr_token := public._gen_qr_token();
  end if;
  return new;
end $$;

drop trigger if exists trg_loto_equipment_qr_token on public.loto_equipment;
create trigger trg_loto_equipment_qr_token
  before insert on public.loto_equipment
  for each row execute function public._loto_equipment_qr_token_default();

comment on column public.loto_equipment.qr_token is
  'Opaque 16-char identifier printed as a QR code on the equipment placard. Resolves to this row via /scan.';

-- ── notifications table for in-app alerts (PR3 alerts.ts) ────────────────
-- The send_alert tool's 'in-app' channel writes here. The bell-icon
-- header pill (future) reads it. Kept minimal in PR3; richer fields
-- (severity, category, action_url) can land when the UI ships.
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 200),
  body        text not null check (length(trim(body)) between 1 and 4000),
  href        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "notifications_owner_read"   on public.notifications;
drop policy if exists "notifications_owner_update" on public.notifications;

-- Owners read + mark-as-read their own rows. Inserts come from the
-- service-role cron, so no insert policy is needed.
create policy "notifications_owner_read" on public.notifications
  for select to authenticated using (user_id = auth.uid());

create policy "notifications_owner_update" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;
