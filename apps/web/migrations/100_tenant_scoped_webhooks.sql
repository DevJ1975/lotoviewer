-- Migration 093: tenant-scoped webhook subscriptions (Phase G slice 8).
--
-- The loto_webhook_subscriptions table from migration 013 is global —
-- every active subscription receives every matching event regardless
-- of which tenant generated it. That was fine when the only events
-- were CS/hot-work permits in single-tenant mode. With chemicals
-- events flowing for every tenant, subscribers must filter on
-- payload.data.tenant_id client-side, which is awkward and error-prone.
--
-- This migration adds:
--
--   1. A nullable `tenant_id` column on loto_webhook_subscriptions.
--      NULL = global subscription (superadmin-managed; receives every
--      tenant's events). Non-NULL = scoped to that tenant.
--
--   2. fire_webhooks() routing: a subscription receives an event when
--      (subscription.tenant_id IS NULL) OR
--      (subscription.tenant_id = (payload->>'tenant_id')::uuid).
--      Payloads without a tenant_id (legacy CS/hot-work events that
--      don't include it explicitly — they DO via to_jsonb(NEW), so this
--      is mostly defensive) only hit global subscriptions.
--
--   3. RLS update so tenant owner/admin members can list + manage
--      their own scoped subscriptions; superadmins continue to manage
--      both global and scoped.
--
-- Idempotent.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Add tenant_id column (nullable; existing rows stay global).
-- ──────────────────────────────────────────────────────────────────────────

alter table public.loto_webhook_subscriptions
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

create index if not exists idx_webhooks_tenant
  on public.loto_webhook_subscriptions(tenant_id)
  where tenant_id is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Update fire_webhooks() to route by tenant.
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.fire_webhooks(event_type text, payload jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = public, net
as $$
declare
  hook            record;
  body            jsonb;
  hdrs            jsonb;
  payload_tenant  uuid;
begin
  -- Soft-fail when pg_net isn't installed.
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  -- Extract tenant_id from the payload if present + parseable. NULL
  -- here means the event is tenant-agnostic and only reaches global
  -- subscriptions.
  begin
    payload_tenant := (payload->>'tenant_id')::uuid;
  exception when others then
    payload_tenant := null;
  end;

  body := jsonb_build_object(
    'event',       event_type,
    'occurred_at', now(),
    'data',        payload
  );

  for hook in
    select id, name, url, secret
      from public.loto_webhook_subscriptions
     where active = true
       and events @> array[event_type]
       and (
         tenant_id is null
         or (payload_tenant is not null and tenant_id = payload_tenant)
       )
  loop
    hdrs := jsonb_build_object(
      'Content-Type',          'application/json',
      'X-Soteria-Event',       event_type,
      'X-Soteria-Subscription', hook.id::text
    );

    -- Add HMAC signature when the subscription has a secret AND
    -- pgcrypto is available. The header lets the receiver verify
    -- the request really came from us.
    if hook.secret is not null and exists (select 1 from pg_extension where extname = 'pgcrypto') then
      hdrs := hdrs || jsonb_build_object(
        'X-Soteria-Signature',
        'sha256=' || encode(extensions.hmac(body::text, hook.secret, 'sha256'), 'hex')
      );
    end if;

    perform net.http_post(
      url     := hook.url,
      body    := body,
      headers := hdrs
    );
  end loop;
end $$;

comment on function public.fire_webhooks(text, jsonb) is
  'Fan out an event to every active subscription that includes event_type in its events[] array AND whose tenant_id is null or matches payload.tenant_id. No-op if pg_net is not enabled.';

-- ──────────────────────────────────────────────────────────────────────────
-- 3. RLS — tenant members manage their own scoped subscriptions.
-- ──────────────────────────────────────────────────────────────────────────
--
-- The original migration-013 policy granted full access to ANY
-- profile with is_admin=true. That worked for a single-tenant world
-- but means a tenant A admin can today read tenant B's subscriptions.
-- We tighten the policy to require either:
--   - tenant_id IS NULL (global) AND caller is a superadmin
--   - tenant_id IS NOT NULL AND caller is owner/admin of that tenant
--   - the legacy is_admin=true path is dropped — superadmin replaces it.

drop policy if exists "loto_webhook_subscriptions_admin_only" on public.loto_webhook_subscriptions;
drop policy if exists "loto_webhook_subscriptions_tenant"     on public.loto_webhook_subscriptions;

create policy "loto_webhook_subscriptions_tenant" on public.loto_webhook_subscriptions
  for all to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id is not null
      and tenant_id in (select public.current_user_tenant_ids())
      and exists (
        select 1 from public.tenant_memberships m
         where m.user_id = auth.uid()
           and m.tenant_id = loto_webhook_subscriptions.tenant_id
           and m.role in ('owner', 'admin')
      )
    )
  )
  with check (
    public.is_superadmin()
    or (
      tenant_id is not null
      and tenant_id in (select public.current_user_tenant_ids())
      and exists (
        select 1 from public.tenant_memberships m
         where m.user_id = auth.uid()
           and m.tenant_id = loto_webhook_subscriptions.tenant_id
           and m.role in ('owner', 'admin')
      )
    )
  );

notify pgrst, 'reload schema';

commit;
