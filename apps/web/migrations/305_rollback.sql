-- Rollback for migration 305. Re-opens every gap 305 closed; use only to
-- recover from an outage the guards caused, and re-apply a corrected 305
-- immediately afterwards.
--
-- Idempotent.

begin;

drop trigger if exists trg_tenants_guard_privileged_columns on public.tenants;
drop function if exists public.tenants_guard_privileged_columns();

drop trigger if exists trg_tenant_memberships_guard_owner_role on public.tenant_memberships;
drop function if exists public.tenant_memberships_guard_owner_role();

drop policy if exists "cmms_integrations_admin" on public.cmms_integrations;
drop policy if exists "cmms_integrations_tenant_scope" on public.cmms_integrations;
create policy "cmms_integrations_tenant_scope" on public.cmms_integrations
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

alter table public.hazard_hunt_finding_sequences disable row level security;
grant all on public.hazard_hunt_finding_sequences to anon, authenticated;

grant execute on function public.update_manual(
  text, text, text, boolean, text, timestamptz, boolean, uuid, text
) to anon, authenticated;

commit;
