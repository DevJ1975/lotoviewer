-- Migration 040: Row-Level Security on every Risk Assessment table.
--
-- Mirrors the migration-032 pattern used for every other domain table:
-- combine the active-tenant-header check with the membership +
-- superadmin check. Service-role bypasses RLS as usual (the audit
-- trigger in 038 runs as SECURITY DEFINER + the public review APIs
-- already use service-role for tenant-scoped writes).
--
--   tenant_id matches the active-tenant header (or no header sent),
--   AND
--   (caller is a member of that tenant OR caller is a superadmin)
--
-- risk_audit_log is the only table with restricted DML — already
-- handled in migration 038 via REVOKE UPDATE/DELETE + the immutable
-- trigger. The RLS policy below is just the read scope.
--
-- Idempotent — drops + recreates each policy.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- Enable RLS
-- ──────────────────────────────────────────────────────────────────────────

alter table public.risks              enable row level security;
alter table public.controls_library   enable row level security;
alter table public.risk_controls      enable row level security;
alter table public.risk_reviews       enable row level security;
alter table public.risk_attachments   enable row level security;
alter table public.risk_audit_log     enable row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- risks
-- ──────────────────────────────────────────────────────────────────────────

drop policy if exists risks_tenant_scope on public.risks;
create policy risks_tenant_scope on public.risks
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- controls_library
-- ──────────────────────────────────────────────────────────────────────────

drop policy if exists controls_library_tenant_scope on public.controls_library;
create policy controls_library_tenant_scope on public.controls_library
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- risk_controls
-- ──────────────────────────────────────────────────────────────────────────

drop policy if exists risk_controls_tenant_scope on public.risk_controls;
create policy risk_controls_tenant_scope on public.risk_controls
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- risk_reviews
-- ──────────────────────────────────────────────────────────────────────────

drop policy if exists risk_reviews_tenant_scope on public.risk_reviews;
create policy risk_reviews_tenant_scope on public.risk_reviews
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- risk_attachments
-- ──────────────────────────────────────────────────────────────────────────

drop policy if exists risk_attachments_tenant_scope on public.risk_attachments;
create policy risk_attachments_tenant_scope on public.risk_attachments
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- risk_audit_log — read-only RLS scope
-- ──────────────────────────────────────────────────────────────────────────
--
-- DML is already locked down by migration 038 (revoke + trigger).
-- This policy just scopes SELECT visibility. Append-only INSERTs
-- ride through the trigger which is SECURITY DEFINER, so they
-- bypass RLS by design — that's intentional, you don't want a
-- subtly-malformed RLS policy preventing audit capture.

drop policy if exists risk_audit_log_tenant_scope on public.risk_audit_log;
create policy risk_audit_log_tenant_scope on public.risk_audit_log
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- The INSERT path needs an explicit policy because RLS-enabled tables
-- default-deny all DML. The trigger inserts as SECURITY DEFINER so
-- this only matters for direct inserts (rare; tests + admin scripts).
drop policy if exists risk_audit_log_tenant_insert on public.risk_audit_log;
create policy risk_audit_log_tenant_insert on public.risk_audit_log
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

notify pgrst, 'reload schema';

commit;
