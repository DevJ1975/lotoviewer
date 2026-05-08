-- Migration 087: chemical guardrails (Phase G slice 1).
--
-- Two tenant-scoped tables that gate dangerous decisions on the way
-- in to the catalog and inventory:
--
--   1. chemical_restricted_list — tenant-maintained register of
--      banned / "use alternative" chemicals (Prop 65, REACH SVHC,
--      internal greenlist, vendor-specific bans). Match is by CAS
--      number OR by free-form name pattern (case-insensitive
--      ilike). The product-create + inventory-create flows refuse
--      to write a row that hits a restriction unless the caller
--      passes an explicit override.
--
--   2. chemical_incompatibility_overrides — tenant override map
--      layered on top of the default GHS-pictogram-based rules
--      shipped in @soteria/core/chemicals. Each row is one pair
--      that gets blocked or explicitly allowed in the same
--      location, plus a reason string surfaced in the UI.
--
-- Idempotent — guarded with `if not exists`.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. chemical_restricted_list
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.chemical_restricted_list (
  id           uuid not null primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,

  -- Either a CAS number (preferred — exact match) OR a name pattern
  -- (ilike). Exactly one must be set; CHECK enforces.
  cas_number   text,
  name_pattern text,

  -- 'banned'      → cannot add to catalog or inventory; no override path
  --                 in the UI (override exists only at the API for an
  --                 admin emergency).
  -- 'restricted'  → blocks by default but the caller can pass an
  --                 explicit override flag with a justification.
  -- 'discouraged' → soft warning only; never blocks.
  severity     text not null default 'restricted'
                 check (severity in ('banned', 'restricted', 'discouraged')),

  reason       text,
  alternative  text,

  reference    text,             -- e.g. "Prop 65 listed 2026-01-01"

  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),

  check (
    (cas_number is not null and name_pattern is null)
    or (cas_number is null and name_pattern is not null)
  )
);

create index if not exists idx_chem_restricted_tenant
  on public.chemical_restricted_list(tenant_id);
create index if not exists idx_chem_restricted_cas
  on public.chemical_restricted_list(tenant_id, cas_number)
  where cas_number is not null;

-- Helper that returns the restriction row(s) hitting a given product
-- name + CAS list within the active tenant. Used by the API + the
-- product/inventory create handlers via .rpc().

create or replace function public.chemical_restricted_match(
  p_tenant uuid,
  p_name   text,
  p_cas    text[]
)
returns setof public.chemical_restricted_list
language sql
security definer
set search_path = public
as $$
  select r.*
    from public.chemical_restricted_list r
    where r.tenant_id = p_tenant
      and (
        (r.cas_number is not null and r.cas_number = any(coalesce(p_cas, '{}'::text[])))
        or (r.name_pattern is not null and p_name ilike r.name_pattern)
      );
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. chemical_incompatibility_overrides
-- ──────────────────────────────────────────────────────────────────────────
--
-- Default incompatibility rules live in code (GHS01..GHS09 pairs +
-- well-known storage_class clashes). This table lets a tenant:
--
--   - block a pair that the defaults consider OK;
--   - allow a pair the defaults block (with a reason — e.g.
--     "Building B annex is fully isolated; oxidizer cabinet is
--     across the hall").
--
-- Match key is a sorted pair of GHS pictograms OR a sorted pair of
-- storage_class strings; each row sets a boolean `compatible` and an
-- explanation. The checker layers tenant rules on top of defaults.

create table if not exists public.chemical_incompatibility_overrides (
  id            uuid not null primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  -- Sort the pair lexicographically so a uniqueness index works
  -- without storing both directions. Enforced via CHECK at insert.
  key_a         text not null,
  key_b         text not null,
  -- 'pictogram' (e.g. 'GHS02') | 'storage_class' (e.g. 'flammable_cabinet')
  key_kind      text not null check (key_kind in ('pictogram', 'storage_class')),

  compatible    boolean not null,
  reason        text,

  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),

  check (key_a <= key_b),
  unique (tenant_id, key_kind, key_a, key_b)
);

create index if not exists idx_chem_incompat_tenant
  on public.chemical_incompatibility_overrides(tenant_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ──────────────────────────────────────────────────────────────────────────

alter table public.chemical_restricted_list           enable row level security;
alter table public.chemical_incompatibility_overrides enable row level security;

drop policy if exists chem_restricted_tenant on public.chemical_restricted_list;
create policy chem_restricted_tenant on public.chemical_restricted_list
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

drop policy if exists chem_incompat_tenant on public.chemical_incompatibility_overrides;
create policy chem_incompat_tenant on public.chemical_incompatibility_overrides
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

notify pgrst, 'reload schema';

commit;
