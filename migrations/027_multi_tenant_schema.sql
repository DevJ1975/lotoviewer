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
-- custom_domain   reserved for future subdomain branding (nullable)
-- settings        jsonb bag for per-tenant config (work-order URL template, etc.)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id              uuid primary key default gen_random_uuid(),
  tenant_number   text unique check (tenant_number ~ '^[0-9]{4}$'),
  slug            text unique not null,
  name            text not null,
  status          text not null default 'active'
                    check (status in ('active','trial','disabled','archived')),
  is_demo         boolean not null default false,
  disabled_at     timestamptz,
  modules         jsonb not null default '{}'::jsonb,
  custom_domain   text unique,
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

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

-- LOTO core (001, 002, 008, 015, 022, 023)
alter table public.loto_equipment     add column if not exists tenant_id uuid references public.tenants(id);
alter table public.loto_energy_steps  add column if not exists tenant_id uuid references public.tenants(id);
alter table public.loto_reviews       add column if not exists tenant_id uuid references public.tenants(id);
alter table public.photo_annotations  add column if not exists tenant_id uuid references public.tenants(id);

-- Confined Spaces (009, 010)
alter table public.loto_confined_spaces         add column if not exists tenant_id uuid references public.tenants(id);
alter table public.loto_confined_space_permits  add column if not exists tenant_id uuid references public.tenants(id);
alter table public.loto_atmospheric_tests       add column if not exists tenant_id uuid references public.tenants(id);

-- Hot Work (019, 020)
alter table public.loto_hot_work_permits     add column if not exists tenant_id uuid references public.tenants(id);
alter table public.loto_hot_work_checklists  add column if not exists tenant_id uuid references public.tenants(id);

-- Training, devices, integrations (013, 016, 017, 024, 025, 026)
alter table public.training_records       add column if not exists tenant_id uuid references public.tenants(id);
alter table public.loto_devices           add column if not exists tenant_id uuid references public.tenants(id);
alter table public.webhooks               add column if not exists tenant_id uuid references public.tenants(id);
alter table public.push_subscriptions     add column if not exists tenant_id uuid references public.tenants(id);
alter table public.permit_signon_tokens   add column if not exists tenant_id uuid references public.tenants(id);
alter table public.meter_alerts           add column if not exists tenant_id uuid references public.tenants(id);

-- Audit log: nullable forever. Cross-tenant superadmin actions legitimately
-- have no tenant context, so we never set NOT NULL on this column.
alter table public.audit_log              add column if not exists tenant_id uuid references public.tenants(id);

-- ────────────────────────────────────────────────────────────────────────────
-- Composite indexes on (tenant_id) so the upcoming RLS predicate is cheap.
-- Partial indexes that exclude NULL would be faster but break post-backfill,
-- so plain b-tree on the full column.
-- ────────────────────────────────────────────────────────────────────────────
create index if not exists idx_loto_equipment_tenant            on public.loto_equipment(tenant_id);
create index if not exists idx_loto_energy_steps_tenant         on public.loto_energy_steps(tenant_id);
create index if not exists idx_loto_reviews_tenant              on public.loto_reviews(tenant_id);
create index if not exists idx_photo_annotations_tenant         on public.photo_annotations(tenant_id);
create index if not exists idx_confined_spaces_tenant           on public.loto_confined_spaces(tenant_id);
create index if not exists idx_confined_space_permits_tenant    on public.loto_confined_space_permits(tenant_id);
create index if not exists idx_atmospheric_tests_tenant         on public.loto_atmospheric_tests(tenant_id);
create index if not exists idx_hot_work_permits_tenant          on public.loto_hot_work_permits(tenant_id);
create index if not exists idx_hot_work_checklists_tenant       on public.loto_hot_work_checklists(tenant_id);
create index if not exists idx_training_records_tenant          on public.training_records(tenant_id);
create index if not exists idx_loto_devices_tenant              on public.loto_devices(tenant_id);
create index if not exists idx_webhooks_tenant                  on public.webhooks(tenant_id);
create index if not exists idx_push_subscriptions_tenant        on public.push_subscriptions(tenant_id);
create index if not exists idx_permit_signon_tokens_tenant      on public.permit_signon_tokens(tenant_id);
create index if not exists idx_meter_alerts_tenant              on public.meter_alerts(tenant_id);
create index if not exists idx_audit_log_tenant                 on public.audit_log(tenant_id, created_at desc);

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

-- ────────────────────────────────────────────────────────────────────────────
-- Reload PostgREST schema cache so the new columns appear in the API
-- ────────────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
