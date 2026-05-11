-- Migration 117: Restrict learner visibility for STRIKE assignment targets.
-- Tenant admins need the full assignment roster, but members should not be
-- able to read user-targeted assignments for other employees.

drop policy if exists strike_assignments_read on public.strike_assignments;
create policy strike_assignments_read on public.strike_assignments
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
      or (
        tenant_id in (select public.current_user_tenant_ids())
        and (
          target_type = 'tenant'
          or (target_type = 'user' and target_id = auth.uid()::text)
          or (
            target_type = 'role'
            and exists (
              select 1
                from public.tenant_memberships m
               where m.tenant_id = strike_assignments.tenant_id
                 and m.user_id = auth.uid()
                 and m.role = strike_assignments.target_id
            )
          )
        )
      )
    )
  );
