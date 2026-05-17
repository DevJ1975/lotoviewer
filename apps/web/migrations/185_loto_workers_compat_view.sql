-- Migration 185: Future-facing read alias for loto_workers.
--
-- Existing readers still hit public.loto_workers directly — switching
-- them is Phase 1.5. This view exposes the same column shape on top
-- of `members`, scoped to the roster slice (source = 'loto_worker' OR
-- profile_id IS NULL, i.e. workers without a login). Callers that
-- migrate first can switch their SELECT to loto_workers_v without
-- touching the writer side.
--
-- security_invoker so the underlying members RLS still applies — a
-- caller only sees rows in tenants they have membership in.

begin;

create or replace view public.loto_workers_v
  with (security_invoker = true)
as
select
  m.id                                                            as id,
  m.tenant_id                                                     as tenant_id,
  coalesce(m.legal_name, m.display_name)                          as full_name,
  m.employee_id                                                   as employee_id,
  m.email                                                         as email,
  m.notes                                                         as notes,
  (m.status = 'active')                                           as active,
  m.created_at                                                    as created_at,
  m.updated_at                                                    as updated_at,
  m.created_by                                                    as created_by
from public.members m
where m.source = 'loto_worker'
   or m.profile_id is null;

comment on view public.loto_workers_v is
  'Future-facing read alias for loto_workers, sourced from the unified members roster. Phase 1.5 will switch readers to this view.';

grant select on public.loto_workers_v to authenticated;

notify pgrst, 'reload schema';

commit;
