-- Migration 297: per-condition aspect scoring and a dated aspects register
-- (ISO 14001 clause 6.1.2). The EXPAND half of an expand/contract change.
--
-- Today an aspect has one operating_condition and one significance score
-- held in generated columns. Clause 6.1.2 asks for normal, abnormal and
-- emergency conditions to be assessed, and an auditor asks how a score
-- was reached. This migration adds:
--
--   * aspect register columns: process_area, the obsolete pair (a retired
--     aspect stays in history), review dates, facility_id
--   * environmental_aspect_scores: one append-only row per scoring of one
--     condition, with severity, likelihood, method and rationale. The
--     score itself is computed, never stored, so it cannot be forged or
--     drift from its method:
--       environmental_aspect_score_history   every score row plus its computed score
--       environmental_aspect_current_scores  the latest score per aspect and condition
--   * environmental_aspect_obligations: which compliance obligations an aspect is subject to
--
-- Each existing aspect's single score becomes its first history row. The
-- legacy columns stay until migration 301, because the pages deployed
-- before this change still read and write them. They lose their defaults
-- and become optional: the Phase 1 API creates aspects without them, and a
-- 1 x 1 default would read as an assessment nobody made. Null there means
-- "never scored under the old model", and 301 carries over only the rest.
--
-- Ordering: apply before deploying the Phase 1 code; apply 301 after it.
-- Idempotent. Rollback: 297_rollback.sql.

begin;

-- ── Aspect register columns ──────────────────────────────────────────────
alter table public.environmental_aspects
  add column if not exists process_area     text,
  add column if not exists obsolete_at      timestamptz,
  add column if not exists obsolete_reason  text,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists reviewed_by      uuid references auth.users(id) on delete set null,
  add column if not exists next_review_due  date,
  add column if not exists facility_id      uuid references public.facilities(id);

alter table public.environmental_aspects drop constraint if exists environmental_aspects_obsolete_pair;
alter table public.environmental_aspects
  add constraint environmental_aspects_obsolete_pair check ((obsolete_at is null) = (obsolete_reason is null));

-- Target for same-tenant foreign keys from scores and links.
-- Added only if missing: once other tables' foreign keys depend on it, it cannot be dropped and re-added.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'environmental_aspects_tenant_id_id_key') then
    alter table public.environmental_aspects add constraint environmental_aspects_tenant_id_id_key unique (tenant_id, id);
  end if;
end $$;

-- Never reviewed yet: the first review falls due a year after the aspect
-- was recorded. last_reviewed_at stays null; inventing a review would hide
-- exactly what the register exists to show.
update public.environmental_aspects
   set next_review_due = (created_at::date + 365)
 where next_review_due is null;
alter table public.environmental_aspects
  alter column next_review_due set not null,
  alter column next_review_due set default (current_date + 365);

-- An aspect is a fact about a site: facility-scoped, defaulting to the
-- caller's active facility; existing rows go to the tenant's primary facility.
alter table public.environmental_aspects alter column facility_id set default public.active_facility_id();
update public.environmental_aspects a
   set facility_id = f.id
  from public.facilities f
 where f.tenant_id = a.tenant_id and f.is_primary and a.facility_id is null;

create index if not exists idx_environmental_aspects_facility on public.environmental_aspects (facility_id);
create index if not exists idx_environmental_aspects_active
  on public.environmental_aspects (tenant_id, process_area) where obsolete_at is null;

-- The old pages still write aspects directly until the Phase 1 deploy, so
-- members keep write access here; 301 narrows it to admins. Only the
-- facility predicate (migration 211's form, which skipped this table) is added now.
drop policy if exists environmental_aspects_tenant_scope on public.environmental_aspects;
create policy environmental_aspects_tenant_scope on public.environmental_aspects
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );

-- ── environmental_aspect_scores (append-only history) ────────────────────
create table if not exists public.environmental_aspect_scores (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  aspect_id           uuid not null,
  operating_condition text not null check (operating_condition in ('normal','abnormal','emergency')),
  severity            int  not null check (severity >= 1),
  likelihood          int  not null check (likelihood >= 1),
  method_id           uuid not null,
  rationale           text not null check (length(btrim(rationale)) > 0),
  -- What prompted a re-score, e.g. 'moc:<id>' or 'incident:<id>' (Phase 3); null for routine scoring.
  triggered_by        text,
  scored_by           uuid references auth.users(id) on delete set null,
  scored_at           timestamptz not null default now(),
  constraint environmental_aspect_scores_aspect_fk foreign key (tenant_id, aspect_id)
    references public.environmental_aspects (tenant_id, id) on delete cascade,
  -- no action: a method in use cannot be deleted on its own, yet a tenant's cascade still works.
  constraint environmental_aspect_scores_method_fk foreign key (tenant_id, method_id)
    references public.ms_scoring_methods (tenant_id, id)
);

create index if not exists idx_environmental_aspect_scores_latest
  on public.environmental_aspect_scores (tenant_id, aspect_id, operating_condition, scored_at desc);

-- A score must sit on its method's scale. A check constraint cannot read
-- another table, so a trigger does.
create or replace function public.environmental_aspect_scores_in_scale()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_severity_levels   int;
  v_likelihood_levels int;
begin
  select severity_levels, likelihood_levels
    into v_severity_levels, v_likelihood_levels
    from public.ms_scoring_methods
   where id = new.method_id and tenant_id = new.tenant_id;
  if new.severity > v_severity_levels or new.likelihood > v_likelihood_levels then
    raise exception 'score (severity %, likelihood %) is outside method % scale (% x %)',
      new.severity, new.likelihood, new.method_id, v_severity_levels, v_likelihood_levels
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_environmental_aspect_scores_in_scale on public.environmental_aspect_scores;
create trigger trg_environmental_aspect_scores_in_scale
  before insert on public.environmental_aspect_scores
  for each row execute function public.environmental_aspect_scores_in_scale();

drop trigger if exists trg_audit_environmental_aspect_scores on public.environmental_aspect_scores;
create trigger trg_audit_environmental_aspect_scores
  after insert or update or delete on public.environmental_aspect_scores
  for each row execute function public.log_audit('id');

-- ── Views: the score is computed from the method, never stored ───────────
create or replace view public.environmental_aspect_score_history
with (security_invoker = true) as
select s.id,
       s.tenant_id,
       s.aspect_id,
       s.operating_condition,
       s.severity,
       s.likelihood,
       s.method_id,
       s.rationale,
       s.triggered_by,
       s.scored_by,
       s.scored_at,
       public.ms_method_score(m.matrix, s.severity, s.likelihood)                              as score,
       public.ms_method_score(m.matrix, s.severity, s.likelihood) >= m.significance_threshold as significant,
       m.name                   as method_name,
       m.version                as method_version,
       m.significance_threshold as significance_threshold
  from public.environmental_aspect_scores s
  join public.ms_scoring_methods m on m.id = s.method_id;

create or replace view public.environmental_aspect_current_scores
with (security_invoker = true) as
select distinct on (h.aspect_id, h.operating_condition) h.*
  from public.environmental_aspect_score_history h
 order by h.aspect_id, h.operating_condition, h.scored_at desc, h.id desc;   -- id breaks timestamp ties

-- One row per aspect with its current scores folded in, so the register can
-- filter on significance and page on the server in one query. A lateral
-- join, not a GROUP BY, so filters on the aspect (tenant, facility, process
-- area) reach the aspects index before any scores are read. Columns are
-- listed rather than a.*: a view pins every column it names, and 301 must
-- be able to drop the legacy ones.
create or replace view public.environmental_aspect_register
with (security_invoker = true) as
select a.id, a.tenant_id, a.facility_id, a.activity, a.aspect, a.impact, a.process_area,
       a.life_cycle_stage, a.flow, a.controls, a.related_risk_id, a.source_reference, a.status,
       a.owner_user_id, a.notes, a.obsolete_at, a.obsolete_reason, a.last_reviewed_at, a.reviewed_by,
       a.next_review_due, a.created_by, a.updated_by, a.created_at, a.updated_at,
       coalesce(s.significant, false)       as significant,
       s.max_score,
       coalesce(s.current_scores, '[]'::jsonb) as current_scores
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

-- ── Backfill: the legacy single score becomes the first history row ──────
do $$
begin
  -- 301 drops the legacy columns, so a re-run after 301 has nothing to carry over.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'environmental_aspects' and column_name = 'severity'
  ) then
    alter table public.environmental_aspects
      alter column operating_condition drop default,
      alter column operating_condition drop not null,
      alter column severity drop default,
      alter column severity drop not null,
      alter column likelihood drop default,
      alter column likelihood drop not null;
    execute $b$
      insert into public.environmental_aspect_scores
        (tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale, scored_by, scored_at)
      select a.tenant_id, a.id, a.operating_condition, a.severity, a.likelihood, m.id,
             'Carried over from the single-condition register when per-condition scoring was introduced (migration 297).',
             coalesce(a.updated_by, a.created_by), a.updated_at
        from public.environmental_aspects a
        join public.ms_scoring_methods m
          on m.tenant_id = a.tenant_id and m.discipline = 'ems' and m.is_default and m.retired_at is null
       where a.severity is not null
         and not exists (select 1 from public.environmental_aspect_scores s where s.aspect_id = a.id)
    $b$;
  end if;
end $$;

-- ── environmental_aspect_obligations ─────────────────────────────────────
create table if not exists public.environmental_aspect_obligations (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  aspect_id     uuid not null,
  obligation_id uuid not null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (aspect_id, obligation_id),
  constraint environmental_aspect_obligations_aspect_fk foreign key (tenant_id, aspect_id)
    references public.environmental_aspects (tenant_id, id) on delete cascade,
  constraint environmental_aspect_obligations_obligation_fk foreign key (tenant_id, obligation_id)
    references public.compliance_calendar_obligations (tenant_id, id) on delete cascade
);

create index if not exists idx_environmental_aspect_obligations_obligation
  on public.environmental_aspect_obligations (tenant_id, obligation_id);

drop trigger if exists trg_audit_environmental_aspect_obligations on public.environmental_aspect_obligations;
create trigger trg_audit_environmental_aspect_obligations
  after insert or update or delete on public.environmental_aspect_obligations
  for each row execute function public.log_audit('aspect_id');

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.environmental_aspect_scores      enable row level security;
alter table public.environmental_aspect_obligations enable row level security;

-- Scores: members read, admins insert, nobody updates or deletes (history).
drop policy if exists environmental_aspect_scores_member_read on public.environmental_aspect_scores;
create policy environmental_aspect_scores_member_read on public.environmental_aspect_scores
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists environmental_aspect_scores_admin_insert on public.environmental_aspect_scores;
create policy environmental_aspect_scores_admin_insert on public.environmental_aspect_scores
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );
revoke update, delete on public.environmental_aspect_scores from authenticated, anon;

drop policy if exists environmental_aspect_obligations_member_read on public.environmental_aspect_obligations;
create policy environmental_aspect_obligations_member_read on public.environmental_aspect_obligations
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists environmental_aspect_obligations_admin_write on public.environmental_aspect_obligations;
create policy environmental_aspect_obligations_admin_write on public.environmental_aspect_obligations
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
