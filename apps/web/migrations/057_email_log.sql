-- Migration 057: email_log — durable record of every Resend send.
--
-- The four senders (sendInvite, sendReviewLink,
-- sendRiskReviewReminder, sendTrainingExpiryReminder) call Resend
-- and either succeed or get a Sentry exception. There's no in-DB
-- record of "did we email Maria yesterday?" — only Resend's
-- dashboard knows, which is across-the-API and not joinable to
-- our tenant data.
--
-- This table records one row per send attempt. Writes happen
-- best-effort from logEmailSend() in lib/email/instrument.ts;
-- failures to log are Sentry-reported but don't block the actual
-- email. Reads are superadmin-only (RLS).

begin;

create table if not exists public.email_log (
  id              bigserial primary key,
  -- Logical kind identifies the sender. Free-form text — adding a
  -- new email surface doesn't need a migration. Examples:
  --   invite, training-expiry, risk-review, review-link, support-ticket
  kind            text not null,
  to_email        text not null,
  subject         text,
  -- Tenant scope when known (the email is about a tenant's data).
  -- NULL for cross-tenant emails like superadmin alerts.
  tenant_id       uuid references public.tenants(id) on delete set null,
  -- Resend message id when send succeeded. NULL when status='failed'.
  provider_id     text,
  status          text not null check (status in ('sent', 'failed', 'skipped')),
  -- Brief failure reason or skip reason.
  error_text      text,
  -- Triggering user when a user-action triggered the send (e.g.
  -- admin invite, ticket escalation). NULL for cron-driven sends.
  triggered_by    uuid references public.profiles(id) on delete set null,
  occurred_at     timestamptz not null default now()
);

create index if not exists idx_email_log_recent
  on public.email_log(occurred_at desc);

create index if not exists idx_email_log_kind_recent
  on public.email_log(kind, occurred_at desc);

create index if not exists idx_email_log_tenant_recent
  on public.email_log(tenant_id, occurred_at desc)
  where tenant_id is not null;

comment on table public.email_log is
  'Per-send record of Resend emails. Written best-effort by lib/email/instrument.ts; read by /superadmin/email-log dashboard.';

-- ──────────────────────────────────────────────────────────────────────────
-- RLS — superadmins read; writes via service role (bypasses RLS).
-- ──────────────────────────────────────────────────────────────────────────
alter table public.email_log enable row level security;

drop policy if exists "email_log_superadmin_read" on public.email_log;
create policy "email_log_superadmin_read" on public.email_log
  for select to authenticated
  using (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
