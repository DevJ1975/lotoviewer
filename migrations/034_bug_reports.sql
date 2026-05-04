-- Migration 034: bug_reports table
--
-- Persist user-submitted bug reports so the daily-health-report cron
-- can summarize them. Today the /api/support/bug-report route only
-- emails the report; with this table we get a queryable history.
--
-- Schema mirrors lib/bugReport.ts BugReportPayload + the auth-derived
-- reporter context the route already adds before sending. The
-- `emailed_ok` boolean records whether the Resend send succeeded so
-- the digest can flag emails that didn't go out.

create table if not exists public.bug_reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references public.profiles(id) on delete set null,
  reporter_email  text,
  reporter_name   text,
  title           text not null check (length(trim(title)) between 1 and 200),
  description     text not null check (length(trim(description)) between 1 and 4000),
  severity        text not null
                    check (severity in ('low', 'medium', 'high', 'critical')),
  -- Browser context, captured client-side. Optional — older clients
  -- may not send these.
  user_agent      text,
  url             text,
  -- Tenant the reporter was active in when they submitted. Helps
  -- triage "is this LOTO-tenant-specific or platform-wide?" Nullable
  -- since the support page is a global route.
  tenant_id       uuid references public.tenants(id),
  -- Best-effort flag from the route's Resend send. true=email left;
  -- false=Resend rejected or env not configured; null=unknown (older
  -- rows from before this column existed).
  emailed_ok      boolean,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_bug_reports_created_at
  on public.bug_reports (created_at desc);
create index if not exists idx_bug_reports_severity_open
  on public.bug_reports (severity, created_at desc)
  where resolved_at is null;

alter table public.bug_reports enable row level security;

-- Reads: superadmins only. Inserts: anyone with a valid session
-- (the API route additionally requires a logged-in user via auth.getUser
-- so anon clients can't fire it).
drop policy if exists "bug_reports_superadmin_read"     on public.bug_reports;
drop policy if exists "bug_reports_authenticated_insert" on public.bug_reports;

create policy "bug_reports_superadmin_read" on public.bug_reports
  for select to authenticated
  using (public.is_superadmin());

create policy "bug_reports_authenticated_insert" on public.bug_reports
  for insert to authenticated
  with check (auth.uid() is not null);

notify pgrst, 'reload schema';
