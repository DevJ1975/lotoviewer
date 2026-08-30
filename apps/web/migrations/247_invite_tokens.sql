-- Migration 247: first-party invite tokens.
--
-- Invite emails used to carry a plaintext one-time password — a classic
-- phishing-content pattern that spam filters score against, and a real
-- secret-in-email. Invites now carry a single-use LINK to
-- /accept-invite?token=<raw>, where the recipient sets their own
-- password. Only the sha256 hash of the token is stored; the raw token
-- exists only in the email (and in the admin UI's copy fallback).
--
-- Lifecycle: issuing a new token for a user SUPERSEDES their previous
-- active token (stamped, never deleted), so a resend or cron reminder
-- always invalidates older links. Accepting stamps used_at. Expiry is
-- app-controlled (default 14 days — long enough to span the weekly
-- reminder cadence from migration 190, unlike Supabase recovery links
-- which cap at 24h and share one token slot with /forgot-password).
--
-- Idempotent: re-runs are safe.

begin;

create table if not exists public.invite_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Tenant context for the acceptance page copy + cancelled-invite check.
  -- NULL survives tenant deletion so the token row stays auditable.
  tenant_id     uuid references public.tenants(id) on delete set null,
  email         text not null,
  -- sha256 hex of the raw token. The raw 256-bit token is never stored.
  token_hash    text not null unique,
  -- Inviting admin; NULL when minted by the reminder cron.
  created_by    uuid,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  superseded_at timestamptz
);

-- Supersede-on-issue scans "this user's active tokens"; keep it O(1).
create index if not exists idx_invite_tokens_user_active
  on public.invite_tokens(user_id)
  where used_at is null and superseded_at is null;

-- Service-role only: RLS on with no policies denies anon/authenticated;
-- all access goes through supabaseAdmin in the invite API routes.
alter table public.invite_tokens enable row level security;

commit;
