-- Migration 194: multi-channel notification delivery.
--
-- Per-tenant notification channels (email / SMS / Teams / etc.) and routing
-- rules that map an event_type + minimum severity to a channel. Channels may
-- hold provider credentials in `config`, so RLS restricts BOTH tables to
-- tenant admins (not all members). Credential encryption-at-rest is a planned
-- follow-up (see docs/security/POSTURE.md §10); creds are server-only today.
--
-- Idempotent throughout.

begin;

create table if not exists public.notification_channels (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  type        text not null check (type in ('email','sms','teams','slack','webhook','push')),
  config      jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_notification_channels_tenant
  on public.notification_channels(tenant_id, active);

create table if not exists public.notification_rules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  event_type   text not null,
  min_severity text not null default 'info' check (min_severity in ('info','warning','critical')),
  channel_id   uuid not null references public.notification_channels(id) on delete cascade,
  active       boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_notification_rules_lookup
  on public.notification_rules(tenant_id, event_type)
  where active;

alter table public.notification_channels enable row level security;
alter table public.notification_rules    enable row level security;

-- Admin-only (channels hold secrets; rules are configuration).
do $$
declare t text;
begin
  foreach t in array array['notification_channels','notification_rules']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_scope', t);
    execute format($p$
      create policy %I on public.%I
        for all to authenticated
        using (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
        )
        with check (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
        )
    $p$, t || '_admin_scope', t);
  end loop;
end $$;

drop trigger if exists trg_audit_notification_channels on public.notification_channels;
create trigger trg_audit_notification_channels
  after insert or update or delete on public.notification_channels
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
