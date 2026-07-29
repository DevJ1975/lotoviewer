-- Migration 235: email_log dedupe key — at-most-once idempotency for crons.
--
-- Reminder/digest crons (scorecard-weekly, incident-trends-weekly, …) re-send
-- to every recipient on each invocation. Nothing stops a manual re-run or a
-- Vercel double-fire from re-mailing everyone. This adds an optional claim
-- key: lib/email/core.ts inserts a status='sending' row keyed on dedupe_key
-- BEFORE the Resend round-trip; the partial unique index makes a second insert
-- with the same key fail (23505), which the core reads as "already handled →
-- skip". Transactional mail (invites, incident alerts) passes no key and is
-- completely unaffected.

begin;

alter table public.email_log
  add column if not exists dedupe_key text;

-- At-most-once gate: only one row may ever hold a given non-null key.
create unique index if not exists uq_email_log_dedupe_key
  on public.email_log(dedupe_key)
  where dedupe_key is not null;

-- The claim row is written with status='sending', then updated to sent/failed
-- once Resend responds. Widen the CHECK to admit that transient state. Drop the
-- existing status check by its actual name (resolved dynamically so this is
-- robust to Postgres's auto-generated constraint name).
do $$
declare conname text;
begin
  select c.conname into conname
    from pg_constraint c
   where c.conrelid = 'public.email_log'::regclass
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%status%';
  if conname is not null then
    execute format('alter table public.email_log drop constraint %I', conname);
  end if;
end $$;

alter table public.email_log
  add constraint email_log_status_check
  check (status in ('sent', 'failed', 'skipped', 'sending'));

comment on column public.email_log.dedupe_key is
  'Optional idempotency key (e.g. scorecard:<tenant>:<week>:<email>). Unique when set; lib/email/core.ts claims it with a status=sending row so the send fires at most once across cron re-runs / double-fires.';

commit;
