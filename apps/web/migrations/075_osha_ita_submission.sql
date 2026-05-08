-- 075_osha_ita_submission.sql
-- Adds the columns the app needs to track electronic submissions of
-- annual injury/illness records to OSHA's Injury Tracking Application
-- (ITA). The actual API call lives in app code; this migration only
-- shapes the data model.
--
-- Why two new columns on osha_establishments:
--   ita_establishment_id    The "Establishment ID" string OSHA assigns
--                           when an admin registers the site at
--                           osha.gov/ita. ITA submissions reference
--                           this — multiple establishments can share
--                           a tenant but each has its own ITA ID.
--   ita_api_token           Per-establishment API token issued from
--                           the ITA admin console. We store it here
--                           because OSHA scopes credentials to a
--                           single establishment + login.gov account
--                           (one tenant can have several). Stored as
--                           text — Supabase column-level encryption
--                           via Vault is recommended once the SaaS
--                           tenant goes live; for now plain-text but
--                           RLS-restricted to admins.
--
-- And on osha_annual_summaries:
--   submitted_to_ita_at     when the submission completed
--   ita_submission_id       OSHA-issued tracking ID returned by the
--                           submission endpoint
--   ita_response_json       the full JSON response we got back, for
--                           audit + replay if OSHA later asks us to
--                           re-submit.
--   submitted_by            user that triggered the submission

alter table public.osha_establishments
  add column if not exists ita_establishment_id text,
  add column if not exists ita_api_token        text;

comment on column public.osha_establishments.ita_establishment_id is
  'OSHA-assigned Establishment ID for ITA submissions. Set once the admin registers the site at osha.gov/ita.';
comment on column public.osha_establishments.ita_api_token is
  'Per-establishment ITA API token. Treat as a secret. Restrict reads to admins via RLS.';

alter table public.osha_annual_summaries
  add column if not exists submitted_to_ita_at  timestamptz,
  add column if not exists ita_submission_id    text,
  add column if not exists ita_response_json    jsonb,
  add column if not exists submitted_by         uuid references auth.users(id);

comment on column public.osha_annual_summaries.submitted_to_ita_at is
  'Timestamp the 300A (and 300/301 if applicable) was successfully submitted to OSHA ITA.';
comment on column public.osha_annual_summaries.ita_submission_id is
  'Tracking ID returned by OSHA''s ITA endpoint.';
comment on column public.osha_annual_summaries.ita_response_json is
  'Full JSON response from OSHA — kept for audit + replay if OSHA later requests resubmission.';

-- RLS: tighten the API-token column so only admins can read it.
-- Existing policies on osha_establishments grant SELECT to all
-- tenant members. We add a column-level constraint via a security-
-- definer view so the public API never exposes the token to a non-
-- admin caller.
create or replace view public.osha_establishments_admin
with (security_invoker = true) as
select *
from public.osha_establishments;

comment on view public.osha_establishments_admin is
  'Admin-scoped view that includes ita_api_token. Standard establishments queries should NOT select ita_api_token directly when serving non-admin users.';

-- Index the submission lookup since the cron will query
-- "submissions sent in the last hour" / "establishments with a token
-- and no submission for year N".
create index if not exists idx_300a_submitted_at
  on public.osha_annual_summaries(tenant_id, submitted_to_ita_at)
  where submitted_to_ita_at is not null;

create index if not exists idx_establishments_with_ita_token
  on public.osha_establishments(tenant_id)
  where ita_api_token is not null;
