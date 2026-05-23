-- Migration 192: compliance obligations calendar.
--
-- One row per recurring compliance obligation a tenant must satisfy
-- (regulatory deadlines + tenant-defined items), plus an append-only
-- completion log. The app seeds well-known regulatory obligations
-- per-tenant (idempotent via the unique system_key index) and advances
-- next_due_at when an obligation is completed.
--
-- Idempotent: create table/index/policy guards throughout.

begin;

create table if not exists public.compliance_obligations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  title           text not null,
  description     text,
  regulatory_ref  text,
  category        text not null default 'general',
  cadence         text not null default 'annual'
                    check (cadence in ('once','monthly','quarterly','semiannual','annual','biennial','triennial','quinquennial','custom_days')),
  cadence_days    int,
  next_due_at     date not null,
  owner_user_id   uuid references public.profiles(id) on delete set null,
  site_label      text,
  status          text not null default 'open'
                    check (status in ('open','completed','dismissed')),
  evidence_id     text,
  source          text not null default 'tenant' check (source in ('system','tenant')),
  system_key      text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (cadence <> 'custom_days' or cadence_days is not null)
);

-- One system-seeded obligation per (tenant, system_key) — drives the idempotent
-- upsert. Kept NON-partial so it can serve as the ON CONFLICT arbiter; NULL
-- system_keys (tenant-created rows) are distinct under a unique index, so a
-- tenant may have many of them.
create unique index if not exists uq_compliance_oblig_system
  on public.compliance_obligations(tenant_id, system_key);

-- Hot path: "what's open and due" per tenant.
create index if not exists idx_compliance_oblig_due
  on public.compliance_obligations(tenant_id, next_due_at)
  where status = 'open';

create table if not exists public.obligation_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  obligation_id uuid not null references public.compliance_obligations(id) on delete cascade,
  occurrence_at date not null,
  completed_at  timestamptz not null default now(),
  completed_by  uuid references public.profiles(id) on delete set null,
  evidence_id   text,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_obligation_events_oblig
  on public.obligation_events(tenant_id, obligation_id, completed_at desc);

alter table public.compliance_obligations enable row level security;
alter table public.obligation_events      enable row level security;

drop policy if exists compliance_obligations_tenant_scope on public.compliance_obligations;
create policy compliance_obligations_tenant_scope on public.compliance_obligations
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists obligation_events_tenant_scope on public.obligation_events;
create policy obligation_events_tenant_scope on public.obligation_events
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop trigger if exists trg_audit_compliance_obligations on public.compliance_obligations;
create trigger trg_audit_compliance_obligations
  after insert or update or delete on public.compliance_obligations
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
