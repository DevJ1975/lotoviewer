-- Migration 137: Harden toolbox-talk retained-record access.
--
-- Toolbox talks and signatures are compliance evidence. Client sessions
-- may read the rows for their enabled tenant, but creation and mutation
-- stay behind service-role APIs/cron so records remain append-only from
-- the browser.

begin;

alter table public.toolbox_talks enable row level security;
alter table public.toolbox_talk_signatures enable row level security;

drop policy if exists toolbox_talks_tenant_scope on public.toolbox_talks;
drop policy if exists toolbox_talks_tenant_select on public.toolbox_talks;
create policy toolbox_talks_tenant_select on public.toolbox_talks
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
    and exists (
      select 1
        from public.tenants t
       where t.id = tenant_id
         and t.disabled_at is null
         and coalesce((t.modules ->> 'toolbox-talks')::boolean, true)
    )
  );

drop policy if exists toolbox_signatures_tenant_scope on public.toolbox_talk_signatures;
drop policy if exists toolbox_signatures_tenant_select on public.toolbox_talk_signatures;
create policy toolbox_signatures_tenant_select on public.toolbox_talk_signatures
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
    and exists (
      select 1
        from public.tenants t
       where t.id = tenant_id
         and t.disabled_at is null
         and coalesce((t.modules ->> 'toolbox-talks')::boolean, true)
    )
  );

revoke all on public.toolbox_talks from public, anon, authenticated;
revoke all on public.toolbox_talk_signatures from public, anon, authenticated;

grant select on public.toolbox_talks to authenticated;
grant select (
  id,
  tenant_id,
  talk_id,
  signer_user_id,
  signer_name,
  employee_id,
  signed_at,
  signed_ip,
  inserted_by
) on public.toolbox_talk_signatures to authenticated;

comment on policy toolbox_talks_tenant_select on public.toolbox_talks is
  'Tenant members may read toolbox talks only while the toolbox-talks module is enabled; service-role cron owns writes.';

comment on policy toolbox_signatures_tenant_select on public.toolbox_talk_signatures is
  'Tenant members may read roster metadata only while toolbox-talks is enabled; signature images remain service-role/PDF only.';

commit;
