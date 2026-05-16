-- Migration 161: CMMS bidirectional sync — Maximo / SAP PM / eMaint / generic.
--
-- A maintenance work order (WO) in a CMMS represents a planned
-- intervention on equipment. From a LOTO compliance standpoint:
--
--   - When the CMMS opens a WO that touches energy-isolated equipment,
--     a LOTO procedure attachment is required before the WO can be
--     closed. Today that connection is a paper conversation between
--     the planner and the safety lead.
--   - When the WO is closed, the periodic-inspection counter for that
--     equipment should advance if the LOTO procedure was applied.
--
-- This module wires the CMMS as a webhook-driven peer:
--
--   cmms_integrations         one row per CMMS connection (per tenant).
--                             Carries the base URL, encrypted auth
--                             token (held by the integration cron, not
--                             read here), and the inbound webhook HMAC
--                             secret.
--
--   cmms_sync_events          append-only log of every inbound or
--                             outbound event. Direction is enum to
--                             keep the inbound/outbound projections
--                             trivial; status drives the retry cron.
--
--   cmms_work_order_links     one row per CMMS work order observed for
--                             a piece of equipment. Lets the equipment
--                             detail page show "WO #1234 open" without
--                             refetching the CMMS on each render.
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. cmms_integrations
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.cmms_integrations (
  id                     uuid        primary key default gen_random_uuid(),
  tenant_id              uuid        not null references public.tenants(id) on delete cascade,
  -- System enum. 'generic' is the escape hatch for any system whose
  -- webhook follows the same {event_type, work_order_id, equipment_id,
  -- status} shape — covers Hippo, UpKeep, Limble, MaintainX, etc.
  system                 text        not null
                           check (system in ('maximo', 'sap_pm', 'emaint', 'generic')),
  name                   text        not null check (length(btrim(name)) > 0),
  -- API endpoint we POST outbound updates to. NULL means inbound-only
  -- (some tenants are happy to receive WOs but won't open the firewall
  -- for our outbound writes).
  base_url               text
                           check (base_url is null or base_url ~ '^https?://'),
  -- Encrypted at rest with the platform-wide key (the key itself
  -- lives in env, not the DB). Reading the plaintext requires the
  -- integration cron which has the key.
  auth_token_encrypted   text,
  -- HMAC-SHA256 shared secret. Inbound webhooks must include an
  -- X-Soteria-Signature: sha256=<hex> header — we recompute over the
  -- raw body and reject on mismatch (timing-safe compare in the API).
  webhook_secret         text        not null check (length(btrim(webhook_secret)) >= 16),
  enabled                boolean     not null default true,
  last_sync_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by_user_id     uuid        references auth.users(id) on delete set null,
  -- Two integrations for the same external system, in the same tenant,
  -- with the same name would be a UX disaster ("which Maximo?"). Allow
  -- distinct names per tenant + system.
  unique (tenant_id, system, name)
);

comment on table public.cmms_integrations is
  'CMMS connection per tenant. webhook_secret signs inbound bodies (HMAC-SHA256); auth_token_encrypted is read by the integration cron with the platform key.';

create index if not exists idx_cmms_integrations_tenant_active
  on public.cmms_integrations(tenant_id) where enabled;

-- ────────────────────────────────────────────────────────────────────
-- 2. cmms_sync_events  — append-only log
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.cmms_sync_events (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  integration_id  uuid        not null references public.cmms_integrations(id) on delete cascade,
  direction       text        not null check (direction in ('inbound', 'outbound')),
  event_type      text        not null check (length(btrim(event_type)) > 0),
  payload         jsonb       not null default '{}'::jsonb,
  status          text        not null default 'pending'
                    check (status in ('pending', 'delivered', 'failed')),
  attempts        int         not null default 0 check (attempts >= 0),
  error_message   text,
  processed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- The cron polls (tenant_id, status, created_at) so the index covers
-- the worst case for "find all failed/pending events to retry".
create index if not exists idx_cmms_sync_events_retry
  on public.cmms_sync_events(tenant_id, status, created_at)
  where status in ('pending', 'failed');

create index if not exists idx_cmms_sync_events_integration_recent
  on public.cmms_sync_events(integration_id, created_at desc);

comment on table public.cmms_sync_events is
  'Append-only event log for CMMS bidirectional sync. status=pending|failed rows are retried by the integration cron.';

-- ────────────────────────────────────────────────────────────────────
-- 3. cmms_work_order_links
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.cmms_work_order_links (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,
  -- Equipment IDs are tenant-scoped text in this app (see loto_equipment),
  -- so the FK target is the column, not a UUID join. The (tenant_id,
  -- equipment_id) pair is referentially valid through the unique index
  -- below + the FK on loto_equipment.
  equipment_id         text        not null,
  cmms_system          text        not null check (length(btrim(cmms_system)) > 0),
  cmms_work_order_id   text        not null check (length(btrim(cmms_work_order_id)) > 0),
  status               text        not null check (length(btrim(status)) > 0),
  opened_at            timestamptz,
  closed_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- One link per (CMMS, WO id) per tenant. Re-receiving the same WO
  -- via webhook updates the existing row.
  unique (tenant_id, cmms_system, cmms_work_order_id)
);

create index if not exists idx_cmms_wo_links_equipment_open
  on public.cmms_work_order_links(tenant_id, equipment_id)
  where closed_at is null;

comment on table public.cmms_work_order_links is
  'CMMS work orders mirrored locally so the equipment detail page can show "WO #1234 open" without round-tripping the CMMS on every render.';

-- ────────────────────────────────────────────────────────────────────
-- 4. RLS — tenant-scoped on every new table
-- ────────────────────────────────────────────────────────────────────
alter table public.cmms_integrations      enable row level security;
alter table public.cmms_sync_events       enable row level security;
alter table public.cmms_work_order_links  enable row level security;

drop policy if exists "cmms_integrations_tenant_scope" on public.cmms_integrations;
create policy "cmms_integrations_tenant_scope" on public.cmms_integrations
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop policy if exists "cmms_sync_events_tenant_scope" on public.cmms_sync_events;
create policy "cmms_sync_events_tenant_scope" on public.cmms_sync_events
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop policy if exists "cmms_work_order_links_tenant_scope" on public.cmms_work_order_links;
create policy "cmms_work_order_links_tenant_scope" on public.cmms_work_order_links
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
drop trigger if exists trg_audit_cmms_integrations on public.cmms_integrations;
create trigger trg_audit_cmms_integrations
  after insert or update or delete on public.cmms_integrations
  for each row execute function public.log_audit('id');

drop trigger if exists trg_cmms_integrations_updated_at on public.cmms_integrations;
create trigger trg_cmms_integrations_updated_at
  before update on public.cmms_integrations
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_cmms_sync_events on public.cmms_sync_events;
create trigger trg_audit_cmms_sync_events
  after insert or update or delete on public.cmms_sync_events
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_cmms_work_order_links on public.cmms_work_order_links;
create trigger trg_audit_cmms_work_order_links
  after insert or update or delete on public.cmms_work_order_links
  for each row execute function public.log_audit('id');

drop trigger if exists trg_cmms_work_order_links_updated_at on public.cmms_work_order_links;
create trigger trg_cmms_work_order_links_updated_at
  before update on public.cmms_work_order_links
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';

commit;
