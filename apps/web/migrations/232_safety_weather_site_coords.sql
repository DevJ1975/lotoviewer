-- Migration 232: Safety Weather Board — per-site geocoordinates + timezone.
--
-- The Safety Weather Board fetches a per-facility forecast (Open-Meteo for
-- conditions, NWS for US severe alerts). Both APIs are keyed by latitude /
-- longitude, and the timezone tells Open-Meteo which civil day to align its
-- daily roll-up to. These three columns hang off the existing facilities
-- registry (migration 209) rather than a side table because a facility has at
-- most one location and the forecast is meaningless without it.
--
-- All nullable: a facility without coordinates simply has no weather board
-- until an admin geocodes it. Purely additive and non-breaking.
--
-- Idempotent.

begin;

alter table public.facilities
  add column if not exists latitude         double precision,
  add column if not exists longitude        double precision,
  add column if not exists weather_timezone text;

comment on column public.facilities.latitude is
  'Facility latitude (WGS84 decimal degrees). With longitude, keys the per-site Open-Meteo forecast and NWS alert lookup for the Safety Weather Board. NULL = no weather board for this facility.';
comment on column public.facilities.longitude is
  'Facility longitude (WGS84 decimal degrees). See facilities.latitude.';
comment on column public.facilities.weather_timezone is
  'IANA timezone (e.g. America/Chicago) Open-Meteo aligns the daily forecast roll-up to. NULL falls back to the API default.';

notify pgrst, 'reload schema';

commit;
