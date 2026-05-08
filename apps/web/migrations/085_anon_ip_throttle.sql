-- Migration 085: Per-IP cooldown for anonymous report submissions.
--
-- Plan phase 4a. The existing rate limit on incident_anon_intake_tokens
-- caps reports per token per hour, but a determined attacker can
-- submit against many tokens from the same device. This adds a
-- tenant-wide IP rolling window.
--
-- We never store raw IPs. ip_hash = sha256(ip || daily_salt) where
-- daily_salt is rotated server-side at midnight UTC. The salt
-- prevents trivial reverse-lookup if the table leaks.
--
-- Default policy: max 5 attempts per IP per 10 minutes across the
-- whole anonymous-report endpoint (creation + receipt status
-- lookups + upload-token requests). Configurable in code, not in
-- the DB, since this is an abuse-control knob.
--
-- Old rows are pruned by a daily cron job (deletes attempted_at
-- older than 30 days).

begin;

create table if not exists public.anon_report_ip_attempts (
  id            bigserial primary key,
  ip_hash       text not null,
  attempted_at  timestamptz not null default now(),

  -- Optional reference to the token the attempt was against, when
  -- the request supplied one. NULL means the attempt didn't even
  -- get to a token lookup (malformed body, bad token format).
  token_id      uuid references public.incident_anon_intake_tokens(id) on delete set null,

  -- Why the attempt was logged. Lets ops differentiate genuine
  -- traffic from rejected probes during incident review.
  outcome       text not null check (outcome in (
    'submit_ok', 'submit_rate_limit', 'submit_invalid', 'submit_error',
    'verify_ok', 'verify_invalid',
    'receipt_ok', 'receipt_invalid'
  ))
);

create index if not exists idx_anon_ip_attempts_window
  on public.anon_report_ip_attempts(ip_hash, attempted_at desc);

create index if not exists idx_anon_ip_attempts_age
  on public.anon_report_ip_attempts(attempted_at);

-- RLS: Only the service role writes here, and reads are admin-only
-- via Supabase Studio for forensics. No authenticated/anon policy.
alter table public.anon_report_ip_attempts enable row level security;

-- Helper to prune old rows. Call from a cron job (Supabase
-- pg_cron) once per day.
create or replace function public.prune_anon_report_ip_attempts()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.anon_report_ip_attempts
  where attempted_at < now() - interval '30 days';
$$;

revoke all on function public.prune_anon_report_ip_attempts() from public;

notify pgrst, 'reload schema';

commit;
