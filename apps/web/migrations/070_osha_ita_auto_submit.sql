-- 070_osha_ita_auto_submit.sql
-- Per-establishment opt-in for the daily auto-submit cron.
--
-- When `ita_auto_submit_enabled` is true on an establishment, and:
--   - it has both ita_establishment_id + ita_api_token configured
--   - the year-N 300A annual summary is certified
--   - the year-N summary has not yet been submitted_to_ita_at
-- ...the daily cron will POST it to OSHA on the tenant's behalf.
--
-- Default false. Admins flip the checkbox on the Establishments
-- page after pasting their token. The cron also rate-limits per
-- establishment so a single failure (network blip, OSHA outage)
-- doesn't hammer OSHA — failures are logged in
-- ita_auto_submit_last_attempt_at + ita_auto_submit_last_error so
-- the admin can see what happened and the cron backs off.

alter table public.osha_establishments
  add column if not exists ita_auto_submit_enabled       boolean      not null default false,
  add column if not exists ita_auto_submit_last_attempt_at timestamptz,
  add column if not exists ita_auto_submit_last_error    text;

comment on column public.osha_establishments.ita_auto_submit_enabled is
  'When true, the osha-ita-auto-submit cron will POST certified 300As to OSHA ITA on the admin''s behalf.';
comment on column public.osha_establishments.ita_auto_submit_last_attempt_at is
  'Timestamp of the last cron attempt — set on every run regardless of outcome to support backoff.';
comment on column public.osha_establishments.ita_auto_submit_last_error is
  'Error message from the last failed attempt, cleared on success. Surfaces on the admin Establishments page.';

-- Cron lookup index: opted-in + creds present.
create index if not exists idx_establishments_auto_submit_candidates
  on public.osha_establishments(tenant_id)
  where ita_auto_submit_enabled = true
    and ita_api_token is not null
    and ita_establishment_id is not null;
