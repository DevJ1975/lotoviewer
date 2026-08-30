-- Migration 265: RECOVERY of out-of-band migration 20260806042915
-- ("fix_project_calendar_ordinal_assignment", applied to production
-- 2026-08-06 via MCP).
--
-- This SQL ran against production on 2026-08-06 but was never committed to
-- the repository. The body below is byte-identical to production's
-- supabase_migrations.schema_migrations record for version 20260806042915
-- (verified by md5 d2f2b2c1054b84f1893c2636280e267d during the 2026-08-28
-- migration reconciliation; see docs/audits/migration-reconciliation-2026-08-28.md).
--
-- Fixes the ordinal assignment in recompute_project_calendar_ordinals():
-- the 264 version renumbers in place and can collide with the partial unique
-- index uq_project_calendar_ordinal mid-statement; this version first shifts
-- every existing ordinal out of the target range, then renumbers. Also makes
-- generate_project_calendar() insert without ordinals and delegate numbering
-- to the recompute pass. Must sort after 264, which it replaces functions from.
--
-- Idempotent: `create or replace function` only. Safe to run both where the
-- fixed versions are already live (production) and on a fresh rebuild.

begin;

create or replace function public.recompute_project_calendar_ordinals(
  p_tenant_id  uuid,
  p_project_id uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_offset int;
begin
  select coalesce(max(work_day_ordinal), 0) into v_offset
    from public.project_calendar
   where tenant_id = p_tenant_id and project_id = p_project_id;

  update public.project_calendar
     set work_day_ordinal = work_day_ordinal + v_offset + 1
   where tenant_id = p_tenant_id
     and project_id = p_project_id
     and work_day_ordinal is not null;

  with numbered as (
    select calendar_date,
           (count(*) over (order by calendar_date
                           rows between unbounded preceding and current row))::int as ordinal
      from public.project_calendar
     where tenant_id = p_tenant_id
       and project_id = p_project_id
       and is_working_day
  )
  update public.project_calendar c
     set work_day_ordinal = n.ordinal
    from numbered n
   where c.tenant_id = p_tenant_id
     and c.project_id = p_project_id
     and c.calendar_date = n.calendar_date
     and c.work_day_ordinal is distinct from n.ordinal;
end;
$$;

create or replace function public.generate_project_calendar(
  p_tenant_id  uuid,
  p_project_id uuid,
  p_from       date,
  p_to         date,
  p_holidays   date[] default '{}'
)
returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_work_days smallint[];
  v_base      int;
  v_inserted  int;
begin
  select default_work_days into v_work_days
    from public.construction_projects
   where id = p_project_id and tenant_id = p_tenant_id;
  if v_work_days is null then
    raise exception 'project % not found in tenant %', p_project_id, p_tenant_id
      using errcode = '23503';
  end if;

  select coalesce(max(work_day_ordinal), 0) into v_base
    from public.project_calendar
   where tenant_id = p_tenant_id and project_id = p_project_id;

  insert into public.project_calendar
    (tenant_id, project_id, calendar_date, is_working_day, work_day_ordinal, non_working_reason)
  select p_tenant_id,
         p_project_id,
         n.d,
         n.working,
         case when n.working then v_base + n.running end,
         case
           when n.working then null
           when n.d = any(p_holidays) then 'holiday'
           else 'weekend'
         end
    from (
      select d::date as d,
             w.working,
             (count(*) filter (where w.working) over (
                order by d rows between unbounded preceding and current row))::int as running
        from generate_series(p_from, p_to, interval '1 day') d
        cross join lateral (
          select extract(isodow from d)::smallint = any(v_work_days)
                 and not (d::date = any(p_holidays)) as working
        ) w
    ) n
  on conflict (tenant_id, project_id, calendar_date) do nothing;

  get diagnostics v_inserted = row_count;
  perform public.recompute_project_calendar_ordinals(p_tenant_id, p_project_id);
  return v_inserted;
end;
$$;

commit;
