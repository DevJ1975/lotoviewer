-- Migration 217: jurisdiction, acute classification, and LDR fields on
-- hazardous_waste_streams.
--
-- These columns let the regulatory logic in @soteria/core/hazardousWaste
-- compute California-correct accumulation limits and the satellite cap:
--
--   jurisdiction   Federal vs. California rules. Decisive because California
--                  did NOT adopt the federal VSQG exemption — a California VSQG
--                  is held to the SQG accumulation limit (22 CCR 66262.16).
--                  Defaults to 'california' (the module is California-forward).
--
--   acute_class    none / acute (federal P-list & acute F-wastes) /
--                  extremely_hazardous (California EHW). Drives the satellite
--                  accumulation cap (40 CFR 262.15): 55 gal non-acute vs.
--                  1 qt liquid / 1 kg solid for acute-equivalent waste.
--
--   ldr_*          Land Disposal Restrictions (40 CFR 268.7): the one-time
--                  LDR notice/certification that accompanies the first shipment
--                  of each restricted stream — a frequent audit finding.
--
-- Additive, idempotent, non-breaking: every column has a NOT NULL default (or
-- is nullable), so existing rows backfill to safe values and existing write
-- paths keep working. No RLS change — the table's policies already cover these
-- columns.

begin;

alter table public.hazardous_waste_streams
  add column if not exists jurisdiction text not null default 'california'
    check (jurisdiction in ('federal', 'california'));

alter table public.hazardous_waste_streams
  add column if not exists acute_class text not null default 'none'
    check (acute_class in ('none', 'acute', 'extremely_hazardous'));

alter table public.hazardous_waste_streams
  add column if not exists ldr_restricted boolean not null default false;

alter table public.hazardous_waste_streams
  add column if not exists ldr_notice_sent boolean not null default false;

alter table public.hazardous_waste_streams
  add column if not exists ldr_notice_date date;

notify pgrst, 'reload schema';

commit;
