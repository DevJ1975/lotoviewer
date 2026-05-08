-- Migration 086: Optional captcha + geofence per QR token.
--
-- Plan phases 4b and 4d combined — they're both small per-token
-- toggles that the admin sets in the same edit modal.
--
-- require_captcha:   When true, the public submit endpoint rejects
--                    requests that don't carry a valid Cloudflare
--                    Turnstile token. Default false. Lazy-loaded
--                    on the form to avoid the third-party script
--                    on tokens that don't need it.
--
-- site_geo_lat/lng:  Geographic centre of the posted sign.
-- geofence_radius_m: Acceptable distance in metres. NULL = off.
--
-- A submit outside the radius is NEVER rejected — that would let
-- a single GPS hiccup drop a real safety report. Instead we record
-- incidents.geo_mismatch=true so triage can flag the submission
-- for review. The reporter is told nothing about the fence; from
-- their perspective the form behaves identically.

begin;

alter table public.incident_anon_intake_tokens
  add column if not exists require_captcha boolean not null default false;

alter table public.incident_anon_intake_tokens
  add column if not exists site_geo_lat double precision;
alter table public.incident_anon_intake_tokens
  add column if not exists site_geo_lng double precision;
alter table public.incident_anon_intake_tokens
  add column if not exists geofence_radius_m int
    check (geofence_radius_m is null or (geofence_radius_m between 50 and 50000));

-- Both lat/lng must be set together, or both null.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'anon_token_geo_pair'
  ) then
    alter table public.incident_anon_intake_tokens
      add constraint anon_token_geo_pair
      check ((site_geo_lat is null) = (site_geo_lng is null));
  end if;
end $$;

-- Soft flag on the incident row so triage can sort/filter for
-- geo mismatches. NULL means "geofence not in effect for this
-- report's token at submit time"; false means "in effect and within
-- radius"; true means "in effect and outside radius."
alter table public.incidents
  add column if not exists geo_mismatch boolean;

create index if not exists idx_incidents_geo_mismatch
  on public.incidents(tenant_id, reported_at desc)
  where geo_mismatch = true;

notify pgrst, 'reload schema';

commit;
