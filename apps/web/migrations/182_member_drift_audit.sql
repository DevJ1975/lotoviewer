-- Migration 182: Daily drift audit for the unified members roster.
--
-- Three drift classes we look for:
--
--   1. missing_in_members — a profile has a tenant_membership row but
--      no members row. The 180 trigger should prevent this going
--      forward; the audit catches anything we missed.
--   2. missing_in_members (loto) — a loto_workers row with no
--      corresponding members row.
--   3. field_mismatch — a profile or worker whose name/email diverged
--      from its members row. Common cause: the trigger missed a
--      timing window during a backfill window.
--   4. orphan_profile_id — a member.profile_id pointing at a
--      profiles row that no longer exists (auth.users + profiles
--      cascade-deleted but the member row stayed). The members table
--      already nulls profile_id ON DELETE, so this is mostly defence
--      in depth.
--
-- Findings are upserted on (tenant_id, finding_type, surface,
-- surface_row_pk) where reconciled_at IS NULL — one open finding
-- per drifted thing at any time.
--
-- Scheduled daily at 03:00 UTC via pg_cron when available. Local
-- dev (no pg_cron extension) skips the schedule with a NOTICE; the
-- audit can still be invoked manually.

begin;

create table if not exists public.member_drift_findings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  finding_type    text not null
                    check (finding_type in ('missing_in_members','field_mismatch','orphan_profile_id')),
  surface         text not null
                    check (surface in ('profiles','loto_workers')),
  surface_row_pk  uuid not null,
  member_id       uuid references public.members(id) on delete set null,
  details         jsonb not null default '{}'::jsonb,
  detected_at     timestamptz not null default now(),
  reconciled_at   timestamptz
);

-- One open finding per (tenant, type, surface, row). Closed findings
-- (reconciled_at IS NOT NULL) are kept for audit trail.
create unique index if not exists idx_member_drift_findings_open_unique
  on public.member_drift_findings(tenant_id, finding_type, surface, surface_row_pk)
  where reconciled_at is null;

create index if not exists idx_member_drift_findings_open
  on public.member_drift_findings(tenant_id, detected_at desc)
  where reconciled_at is null;

alter table public.member_drift_findings enable row level security;

-- Superadmin-only: drift is a cross-tenant operational concern, and
-- the surface_row_pk + details columns can leak personal info from
-- other tenants in mis-routed rows.
drop policy if exists member_drift_findings_superadmin_read
  on public.member_drift_findings;
create policy member_drift_findings_superadmin_read
  on public.member_drift_findings
  for select to authenticated
  using (public.is_superadmin());

drop policy if exists member_drift_findings_superadmin_write
  on public.member_drift_findings;
create policy member_drift_findings_superadmin_write
  on public.member_drift_findings
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

drop trigger if exists trg_audit_member_drift_findings
  on public.member_drift_findings;
create trigger trg_audit_member_drift_findings
  after insert or update or delete on public.member_drift_findings
  for each row execute function public.log_audit('id');

-- ────────────────────────────────────────────────────────────────────
-- audit_member_drift() — scans both legacy surfaces and writes one
-- open finding per drifted row.
--
-- Idempotency: existing OPEN findings for the same (tenant, type,
-- surface, row) are left alone — re-running the audit doesn't churn
-- detected_at. Findings whose underlying row has been reconciled get
-- their reconciled_at stamped.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.audit_member_drift()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_now timestamptz := now();
begin
  -- Class 1: profiles missing a members row in a tenant where they
  -- are a member.
  insert into public.member_drift_findings (
    tenant_id, finding_type, surface, surface_row_pk, details
  )
  select
    tm.tenant_id,
    'missing_in_members',
    'profiles',
    p.id,
    jsonb_build_object(
      'email', p.email,
      'full_name', p.full_name,
      'tenant_role', tm.role
    )
  from public.tenant_memberships tm
  join public.profiles p on p.id = tm.user_id
  where not exists (
    select 1 from public.members m
     where m.tenant_id = tm.tenant_id
       and m.profile_id = p.id
  )
  on conflict (tenant_id, finding_type, surface, surface_row_pk)
    where reconciled_at is null do nothing;

  -- Class 1b: loto_workers missing a members row.
  insert into public.member_drift_findings (
    tenant_id, finding_type, surface, surface_row_pk, details
  )
  select
    w.tenant_id,
    'missing_in_members',
    'loto_workers',
    w.id,
    jsonb_build_object(
      'full_name', w.full_name,
      'employee_id', w.employee_id,
      'active', w.active
    )
  from public.loto_workers w
  where not exists (
    select 1 from public.members m
     where m.tenant_id = w.tenant_id
       and m.source = 'loto_worker'
       and m.source_id = w.id
  )
  on conflict (tenant_id, finding_type, surface, surface_row_pk)
    where reconciled_at is null do nothing;

  -- Class 2: field mismatch on profile-sourced members.
  insert into public.member_drift_findings (
    tenant_id, finding_type, surface, surface_row_pk, member_id, details
  )
  select
    m.tenant_id,
    'field_mismatch',
    'profiles',
    p.id,
    m.id,
    jsonb_build_object(
      'profile_email', p.email,
      'member_email',  m.email,
      'profile_name',  p.full_name,
      'member_name',   m.legal_name
    )
  from public.members m
  join public.profiles p on p.id = m.profile_id
  where m.source = 'profile'
    and (
      coalesce(m.legal_name, '') is distinct from coalesce(p.full_name, '')
      or coalesce(m.email, '') is distinct from coalesce(nullif(lower(trim(coalesce(p.email, ''))), ''), '')
    )
  on conflict (tenant_id, finding_type, surface, surface_row_pk)
    where reconciled_at is null do nothing;

  -- Class 2b: field mismatch on loto-worker-sourced members.
  insert into public.member_drift_findings (
    tenant_id, finding_type, surface, surface_row_pk, member_id, details
  )
  select
    m.tenant_id,
    'field_mismatch',
    'loto_workers',
    w.id,
    m.id,
    jsonb_build_object(
      'worker_full_name', w.full_name,
      'member_legal_name', m.legal_name,
      'worker_employee_id', w.employee_id,
      'member_employee_id', m.employee_id
    )
  from public.members m
  join public.loto_workers w on w.id = m.source_id and w.tenant_id = m.tenant_id
  where m.source = 'loto_worker'
    and (
      coalesce(m.legal_name, '') is distinct from coalesce(w.full_name, '')
      or coalesce(m.employee_id, '') is distinct from coalesce(nullif(trim(coalesce(w.employee_id, '')), ''), '')
    )
  on conflict (tenant_id, finding_type, surface, surface_row_pk)
    where reconciled_at is null do nothing;

  -- Class 3: orphan profile_id on a members row.
  insert into public.member_drift_findings (
    tenant_id, finding_type, surface, surface_row_pk, member_id, details
  )
  select
    m.tenant_id,
    'orphan_profile_id',
    'profiles',
    m.profile_id,
    m.id,
    jsonb_build_object('member_email', m.email)
  from public.members m
  where m.profile_id is not null
    and not exists (
      select 1 from public.profiles p where p.id = m.profile_id
    )
  on conflict (tenant_id, finding_type, surface, surface_row_pk)
    where reconciled_at is null do nothing;

  -- Close findings whose underlying drift no longer exists.
  -- "missing_in_members" closes when the row now has a member.
  update public.member_drift_findings f
     set reconciled_at = v_now
   where reconciled_at is null
     and finding_type = 'missing_in_members'
     and surface = 'profiles'
     and exists (
       select 1 from public.members m
        where m.tenant_id = f.tenant_id
          and m.profile_id = f.surface_row_pk
     );

  update public.member_drift_findings f
     set reconciled_at = v_now
   where reconciled_at is null
     and finding_type = 'missing_in_members'
     and surface = 'loto_workers'
     and exists (
       select 1 from public.members m
        where m.tenant_id = f.tenant_id
          and m.source = 'loto_worker'
          and m.source_id = f.surface_row_pk
     );

  -- "field_mismatch" closes when names + emails align again.
  update public.member_drift_findings f
     set reconciled_at = v_now
   where reconciled_at is null
     and finding_type = 'field_mismatch'
     and surface = 'profiles'
     and exists (
       select 1
         from public.members m
         join public.profiles p on p.id = m.profile_id
        where m.id = f.member_id
          and coalesce(m.legal_name, '') is not distinct from coalesce(p.full_name, '')
          and coalesce(m.email, '') is not distinct from coalesce(nullif(lower(trim(coalesce(p.email, ''))), ''), '')
     );

  update public.member_drift_findings f
     set reconciled_at = v_now
   where reconciled_at is null
     and finding_type = 'field_mismatch'
     and surface = 'loto_workers'
     and exists (
       select 1
         from public.members m
         join public.loto_workers w on w.id = m.source_id and w.tenant_id = m.tenant_id
        where m.id = f.member_id
          and coalesce(m.legal_name, '') is not distinct from coalesce(w.full_name, '')
          and coalesce(m.employee_id, '') is not distinct from coalesce(nullif(trim(coalesce(w.employee_id, '')), ''), '')
     );

  -- "orphan_profile_id" closes when the member's profile_id is null
  -- or the underlying profile reappeared.
  update public.member_drift_findings f
     set reconciled_at = v_now
   where reconciled_at is null
     and finding_type = 'orphan_profile_id'
     and (
       not exists (select 1 from public.members m where m.id = f.member_id and m.profile_id is not null)
       or exists (
         select 1
           from public.members m
           join public.profiles p on p.id = m.profile_id
          where m.id = f.member_id
       )
     );
end;
$$;

revoke all on function public.audit_member_drift() from public;
grant execute on function public.audit_member_drift() to authenticated;

-- Daily schedule via pg_cron. Wrapped in a DO block so a local dev
-- environment without pg_cron just emits a NOTICE and moves on.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'member-drift-audit-daily',
      '0 3 * * *',
      $job$ select public.audit_member_drift() $job$
    );
  else
    raise notice 'pg_cron not installed; skipping member-drift-audit schedule.';
  end if;
exception
  when undefined_function then
    raise notice 'cron.schedule not callable; skipping member-drift-audit schedule.';
end;
$$;

notify pgrst, 'reload schema';

commit;
