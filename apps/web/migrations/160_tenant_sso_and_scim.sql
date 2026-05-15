-- Migration 160: SAML/OIDC SSO configuration + SCIM provisioning tokens.
--
-- Two tables that together let an enterprise tenant federate identity
-- and provision workforce records via SCIM 2.0:
--
--   tenant_sso_configurations  one row per tenant. Holds the IdP
--     metadata (URL or pasted XML), provider type (saml / oidc), and
--     the SP-side identifiers we expose back to the IdP. Persisting
--     this in our DB is the tenant-side half of SSO setup — actual
--     enablement at the Supabase Auth layer requires a separate
--     superadmin API call (Supabase SAML SSO is a managed feature).
--     The /admin/sso route surfaces that next-step instruction.
--
--   scim_tokens                token-based auth for SCIM 2.0
--     User provisioning. The plaintext token is SHOWN ONCE at create
--     time and only the sha-256 hex is persisted. Lookup at the API
--     boundary hashes the incoming bearer token and matches against
--     this column — there is no way to recover the plaintext from the
--     stored value.
--
-- The SCIM API itself lives at /api/scim/v2/Users and writes into
-- loto_workers (no auth.users row — these are shop-floor workforce
-- records, not app logins). Keeping SCIM users separate from auth
-- users is intentional: SSO via SAML provisions login identities;
-- SCIM provisions the workforce roster that LOTO devices, training
-- records, and BBS observations attach to.
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. tenant_sso_configurations — one row per tenant
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_sso_configurations (
  tenant_id           uuid        primary key references public.tenants(id) on delete cascade,
  -- saml = SAML 2.0 (Okta, Azure AD, Ping, ADFS). oidc = OpenID Connect
  -- (Google Workspace, Microsoft Entra, Auth0). Storing as text+check
  -- so adding 'scim_only' or future protocols never requires an
  -- ALTER TYPE migration.
  provider            text        not null
                        check (provider in ('saml', 'oidc')),
  -- Two ways to give us the IdP metadata. Either URL is honored first;
  -- if XML is pasted, the URL is treated as a backup. Validation at
  -- the API layer ensures at least one is non-empty before enabled
  -- can flip to true.
  idp_metadata_url    text
                        check (idp_metadata_url is null
                               or idp_metadata_url ~ '^https?://'),
  idp_metadata_xml    text,
  -- The values we expose back to the IdP. Stored so the admin UI can
  -- show "configure your IdP with these values" without recomputing
  -- them from env on every render.
  sp_entity_id        text        not null check (length(btrim(sp_entity_id)) > 0),
  sp_acs_url          text        not null check (sp_acs_url ~ '^https?://'),
  enabled             boolean     not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by_user_id  uuid        references auth.users(id) on delete set null
);

comment on table public.tenant_sso_configurations is
  'Per-tenant SAML / OIDC SSO configuration. Persists the tenant-side metadata; the Supabase SAML enablement is a separate superadmin-only step.';

-- ────────────────────────────────────────────────────────────────────
-- 2. scim_tokens — bearer tokens for /api/scim/v2/Users
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.scim_tokens (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          uuid        not null references public.tenants(id) on delete cascade,
  name               text        not null check (length(btrim(name)) > 0),
  -- SHA-256 of the raw token, hex-encoded (64 chars). The plaintext is
  -- returned exactly once to the admin at create time; this column is
  -- the only persistent record. Lookup hashes the inbound bearer and
  -- matches against this column.
  token_hash         text        not null
                       check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Free-form scopes (e.g. 'users:write', 'users:read'). For the
  -- v1 surface we only check the bearer is non-revoked — fine-grained
  -- scope enforcement is a future refinement. Stored as text[] so the
  -- shape is ready when scopes start mattering.
  scopes             text[]      not null default array['users:read', 'users:write']::text[],
  created_by_user_id uuid        references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  -- A revoked token's hash is preserved so a leak-after-revoke is still
  -- traceable in audit logs. The check at the API layer rejects rows
  -- where revoked_at is not null.
  unique (tenant_id, token_hash)
);

create index if not exists idx_scim_tokens_tenant_active
  on public.scim_tokens(tenant_id)
  where revoked_at is null;

comment on table public.scim_tokens is
  'SCIM 2.0 bearer tokens, hashed at rest. The plaintext is shown once to the admin at create time and never persisted. Lookup hashes the inbound bearer and matches token_hash.';

-- ────────────────────────────────────────────────────────────────────
-- 3. loto_workers.scim_external_id — SCIM upsert key
-- ────────────────────────────────────────────────────────────────────
-- SCIM clients carry an externalId per user (the IdP's stable ID).
-- Using it as the upsert key means a re-sync from the IdP updates the
-- existing worker row instead of creating duplicates. Per-tenant
-- unique when set so two IdPs in different tenants can use the same
-- externalId without collision.
alter table public.loto_workers
  add column if not exists scim_external_id text;

create unique index if not exists idx_loto_workers_scim_external_id
  on public.loto_workers(tenant_id, scim_external_id)
  where scim_external_id is not null;

comment on column public.loto_workers.scim_external_id is
  'SCIM externalId from the upstream IdP. Used as the upsert key by /api/scim/v2/Users so re-syncs update the existing worker row.';

-- ────────────────────────────────────────────────────────────────────
-- 4. RLS — tenant-scoped on both new tables
-- ────────────────────────────────────────────────────────────────────
alter table public.tenant_sso_configurations enable row level security;
alter table public.scim_tokens               enable row level security;

drop policy if exists "tenant_sso_configurations_tenant_scope"
  on public.tenant_sso_configurations;
create policy "tenant_sso_configurations_tenant_scope"
  on public.tenant_sso_configurations
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop policy if exists "scim_tokens_tenant_scope" on public.scim_tokens;
create policy "scim_tokens_tenant_scope"
  on public.scim_tokens
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

-- ────────────────────────────────────────────────────────────────────
-- 5. Audit + touch triggers
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_tenant_sso_configurations
  on public.tenant_sso_configurations;
create trigger trg_audit_tenant_sso_configurations
  after insert or update or delete on public.tenant_sso_configurations
  for each row execute function public.log_audit('tenant_id');

drop trigger if exists trg_tenant_sso_configurations_updated_at
  on public.tenant_sso_configurations;
create trigger trg_tenant_sso_configurations_updated_at
  before update on public.tenant_sso_configurations
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_scim_tokens on public.scim_tokens;
create trigger trg_audit_scim_tokens
  after insert or update or delete on public.scim_tokens
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
