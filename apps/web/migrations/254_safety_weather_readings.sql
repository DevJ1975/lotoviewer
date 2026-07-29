-- Migration 234: Safety Weather Board — onsite verification readings.
--
-- An append-only log of hand-measured wind taken on site (anemometer, handheld,
-- etc.) and stamped against the forecast that was showing at the time. Crews
-- record these to verify the board before a wind-sensitive task (crane pick,
-- scaffold erect) — see compareReadingToForecast in @soteria/core. Because a
-- reading is a point-in-time safety attestation, the rows are IMMUTABLE: like
-- the em385 audit log (migration 230), update/delete are blocked at both the
-- role-grant and trigger layers, so no updated_at / updated_by columns exist.
--
-- facility_id is nullable and shared, mirroring em385_projects (migration 229):
-- a NULL-facility reading is visible in both the roll-up and per-facility views.
--
-- Idempotent.

begin;

create table if not exists public.safety_weather_readings (
  id                 uuid not null primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  -- Plain uuid, intentionally NOT a foreign key. This append-only attestation
  -- records the site as a point-in-time historical fact and must survive a later
  -- facility deletion unchanged. A FK with on-delete-set-null/cascade would fire
  -- an UPDATE/DELETE that the immutability trigger below rejects, dead-locking
  -- facility removal. NULL = shared across the tenant (roll-up + every site).
  facility_id        uuid,

  reading_at         timestamptz not null default now(),

  -- Measured values, always stored in mph regardless of the operator's display
  -- units (unit_system records what they entered for audit fidelity).
  measured_wind_mph  double precision not null,
  measured_gust_mph  double precision,
  unit_system        text not null default 'imperial'
                       check (unit_system in ('imperial','metric')),
  instrument         text,

  -- Where the reading was taken, if the device captured it.
  latitude           double precision,
  longitude          double precision,

  -- The forecast snapshot the reading is being checked against. Nullable: a
  -- crew may log a raw measurement with no forecast on hand.
  forecast_wind_mph   double precision,
  forecast_gust_mph   double precision,
  forecast_fetched_at timestamptz,

  note               text,

  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id)
);

create index if not exists idx_safety_weather_readings_tenant
  on public.safety_weather_readings (tenant_id);
create index if not exists idx_safety_weather_readings_tenant_facility_time
  on public.safety_weather_readings (tenant_id, facility_id, reading_at desc);

-- ──────────────────────────────────────────────────────────────────────────
-- Immutability — readings are point-in-time safety attestations (per 230)
-- ──────────────────────────────────────────────────────────────────────────

-- Layer 1 — role grants.
revoke update, delete on public.safety_weather_readings from public;
revoke update, delete on public.safety_weather_readings from authenticated;
revoke update, delete on public.safety_weather_readings from anon;

-- Layer 2 — immutable trigger (defends against role grants we don't control,
-- e.g. table-owner paths).
create or replace function public.safety_weather_readings_immutable()
  returns trigger
  language plpgsql
as $$
begin
  raise exception 'safety_weather_readings is append-only (tg_op=% on row id=%)', tg_op, coalesce(old.id, new.id)
    using errcode = 'integrity_constraint_violation';
end $$;

drop trigger if exists trg_safety_weather_readings_immutable on public.safety_weather_readings;
create trigger trg_safety_weather_readings_immutable
  before update or delete on public.safety_weather_readings
  for each row
  execute function public.safety_weather_readings_immutable();

-- Generic CRUD trail into the shared audit_log (migration 003).
drop trigger if exists trg_audit_safety_weather_readings on public.safety_weather_readings;
create trigger trg_audit_safety_weather_readings
  after insert or update or delete on public.safety_weather_readings
  for each row
  execute function public.log_audit('id');

-- ──────────────────────────────────────────────────────────────────────────
-- Row-Level Security — tenant scope + nullable-facility allowance (per 229)
-- ──────────────────────────────────────────────────────────────────────────

alter table public.safety_weather_readings enable row level security;

drop policy if exists safety_weather_readings_tenant_scope on public.safety_weather_readings;
create policy safety_weather_readings_tenant_scope on public.safety_weather_readings
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
    and (
      public.active_facility_id() is null
      or facility_id = public.active_facility_id()
      or facility_id is null
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
    and (
      public.active_facility_id() is null
      or facility_id = public.active_facility_id()
      or facility_id is null
    )
  );

notify pgrst, 'reload schema';

commit;
