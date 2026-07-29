-- Migration 233: Safety Weather Board — per-tenant/site threshold overrides.
--
-- Stores a PARTIAL SafetyWeatherConfig (see @soteria/core safetyWeather.ts) that
-- the app merges over DEFAULT_SAFETY_WEATHER_CONFIG via resolveSafetyWeatherConfig.
-- This lets a tenant raise the crane shutdown wind speed, shift the heat-index
-- bands, etc., without touching code. The persisted shape is the partial
-- override only, never the resolved config, so default changes ship to everyone.
--
-- facility_id is nullable and shared, mirroring em385_projects (migration 229):
-- a NULL-facility row is the TENANT DEFAULT, and a row with a facility_id
-- overrides it for that one site. To keep "one default + one per facility"
-- enforceable with a single unique index, NULL facility_id is folded to a
-- sentinel UUID (NULLs are distinct in a plain unique index, which would let
-- two tenant defaults coexist).
--
-- Idempotent.

begin;

create table if not exists public.safety_weather_settings (
  id          uuid not null primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  -- NULL = tenant default; a facility_id overrides it for that site.
  facility_id uuid references public.facilities(id) on delete cascade,

  -- A PartialSafetyWeatherConfig override. Empty object means "use defaults".
  config      jsonb not null default '{}'::jsonb,

  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

-- One settings row per (tenant, facility), including the single NULL-facility
-- tenant default. The sentinel coalesce is required because a plain unique
-- index treats NULLs as distinct, which would permit duplicate tenant defaults.
create unique index if not exists uq_safety_weather_settings_tenant_facility
  on public.safety_weather_settings (
    tenant_id,
    coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists idx_safety_weather_settings_tenant
  on public.safety_weather_settings (tenant_id);

drop trigger if exists trg_safety_weather_settings_touch_updated_at on public.safety_weather_settings;
create trigger trg_safety_weather_settings_touch_updated_at
  before update on public.safety_weather_settings
  for each row
  execute function public.touch_updated_at();

-- Generic CRUD audit into the shared audit_log (migration 003).
drop trigger if exists trg_audit_safety_weather_settings on public.safety_weather_settings;
create trigger trg_audit_safety_weather_settings
  after insert or update or delete on public.safety_weather_settings
  for each row
  execute function public.log_audit('id');

-- ──────────────────────────────────────────────────────────────────────────
-- Row-Level Security — tenant scope + nullable-facility allowance (per 229)
-- ──────────────────────────────────────────────────────────────────────────

alter table public.safety_weather_settings enable row level security;

drop policy if exists safety_weather_settings_tenant_scope on public.safety_weather_settings;
create policy safety_weather_settings_tenant_scope on public.safety_weather_settings
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
