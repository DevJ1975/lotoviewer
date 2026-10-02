-- Migration 302: Phase 1.1, the gaps an ISO 14001 audit of Phase 1 found.
--
--   environmental_aspects.control_level      6.1.2: aspects it can control, and
--                                             those it can only influence
--   ms_scope_statements.control_and_influence 4.3 e): its authority and ability
--   ms_scope_statements.exclusions            to control and influence, and what
--                                             the scope leaves out and why
--   ms_policy_communications                  5.2: the policy communicated within
--                                             the organization, and made available
--                                             to interested parties
--   ms_responsibilities                       4.4 and 5.3: an owner for each EMS
--                                             process, and the two roles 5.3 a)
--                                             and b) assign
--
-- Every new column is nullable: rows written before this migration simply have
-- not recorded the new fact yet, and the report card says so. The API requires
-- control_and_influence on every new scope version.
--
-- Communications are append-only, like the policy they record; responsibilities
-- are reassigned in place, and log_audit() keeps who held each one. An owner
-- must be a member of the tenant: the foreign key to tenant_memberships clears
-- the assignment when the member is removed, so a departed owner never counts
-- as holding a process.
--
-- environmental_aspect_register gains control_level as its last column. After
-- this migration, re-running 297 fails, because 297's view definition lacks the
-- column and Postgres will not drop a view column; 297 runs in one transaction,
-- so that failure changes nothing.
--
-- Access: members read; tenant admins write (docs/ems/phase-1-plan.md D8).
--
-- Order: apply 302 before deploying the code that reads it, and revert that code
-- before running 302_rollback.sql. The routes select these columns and tables.
--
-- Idempotent. Rollback: 302_rollback.sql.

begin;

-- ── Aspects: control or influence (6.1.2) ────────────────────────────────
alter table public.environmental_aspects
  add column if not exists control_level text;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.environmental_aspects'::regclass and conname = 'environmental_aspects_control_level_check') then
    alter table public.environmental_aspects add constraint environmental_aspects_control_level_check
      check (control_level in ('control','influence'));
  end if;
end $$;

-- 297's definition with control_level appended: create or replace may only add
-- columns at the end.
create or replace view public.environmental_aspect_register
with (security_invoker = true) as
select a.id, a.tenant_id, a.facility_id, a.activity, a.aspect, a.impact, a.process_area,
       a.life_cycle_stage, a.flow, a.controls, a.related_risk_id, a.source_reference, a.status,
       a.owner_user_id, a.notes, a.obsolete_at, a.obsolete_reason, a.last_reviewed_at, a.reviewed_by,
       a.next_review_due, a.created_by, a.updated_by, a.created_at, a.updated_at,
       coalesce(s.significant, false)       as significant,
       s.max_score,
       coalesce(s.current_scores, '[]'::jsonb) as current_scores,
       a.control_level
  from public.environmental_aspects a
  left join lateral (
    select bool_or(c.significant) as significant,
           max(c.score)           as max_score,
           jsonb_agg(jsonb_build_object(
               'operating_condition', c.operating_condition,
               'severity',            c.severity,
               'likelihood',          c.likelihood,
               'score',               c.score,
               'significant',         c.significant,
               'method_id',           c.method_id,
               'scored_at',           c.scored_at)
             order by array_position(array['normal','abnormal','emergency'], c.operating_condition)
           ) as current_scores
      from public.environmental_aspect_current_scores c
     where c.tenant_id = a.tenant_id and c.aspect_id = a.id   -- idx_environmental_aspect_scores_latest
  ) s on true;

-- ── Scope: control and influence, exclusions (4.3) ───────────────────────
alter table public.ms_scope_statements
  add column if not exists control_and_influence text,
  add column if not exists exclusions            text;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ms_scope_statements'::regclass and conname = 'ms_scope_statements_control_and_influence_check') then
    alter table public.ms_scope_statements add constraint ms_scope_statements_control_and_influence_check
      check (control_and_influence is null or length(btrim(control_and_influence)) > 0);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ms_scope_statements'::regclass and conname = 'ms_scope_statements_exclusions_check') then
    alter table public.ms_scope_statements add constraint ms_scope_statements_exclusions_check
      check (exclusions is null or length(btrim(exclusions)) > 0);
  end if;
  -- Target for the communications' foreign key below: a communication must
  -- name a policy of its own tenant and its own discipline.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ms_policies'::regclass and conname = 'ms_policies_tenant_id_id_discipline_key') then
    alter table public.ms_policies add constraint ms_policies_tenant_id_id_discipline_key
      unique (tenant_id, id, discipline);
  end if;
end $$;

-- ── ms_policy_communications (append-only) ───────────────────────────────
create table if not exists public.ms_policy_communications (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  discipline       text not null check (discipline in ('ems','ohs','integrated')),
  policy_id        uuid not null,
  -- internal: within the organization (5.2 "communicated"); external: made
  -- available to interested parties outside it.
  audience         text not null check (audience in ('internal','external')),
  method           text not null check (length(btrim(method)) > 0),
  communicated_on  date not null,
  recorded_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint ms_policy_communications_policy_fk foreign key (tenant_id, policy_id, discipline)
    references public.ms_policies (tenant_id, id, discipline)
);

create index if not exists idx_ms_policy_communications_policy
  on public.ms_policy_communications (tenant_id, policy_id, communicated_on desc);

-- ── ms_responsibilities (4.4, 5.3) ───────────────────────────────────────
-- One row per responsibility a tenant has assigned. The keys are the EMS
-- processes and roles in @soteria/core/emsProcesses (RESPONSIBILITY_KEYS);
-- adding one is a reviewed migration that widens this check.
create table if not exists public.ms_responsibilities (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  discipline          text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  responsibility_key  text not null check (responsibility_key in (
    'system_conformity', 'performance_reporting',
    'context', 'policy', 'risks_opportunities', 'aspects', 'obligations', 'objectives',
    'competence_awareness', 'communication', 'documented_information',
    'operational_control', 'emergency_preparedness',
    'compliance_evaluation', 'internal_audit', 'management_review', 'nonconformity'
  )),
  owner_user_id       uuid,
  assigned_by         uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, discipline, responsibility_key),
  -- The owner is a member of this tenant; removing the membership clears only the owner.
  constraint ms_responsibilities_owner_member_fk foreign key (owner_user_id, tenant_id)
    references public.tenant_memberships (user_id, tenant_id) on delete set null (owner_user_id)
);

-- ── RLS: member read, admin write ────────────────────────────────────────
alter table public.ms_policy_communications enable row level security;
alter table public.ms_responsibilities      enable row level security;

drop policy if exists ms_policy_communications_member_read on public.ms_policy_communications;
create policy ms_policy_communications_member_read on public.ms_policy_communications
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists ms_policy_communications_admin_insert on public.ms_policy_communications;
create policy ms_policy_communications_admin_insert on public.ms_policy_communications
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );
revoke update, delete on public.ms_policy_communications from authenticated, anon;

drop policy if exists ms_responsibilities_member_read on public.ms_responsibilities;
create policy ms_responsibilities_member_read on public.ms_responsibilities
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists ms_responsibilities_admin_write on public.ms_responsibilities;
create policy ms_responsibilities_admin_write on public.ms_responsibilities
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

-- ── Triggers: touch updated_at, audit every write ────────────────────────
drop trigger if exists trg_ms_responsibilities_touch on public.ms_responsibilities;
create trigger trg_ms_responsibilities_touch
  before update on public.ms_responsibilities
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_ms_policy_communications on public.ms_policy_communications;
create trigger trg_audit_ms_policy_communications
  after insert or update or delete on public.ms_policy_communications
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_ms_responsibilities on public.ms_responsibilities;
create trigger trg_audit_ms_responsibilities
  after insert or update or delete on public.ms_responsibilities
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
