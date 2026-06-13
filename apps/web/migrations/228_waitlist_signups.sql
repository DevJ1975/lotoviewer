-- Migration 228: waitlist_signups — pre-launch email capture for the
-- Trainovate marketing site.
--
-- This table is written only by the marketing site's /api/waitlist route,
-- which inserts through the service-role key (server-side). It is locked
-- down by default: RLS is enabled with NO policies, so anon and
-- authenticated principals can do nothing — only the service role, which
-- bypasses RLS, can write. The unique index on lower(email) dedupes
-- case-insensitively; the route maps that 23505 violation to a friendly
-- "already on the list" response. The raw IP is never stored — only a
-- salted SHA-256 hash, for light abuse tracking.

begin;

create table if not exists public.waitlist_signups (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (char_length(email) <= 254),
  name       text,
  company    text,
  source     text,
  utm        jsonb,
  ip_hash    text,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_signups_email_lower_key
  on public.waitlist_signups (lower(email));

alter table public.waitlist_signups enable row level security;

-- Intentionally no RLS policies: only service_role (which bypasses RLS) writes.
revoke all on public.waitlist_signups from anon, authenticated;

commit;
