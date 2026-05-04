-- Migration 027: multi-tenant schema (additive, non-breaking)
--
-- Phase 1 of the multi-tenant rollout. See:
--   docs/multi-tenant-plan.md       — base mechanics (RLS strategy, phases)
--   docs/multi-tenancy-saas-plan.md — SaaS additions (tenant_number, modules,
--                                     superadmin, demo flag, status)
--
-- Everything in this migration is additive and reversible:
--   - tenants and tenant_memberships are new tables
--   - tenant_id columns on every domain table are NULLABLE (NOT NULL is set in 029)
--   - profiles.is_superadmin is a new boolean defaulting to false
--   - RLS on the two new tables is permissive (authenticated read/write) until
--     029 rewrites every policy as tenant-scoped
--
-- Run order: 026 → 027 → 028 (backfill) → 029 (lockdown). Do NOT skip 028
-- before applying 029 or every domain query will return zero rows.

-- ────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ────────────────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────────────────
-- tenants — one row per customer organization
--
-- id              UUID PK, used by every FK and RLS predicate
-- tenant_number   4-digit zero-padded human ID ('0001'…'9999')
-- slug            URL-safe handle (e.g. 'snak-king', 'wls-demo')
-- name            display name
-- status          'active' | 'trial' | 'disabled' | 'archived'
-- is_demo         demo tenant — eligible for "Reset Demo" button + cron
-- disabled_at     soft-delete timestamp; filtered out of current_user_tenant_ids
-- modules         jsonb map of feature-id -> bool, top-level modules only
-- logo_url        public URL (or storage path) to the tenant's logo, shown
--                 in the app header so users can confirm they're in the
--                 correct tenant; nullable, defaults to no logo
-- custom_domain   reserved for future subdomain branding (nullable)
-- settings        jsonb bag for per-tenant config (work-order URL template, etc.)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id              uuid primary key default gen_random_uuid(),
  tenant_number   text unique
                    check (tenant_number ~ '^[0-9]{4}$' and tenant_number <> '0000'),
  slug            text unique not null
                    check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name            text not null
                    check (length(trim(name)) between 1 and 200),
  status          text not null default 'active'
                    check (status in ('active','trial','disabled','archived')),
  is_demo         boolean not null default false,
  disabled_at     timestamptz,
  modules         jsonb not null default '{}'::jsonb,
  logo_url        text
                    check (logo_url is null or logo_url ~ '^https?://'),
  custom_domain   text unique,
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- TODO(028): loto_org_config (singleton, work_order_url_template, etc.) folds
-- into tenants.settings jsonb during backfill. Snak King's row inherits the
-- current loto_org_config values; the table itself is deprecated in a later
-- migration.

create index if not exists tenants_status_idx       on public.tenants (status) where disabled_at is null;
create index if not exists tenants_tenant_number_idx on public.tenants (tenant_number);

-- ────────────────────────────────────────────────────────────────────────────
-- tenant_number_seq — drives next_tenant_number()
-- Starts at 1 so the first allocation returns '0001'.
-- ────────────────────────────────────────────────────────────────────────────
create sequence if not exists public.tenant_number_seq start 1 minvalue 1;

create or replace function public.next_tenant_number()
returns text
language sql
volatile
as $$
  select lpad(nextval('public.tenant_number_seq')::text, 4, '0')
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- tenant_memberships — N:M between auth.users and tenants
--
-- role: 'owner' | 'admin' | 'member' | 'viewer' (free-form text by design;
-- enum would force a migration every time we add a role)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_memberships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  role        text not null default 'member'
                check (role in ('owner','admin','member','viewer')),
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index if not exists idx_memberships_tenant on public.tenant_memberships(tenant_id);
create index if not exists idx_memberships_user   on public.tenant_memberships(user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Permissive RLS on tenants + tenant_memberships
--
-- Phase 3 (migration 029) rewrites these as tenant-scoped policies. Until
-- then, any authenticated user can read both tables. This is fine because
-- the app code in Phase 4 will scope by current tenant anyway, and the
-- backfill in 028 needs free read access to look up tenant slugs.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.tenants            enable row level security;
alter table public.tenant_memberships enable row level security;

drop policy if exists "tenants_authenticated_all" on public.tenants;
create policy "tenants_authenticated_all" on public.tenants
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "tenant_memberships_authenticated_all" on public.tenant_memberships;
create policy "tenant_memberships_authenticated_all" on public.tenant_memberships
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ────────────────────────────────────────────────────────────────────────────
-- profiles.is_superadmin
--
-- Defaults to false. Promotion to superadmin is a manual UPDATE — no UI to
-- flip this flag, by design. The route guard requireSuperadmin() in
-- lib/auth/superadmin.ts also checks SUPERADMIN_EMAILS env allowlist; both
-- gates must pass.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_superadmin boolean not null default false;

-- ────────────────────────────────────────────────────────────────────────────
-- tenant_id on every domain table (nullable for now)
--
-- Migration 028 backfills these to Snak King (0001). Migration 029 sets them
-- NOT NULL and rewrites RLS to filter by tenant.
-- ────────────────────────────────────────────────────────────────────────────

-- The full list of domain tables. Each entry is a public.<table_name>; the
-- DO block below skips any that don't exist on this DB (e.g. if a feature's
-- migration hasn't been applied yet) so a partial-state DB still applies
-- cleanly. RAISE NOTICE prints a list of skipped tables in the SQL Editor's
-- Notices pane — review it before running migration 029.
--
-- Notes on what's NOT in the list:
-- - photo_annotations / iso_annotations live as jsonb columns on
--   loto_equipment, not as separate tables (migrations 015, 022)
-- - hot_work pre-work checklist is a jsonb column on loto_hot_work_permits
-- - signon_token is a column on loto_confined_space_permits, not a table
do $$
declare
  t text;
  domain_tables text[] := array[
    -- LOTO core
    'loto_equipment',
    'loto_energy_steps',
    'loto_reviews',
    -- Confined Spaces
    'loto_confined_spaces',
    'loto_confined_space_permits',
    'loto_confined_space_entries',
    'loto_atmospheric_tests',
    -- Hot Work
    'loto_hot_work_permits',
    -- Training, devices, gas meters, integrations, hygiene
    'loto_training_records',
    'loto_devices',
    'loto_device_checkouts',
    'loto_gas_meters',
    'loto_meter_alerts',
    'loto_webhook_subscriptions',
    'loto_push_subscriptions',
    'loto_hygiene_log',
    -- Audit log: nullable forever. Cross-tenant superadmin actions
    -- legitimately have no tenant context, so 029 will not set NOT NULL.
    'audit_log'
  ];
  skipped text[] := '{}';
begin
  foreach t in array domain_tables loop
    if exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = t
    ) then
      execute format(
        'alter table public.%I add column if not exists tenant_id uuid references public.tenants(id)',
        t
      );
      execute format(
        'create index if not exists %I on public.%I(tenant_id)',
        'idx_' || t || '_tenant',
        t
      );
    else
      skipped := array_append(skipped, t);
    end if;
  end loop;

  if array_length(skipped, 1) > 0 then
    raise notice 'Migration 027 skipped these missing tables (review before applying 028/029): %', skipped;
  end if;
end $$;

-- audit_log gets a composite (tenant_id, created_at desc) index for the
-- common "show me this tenant's recent audit rows" query. The plain
-- tenant_id index added by the loop above is fine, but the composite is
-- cheaper for that read pattern.
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'audit_log'
  ) then
    create index if not exists idx_audit_log_tenant_time
      on public.audit_log(tenant_id, created_at desc);
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- updated_at trigger on tenants (mirrors the pattern from earlier migrations)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at
  before update on public.tenants
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_tenant_memberships_updated_at on public.tenant_memberships;
create trigger trg_tenant_memberships_updated_at
  before update on public.tenant_memberships
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- Audit triggers on the new tables
--
-- Reuses log_audit() from migration 003. Tenant changes (rename, status flip,
-- modules toggle) and membership changes (role changes, invites, removals)
-- are sensitive — the audit trail is the only after-the-fact record of who
-- did what.
--
-- For tenant_memberships the table has a composite PK (user_id, tenant_id).
-- log_audit takes a single PK column name; we pass 'user_id' so audits are
-- searchable by member, with the tenant_id available in the new_row jsonb.
-- ────────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_tenants on public.tenants;
create trigger trg_audit_tenants
  after insert or update or delete on public.tenants
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_tenant_memberships on public.tenant_memberships;
create trigger trg_audit_tenant_memberships
  after insert or update or delete on public.tenant_memberships
  for each row execute function public.log_audit('user_id');

-- ────────────────────────────────────────────────────────────────────────────
-- tenant-logos storage bucket
--
-- Public-read so the AppChrome <img src> just works. Writes restricted to
-- superadmins (gated by profiles.is_superadmin; the route layer additionally
-- enforces SUPERADMIN_EMAILS allowlist).
--
-- Path convention: tenant-logos/{tenant_id}.{ext}
--
-- Idempotent: re-running this migration won't duplicate the bucket or fail
-- on already-existing policies.
-- ────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('tenant-logos', 'tenant-logos', true)
on conflict (id) do nothing;

drop policy if exists "tenant_logos_public_read"      on storage.objects;
drop policy if exists "tenant_logos_superadmin_write" on storage.objects;

create policy "tenant_logos_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'tenant-logos');

create policy "tenant_logos_superadmin_write" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'tenant-logos'
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.is_superadmin = true
    )
  )
  with check (
    bucket_id = 'tenant-logos'
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.is_superadmin = true
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Reload PostgREST schema cache so the new columns appear in the API
-- ────────────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
