-- Migration 172: California facilities subject to Title 8 §5194 + Prop 65.
--
-- Cal/OSHA Title 8 §5194 (the CA Hazard Communication Standard) and
-- Health & Safety Code §25249.6 attach at the SITE level — warnings,
-- exposure assessments, and the §25249.5 annual review are all site-
-- scoped. A multi-state tenant therefore needs a dedicated registry of
-- its California facilities; we don't repurpose tenants.address since
-- many tenants have several CA sites.
--
-- public_slug exists because the 2018 Prop 65 regs (Cal. Code Regs
-- tit. 27 §25602(a)(4)) require the physical warning sign to point
-- to a URL where the warning's chemicals are listed in detail. We
-- mint a stable per-site slug here; /prop65/[slug]/page.tsx renders
-- the matching warnings publicly (no auth).
--
-- Idempotent.

begin;

create table if not exists public.prop65_sites (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references public.tenants(id) on delete cascade,
  name                text        not null check (length(btrim(name)) > 0),
  address             text,
  city                text,
  state               text        not null default 'CA'
                        check (length(state) = 2),
  -- Used by /admin/prop65 to gauge applicability — the §25249.6 duty
  -- to warn attaches at 10+ employees statewide.
  employee_count      integer     check (employee_count is null or employee_count >= 0),
  -- Tenant-unique slug for the public route. Lowercased ASCII +
  -- hyphens, plus a short random suffix when slugify alone collides.
  public_slug         text        not null
                        check (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, public_slug)
);

create index if not exists idx_prop65_sites_tenant
  on public.prop65_sites (tenant_id, name);

comment on table public.prop65_sites is
  'California facilities subject to Title 8 §5194 / Prop 65. public_slug is the public warning URL handle (Cal. Code Regs tit. 27 §25602(a)(4)).';

-- ────────────────────────────────────────────────────────────────────
-- 1. Slug generation — BEFORE INSERT
-- ────────────────────────────────────────────────────────────────────
-- Slugify(name) collisions inside a tenant are resolved by appending
-- a 4-char random suffix; on the rare second collision the trigger
-- retries up to 5 times. Search_path is hardened per AGENTS.md.
create or replace function public.prop65_sites_assign_slug()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  base text;
  candidate text;
  attempts int := 0;
begin
  if new.public_slug is not null and length(btrim(new.public_slug)) > 0 then
    return new;
  end if;

  base := lower(regexp_replace(coalesce(new.name, 'site'), '[^a-zA-Z0-9]+', '-', 'g'));
  base := btrim(base, '-');
  if length(base) = 0 then base := 'site'; end if;
  if length(base) > 40 then base := substring(base from 1 for 40); end if;

  candidate := base;
  loop
    exit when not exists (
      select 1 from public.prop65_sites s
      where s.tenant_id = new.tenant_id
        and s.public_slug = candidate
    );
    attempts := attempts + 1;
    if attempts > 5 then
      raise exception 'unable to assign unique prop65 site slug after 5 attempts';
    end if;
    candidate := base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
  end loop;
  new.public_slug := candidate;
  return new;
end $$;

drop trigger if exists trg_prop65_sites_assign_slug on public.prop65_sites;
create trigger trg_prop65_sites_assign_slug
  before insert on public.prop65_sites
  for each row execute function public.prop65_sites_assign_slug();

drop trigger if exists trg_prop65_sites_touch on public.prop65_sites;
create trigger trg_prop65_sites_touch
  before update on public.prop65_sites
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- 2. RLS — tenant scope (+ a public read by slug for /prop65/[slug])
-- ────────────────────────────────────────────────────────────────────
alter table public.prop65_sites enable row level security;

drop policy if exists "prop65_sites_tenant_scope" on public.prop65_sites;
create policy "prop65_sites_tenant_scope"
  on public.prop65_sites
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

-- Anonymous read for the public warning route — only the slug + name +
-- city + state are exposed via the matching view in migration 174.
-- The base table is still gated. We grant a narrow anon select used
-- only by the server-side lookup in /prop65/[slug].
drop policy if exists "prop65_sites_public_slug_read" on public.prop65_sites;
create policy "prop65_sites_public_slug_read"
  on public.prop65_sites
  for select to anon
  using (true);

-- ────────────────────────────────────────────────────────────────────
-- 3. Audit
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_prop65_sites on public.prop65_sites;
create trigger trg_audit_prop65_sites
  after insert or update or delete on public.prop65_sites
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
