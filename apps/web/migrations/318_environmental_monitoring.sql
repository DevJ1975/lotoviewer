-- Migration 318: environmental monitoring: discharge limits and sample results.
--
--   monitoring_limits    what a discharge may contain, and on what footing: a number, the
--                        parameter and unit it is in, how it is judged (a single sample, a
--                        day, a month, a year) and WHY it binds (basis)
--   monitoring_results   what one sample showed, for an outfall or for the site
--
-- A result is stored without a verdict. It is judged against every limit that applies when
-- it is read (packages/core/src/environmental/monitoring.ts), so correcting a limit
-- corrects every past judgement, and no row can carry a stale "within".
--
-- basis keeps apart two things that must never be added together. A permit limit (or a local
-- limit) binds the discharger. A benchmark or numeric action level (NAL) is a trigger for
-- investigation and response: exceeding one is not, by itself, a violation of the permit.
-- Self-imposed targets bind no one. The distinction lives in this column so that no screen,
-- export or report has to guess it back from a label.
--
-- A limit or a result may name an outfall only at its own site, and a limit may name a permit
-- only at its own site: both are composite foreign keys over (tenant_id, facility_id, id), so
-- the database refuses another site's outfall or permit. That needs a unique key on
-- stormwater_outfalls(tenant_id, facility_id, id), which migration 313 did not add (it added the
-- same key to the permit vault); it is added below, and 318_rollback.sql removes it.
--
-- A site-wide limit has no outfall (outfall_id null): the pair is then not checked (MATCH SIMPLE).
--
-- Deleting an outfall that has limits or results is refused (NO ACTION), not cascaded and not
-- set null. Cascading would destroy sample records; set null would turn an outfall's results
-- into site-level ones and an outfall's own limit into a limit on every outfall. The outfalls
-- screen already points to status 'removed' for an outfall that is out of service. NO ACTION
-- (checked when the statement ends) rather than RESTRICT, so that deleting a whole site or
-- tenant clears these tables through their own cascades first, and so that the refusal is the
-- plain foreign key violation (23503) every other bad reference raises, not RESTRICT's 23001.
--
-- Access
--   limits    members read; tenant admins write.
--   results   members read and add their own (sampled_by must be the caller); only tenant
--             admins change or delete one. A sample result is a record: the person who took
--             it cannot silently edit it, the same rule the evidence files follow (314).
--   Facility scoping as in 211: a header narrows reads and writes to one site, none is the
--   roll-up. Both tables carry the audit trigger.
--
-- evidence_id is a path in the environmental-evidence bucket. It must sit under the tenant's
-- own folder with no '..', the rule env_complete_obligation applies (315).
--
-- Depends on 304 (permit vault), 312 and 313 (outfalls). Idempotent. Rollback: 318_rollback.sql.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stormwater_outfalls'::regclass
      and conname = 'stormwater_outfalls_tenant_facility_id_key'
  ) then
    alter table public.stormwater_outfalls
      add constraint stormwater_outfalls_tenant_facility_id_key unique (tenant_id, facility_id, id);
  end if;
end $$;

-- ── limits ──────────────────────────────────────────────────────────────────
create table if not exists public.monitoring_limits (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  facility_id    uuid not null,
  -- Null: a site-wide limit, applying to every outfall.
  outfall_id     uuid,
  permit_id      uuid,

  parameter      text not null check (length(btrim(parameter)) between 1 and 80),
  unit           text not null check (length(btrim(unit)) between 1 and 20),
  limit_kind     text not null check (limit_kind in ('instantaneous_max','instantaneous_min','daily_max','monthly_average','annual_average')),
  value          numeric not null check (value >= 0),
  basis          text not null check (basis in ('permit_limit','benchmark','numeric_action_level','local_limit','self_imposed')),
  citation       text check (citation is null or length(citation) <= 300),
  -- What a reviewer must confirm before this number is relied on; shown wherever the limit is.
  verify         text check (verify is null or length(verify) <= 1000),
  source         text not null default 'tenant' check (source in ('library','tenant')),
  -- Names the library row a limit was adopted from, so adopting again adds nothing.
  library_key    text check (library_key is null or library_key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  effective_from date,
  effective_to   date,

  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),

  foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade,
  constraint monitoring_limits_outfall_fk
    foreign key (tenant_id, facility_id, outfall_id)
    references public.stormwater_outfalls (tenant_id, facility_id, id),
  -- A permit is retired, never deleted (304); set null is only for completeness, as in 313.
  constraint monitoring_limits_permit_fk
    foreign key (tenant_id, facility_id, permit_id)
    references public.environmental_permits (tenant_id, facility_id, id) on delete set null (permit_id),
  constraint monitoring_limits_dates_ordered check (effective_from is null or effective_to is null or effective_from <= effective_to),
  constraint monitoring_limits_library_key_iff_library check ((source = 'library') = (library_key is not null)),
  constraint monitoring_limits_library_cites check (source <> 'library' or citation is not null)
);

-- NULLS NOT DISTINCT makes "no outfall" one slot, so a site-wide library limit can be
-- adopted once per site while each outfall can still hold its own copy.
create unique index if not exists uq_monitoring_limits_library
  on public.monitoring_limits (tenant_id, facility_id, outfall_id, library_key) nulls not distinct
  where library_key is not null;
create index if not exists idx_monitoring_limits_site on public.monitoring_limits (tenant_id, facility_id, outfall_id);
create index if not exists idx_monitoring_limits_permit on public.monitoring_limits (permit_id) where permit_id is not null;

drop trigger if exists trg_monitoring_limits_touch on public.monitoring_limits;
create trigger trg_monitoring_limits_touch before update on public.monitoring_limits
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_audit_monitoring_limits on public.monitoring_limits;
create trigger trg_audit_monitoring_limits after insert or update or delete on public.monitoring_limits
  for each row execute function public.log_audit('id');

alter table public.monitoring_limits enable row level security;

drop policy if exists monitoring_limits_read on public.monitoring_limits;
create policy monitoring_limits_read on public.monitoring_limits
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists monitoring_limits_admin_write on public.monitoring_limits;
create policy monitoring_limits_admin_write on public.monitoring_limits
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

-- ── results ─────────────────────────────────────────────────────────────────
create table if not exists public.monitoring_results (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  facility_id     uuid not null,
  -- Null: a sample of the site as a whole, not of one outfall.
  outfall_id      uuid,

  parameter       text not null check (length(btrim(parameter)) between 1 and 80),
  unit            text not null check (length(btrim(unit)) between 1 and 20),
  value           numeric not null check (value >= 0),
  -- Not detected: value is then the laboratory's reporting limit, not a measurement.
  below_detection boolean not null default false,
  sampled_at      timestamptz not null,
  event_label     text check (event_label is null or length(event_label) <= 120),
  lab             text check (lab is null or length(lab) <= 120),
  evidence_id     text,
  note            text check (note is null or length(note) <= 2000),
  sampled_by      uuid references auth.users(id) on delete cascade,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade,
  constraint monitoring_results_outfall_fk
    foreign key (tenant_id, facility_id, outfall_id)
    references public.stormwater_outfalls (tenant_id, facility_id, id),
  constraint monitoring_results_evidence_in_tenant_folder check (
    evidence_id is null or (
      length(evidence_id) <= 300
      and position('..' in evidence_id) = 0
      and left(evidence_id, length(tenant_id::text) + 1) = tenant_id::text || '/'
    )
  )
);

create index if not exists idx_monitoring_results_site_time on public.monitoring_results (tenant_id, facility_id, sampled_at desc, id desc);
create index if not exists idx_monitoring_results_subject on public.monitoring_results (tenant_id, facility_id, outfall_id, parameter, sampled_at desc);

drop trigger if exists trg_monitoring_results_touch on public.monitoring_results;
create trigger trg_monitoring_results_touch before update on public.monitoring_results
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_audit_monitoring_results on public.monitoring_results;
create trigger trg_audit_monitoring_results after insert or update or delete on public.monitoring_results
  for each row execute function public.log_audit('id');

alter table public.monitoring_results enable row level security;

drop policy if exists monitoring_results_read on public.monitoring_results;
create policy monitoring_results_read on public.monitoring_results
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- Anyone on the team may record a sample, as themselves.
drop policy if exists monitoring_results_member_insert on public.monitoring_results;
create policy monitoring_results_member_insert on public.monitoring_results
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and sampled_by = auth.uid()
  );

-- A recorded result is changed or removed only by a tenant admin.
drop policy if exists monitoring_results_admin_update on public.monitoring_results;
create policy monitoring_results_admin_update on public.monitoring_results
  for update to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists monitoring_results_admin_delete on public.monitoring_results;
create policy monitoring_results_admin_delete on public.monitoring_results
  for delete to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
