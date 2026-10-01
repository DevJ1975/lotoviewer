-- Migration 296: scoring methods for significance (ISO 14001 clause 6.1.2).
--
-- Migration 204 hard-coded one rule into two generated columns: severity ×
-- likelihood on a 1-5 scale, significant at 12. Clause 6.1.2 asks for the
-- criteria to be documented and stored with each assessment, and a site
-- may need a different matrix, so the rule becomes a row:
--
--   ms_scoring_methods     severity/likelihood scales, an optional lookup
--                          matrix, and the significance threshold
--   ms_method_score()      the one SQL scoring rule; scoreAspect() in
--                          packages/core mirrors it, and a database test
--                          pins the two together
--
-- A method's arithmetic is frozen once saved: a score row plus its method
-- must reproduce the same answer forever, so a changed rule is a new
-- version (a new row). Every tenant that already has aspects gets a
-- default method equal to the old hard-coded rule, so no significance
-- changes.
--
-- Idempotent. Rollback: 296_rollback.sql.

begin;

create table if not exists public.ms_scoring_methods (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  discipline             text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  name                   text not null check (length(btrim(name)) > 0),
  version                int  not null default 1 check (version >= 1),
  severity_levels        int  not null default 5 check (severity_levels between 2 and 10),
  likelihood_levels      int  not null default 5 check (likelihood_levels between 2 and 10),
  -- null = severity × likelihood; otherwise matrix[severity-1][likelihood-1].
  -- Its shape is checked by validateScoringMethod() at the API boundary.
  matrix                 jsonb check (matrix is null or jsonb_typeof(matrix) = 'array'),
  significance_threshold int  not null check (significance_threshold > 0),
  is_default             boolean not null default false,
  retired_at             timestamptz,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (tenant_id, discipline, name, version),
  unique (tenant_id, id)   -- target for same-tenant foreign keys from scores
);

-- One active default method per tenant and discipline.
create unique index if not exists uq_ms_scoring_methods_default
  on public.ms_scoring_methods (tenant_id, discipline) where is_default and retired_at is null;

-- The scoring rule. immutable: same inputs, same score, so it is safe in views and indexes.
create or replace function public.ms_method_score(p_matrix jsonb, p_severity int, p_likelihood int)
returns int
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce((p_matrix -> (p_severity - 1) ->> (p_likelihood - 1))::int, p_severity * p_likelihood)
$$;

-- Freeze a method's arithmetic. Naming, retiring and the default flag may change.
create or replace function public.ms_scoring_methods_frozen()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.severity_levels        is distinct from old.severity_levels
  or new.likelihood_levels      is distinct from old.likelihood_levels
  or new.matrix                 is distinct from old.matrix
  or new.significance_threshold is distinct from old.significance_threshold
  or new.tenant_id              is distinct from old.tenant_id
  or new.discipline             is distinct from old.discipline then
    raise exception 'ms_scoring_methods % is frozen: save a new version instead of changing its scoring rule', old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_ms_scoring_methods_frozen on public.ms_scoring_methods;
create trigger trg_ms_scoring_methods_frozen
  before update on public.ms_scoring_methods
  for each row execute function public.ms_scoring_methods_frozen();

drop trigger if exists trg_audit_ms_scoring_methods on public.ms_scoring_methods;
create trigger trg_audit_ms_scoring_methods
  after insert or update or delete on public.ms_scoring_methods
  for each row execute function public.log_audit('id');

-- Default method for every tenant that already has aspects: exactly migration 204's rule.
insert into public.ms_scoring_methods (tenant_id, name, significance_threshold, is_default)
select distinct a.tenant_id, 'Severity × likelihood (5×5)', 12, true
  from public.environmental_aspects a
on conflict do nothing;

-- RLS: members read, admins write. Methods are tenant-wide (no facility).
alter table public.ms_scoring_methods enable row level security;

drop policy if exists ms_scoring_methods_member_read on public.ms_scoring_methods;
create policy ms_scoring_methods_member_read on public.ms_scoring_methods
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists ms_scoring_methods_admin_write on public.ms_scoring_methods;
create policy ms_scoring_methods_admin_write on public.ms_scoring_methods
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
