-- Migration 060: Incident People — injured persons, witnesses, supervisors.
--
-- One incident can have multiple people involved with different roles.
-- The injured person carries OSHA 301 PII (DOB, address, gender) which
-- is gated behind a more restrictive RLS predicate (admin / owner /
-- assigned investigator only). Witnesses are visible to all tenant
-- members so the floor team knows who saw what.
--
-- Body parts + injury nature/source map directly to OSHA 300 columns
-- (M, N, O — body part, injury source, type) and the body-part heatmap
-- visualization on the scorecard.

begin;

create table if not exists public.incident_people (
  id                       uuid not null primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  incident_id              uuid not null references public.incidents(id) on delete cascade,

  person_role              text not null check (person_role in (
    'injured','witness','involved','first_responder','supervisor','reporter')),

  -- Optional: when the person is a Soteria user, link to auth.users.
  -- Contractors / visitors / public have user_id=null and full_name set.
  user_id                  uuid references auth.users(id),
  full_name                text,
  email                    text,
  phone                    text,

  employment_type          text check (employment_type is null or employment_type in (
    'employee','contractor','visitor','public','volunteer')),
  job_title                text,
  hire_date                date,

  -- ── PII (OSHA 301 §I) — gated by the security-definer view below. ──
  date_of_birth            date,
  gender                   text check (gender is null or gender in ('male','female','other','prefer_not_to_say')),
  home_address             text,

  -- ── Injury detail (OSHA 300 columns) — only meaningful for
  --    person_role='injured', but no NOT NULL so witnesses / supervisors
  --    can leave them blank. ──
  -- Body part taxonomy: keep open-ended (text array) so the front-end
  -- can drive autocomplete from a controlled vocabulary without forcing
  -- a DB enum. Examples: 'back_lower', 'hand_right', 'eye_left'.
  body_part                text[],
  injury_nature            text,            -- 'laceration','sprain','burn'...
  injury_source            text,            -- 'machine','floor','chemical'...
  treatment_facility       text,

  -- The primary injured person on this incident — used for OSHA 301
  -- which is one form per injured person. There can be more than one
  -- injured person per incident (multi-victim event); each gets its
  -- own 301. Exactly one row should be is_primary=true per
  -- (incident_id, person_role='injured') — enforced by partial unique
  -- index below.
  is_primary               boolean not null default false,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_incident_people_incident
  on public.incident_people(incident_id, person_role);
create index if not exists idx_incident_people_tenant
  on public.incident_people(tenant_id);
create index if not exists idx_incident_people_user
  on public.incident_people(user_id) where user_id is not null;

-- Exactly one primary injured person per incident.
create unique index if not exists ux_incident_people_primary_injured
  on public.incident_people(incident_id)
  where is_primary = true and person_role = 'injured';

drop trigger if exists trg_incident_people_touch_updated_at on public.incident_people;
create trigger trg_incident_people_touch_updated_at
  before update on public.incident_people
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- RLS — tenant scope, with PII gating in the helper below.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.incident_people enable row level security;

drop policy if exists incident_people_tenant_scope on public.incident_people;
create policy incident_people_tenant_scope on public.incident_people
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- PII helper + redacted view.
-- ──────────────────────────────────────────────────────────────────────────
--
-- can_view_incident_pii(incident_id) returns true when the current
-- user is:
--   1. a superadmin, or
--   2. an owner / admin on the tenant that owns the incident, or
--   3. the assigned_investigator on the incident.
--
-- Used by the incident_people_safe view: PII columns return NULL for
-- callers who don't pass the check. The base table still exists for
-- admin queries; the view is what the API routes hit by default.

create or replace function public.can_view_incident_pii(p_incident_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    public.is_superadmin(), false
  ) or exists (
    select 1
      from public.incidents i
      join public.tenant_memberships m
        on m.tenant_id = i.tenant_id
       and m.user_id   = auth.uid()
     where i.id = p_incident_id
       and m.role in ('owner','admin')
  ) or exists (
    select 1
      from public.incidents i
     where i.id = p_incident_id
       and i.assigned_investigator = auth.uid()
  );
$$;

create or replace view public.incident_people_safe as
  select
    p.id, p.tenant_id, p.incident_id,
    p.person_role, p.user_id, p.full_name, p.email, p.phone,
    p.employment_type, p.job_title, p.hire_date,
    -- PII columns: redacted unless caller can view.
    case when public.can_view_incident_pii(p.incident_id) then p.date_of_birth end as date_of_birth,
    case when public.can_view_incident_pii(p.incident_id) then p.gender        end as gender,
    case when public.can_view_incident_pii(p.incident_id) then p.home_address  end as home_address,
    p.body_part, p.injury_nature, p.injury_source, p.treatment_facility,
    p.is_primary,
    p.created_at, p.updated_at
  from public.incident_people p;

grant select on public.incident_people_safe to authenticated;

notify pgrst, 'reload schema';

commit;
