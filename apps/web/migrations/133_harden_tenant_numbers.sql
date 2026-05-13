-- Migration 133: harden tenant identity rows.
--
-- Ad hoc smoke tenants with NULL tenant_number can otherwise leak into the
-- superadmin tenant switcher. Give every legacy NULL row a real number so the
-- column can become NOT NULL, and archive known Equipment Readiness smoke
-- tenants so operational selectors ignore them.

begin;

do $$
declare
  v_row record;
  v_candidate text;
begin
  for v_row in
    select id
      from public.tenants
     where tenant_number is null
     order by created_at, id
  loop
    loop
      v_candidate := public.next_tenant_number();
      exit when not exists (
        select 1 from public.tenants where tenant_number = v_candidate
      );
    end loop;

    update public.tenants
       set tenant_number = v_candidate,
           updated_at = now()
     where id = v_row.id;
  end loop;
end $$;

update public.tenants
   set status = 'archived',
       disabled_at = coalesce(disabled_at, now()),
       updated_at = now()
 where slug like 'equipment-smoke-%'
    or name ilike 'Equipment Readiness Smoke%';

alter table public.tenants
  alter column tenant_number set not null;

commit;
