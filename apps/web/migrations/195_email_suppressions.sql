-- Migration 195: email suppression list for one-click unsubscribe.
--
-- Backs RFC 8058 one-click unsubscribe on recurring/bulk emails (the weekly
-- leadership digests + the scorecard weather report). A signed token in the
-- List-Unsubscribe URL lets a recipient — or their mail provider, via an
-- automated one-click POST — opt out without authenticating. The crons
-- consult this table before sending and drop suppressed addresses.
--
-- Suppression is keyed by email address, not user/tenant: a person who opts
-- out of "weekly emails" should stop receiving them everywhere. Transactional
-- mail (invites, incident alerts, password flows) ignores this table.
--
-- Service-role only: RLS is enabled with NO policies, so anon/authenticated
-- clients see nothing. Only the server (supabaseAdmin, used by the unsubscribe
-- endpoint and the crons) reads/writes, via the service role which bypasses
-- RLS.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists public.email_suppressions (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  -- 'all' suppresses every bulk stream; a specific value (e.g.
  -- 'weekly_digest') suppresses just that stream. The senders read with
  -- category IN ('all', <stream>).
  category    text not null default 'all',
  -- How the suppression was created: an explicit unsubscribe, or an
  -- automated bounce/complaint feedback loop (future use).
  source      text not null default 'user',
  created_at  timestamptz not null default now(),
  unique (email, category)
);

create index if not exists idx_email_suppressions_email
  on public.email_suppressions (lower(email));

alter table public.email_suppressions enable row level security;
-- No policies by design: deny all to anon/authenticated. The service role
-- bypasses RLS, and it is the only writer/reader of this table.

notify pgrst, 'reload schema';

commit;
