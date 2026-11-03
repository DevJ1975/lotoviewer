-- Migration 306: move two secrets out of tables that every logged-in user can read.
--
-- The browser talks to PostgREST directly with the public anon key, so a secret
-- stored in a column the browser can SELECT is a secret the browser can read.
-- Column-level REVOKE does not fix this: while table-wide SELECT is granted a
-- column revoke does nothing, and moving to column grants would break every
-- `select('*')` caller. The reliable fix is a table nobody but the service role
-- can read.
--
-- 1. loto_org_config.push_dispatch_secret (018). The row is readable by any
--    authenticated user (014: `using (auth.uid() is not null)`) because
--    work_order_url_template is read by every permit page. The secret is the
--    same value as INTERNAL_PUSH_SECRET, which authenticates /api/push/dispatch
--    and every /api/cron/* route, so any member of any tenant could run
--    cross-tenant jobs and broadcast pushes. It moves to loto_org_secrets;
--    emit_push() reads it from there. The platform configuration page now sets
--    it through set_push_dispatch_secret() and learns only whether one exists.
--
-- 2. tenants.settings.anthropic_api_key (a tenant's own Anthropic key). The
--    tenants row is readable by every member of that tenant, viewers included,
--    and TenantProvider selects it into every member's browser. It moves to
--    tenant_secrets; getTenantApiKey() reads it there with the admin client,
--    and the superadmin PATCH route writes it there.
--
-- Both tables enable RLS with no policies and revoke all client privileges, so
-- only the service role (and SECURITY DEFINER functions owned by postgres) can
-- touch them.
--
-- DEPLOY WITH THE MATCHING APP RELEASE. This drops loto_org_config.
-- push_dispatch_secret and strips the key out of tenants.settings. Between
-- applying this and deploying the code: a tenant with its own key falls back to
-- the platform key (getTenantApiKey also falls back to the legacy settings key,
-- so the reverse order is safe), and the old configuration page cannot save the
-- push secret.
--
-- The secrets exposed before this migration must be treated as compromised:
-- rotate INTERNAL_PUSH_SECRET and every tenant Anthropic key after applying it.
--
-- Idempotent.

begin;

-- ── 1. Push dispatch secret ─────────────────────────────────────────────────

create table if not exists public.loto_org_secrets (
  id                   int primary key default 1 check (id = 1),
  push_dispatch_secret text,
  updated_at           timestamptz not null default now(),
  updated_by           uuid
);

alter table public.loto_org_secrets enable row level security;
revoke all on public.loto_org_secrets from anon, authenticated;

comment on table public.loto_org_secrets is
  'Singleton holder for org-level secrets. RLS on, no policies, no client grants: service role and SECURITY DEFINER functions only.';

-- The column is gone on a re-run, so copy only while it exists. Plpgsql plans
-- each statement on first execution, so the unreached branch is never parsed.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'loto_org_config'
       and column_name  = 'push_dispatch_secret'
  ) then
    insert into public.loto_org_secrets (id, push_dispatch_secret)
      select 1, nullif(btrim(push_dispatch_secret), '')
        from public.loto_org_config
       where id = 1
         and nullif(btrim(push_dispatch_secret), '') is not null
      on conflict (id) do update
        set push_dispatch_secret = excluded.push_dispatch_secret;
  end if;
end $$;

alter table public.loto_org_config drop column if exists push_dispatch_secret;

create or replace function public.emit_push(payload jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = public, net
as $$
declare
  v_url    text;
  v_secret text;
begin
  -- pg_net is the only mechanism for outbound HTTP from Postgres. If
  -- it isn't installed (some self-hosted Supabase variants), we no-op
  -- rather than blocking the parent INSERT/UPDATE.
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  select c.push_dispatch_url, s.push_dispatch_secret
    into v_url, v_secret
    from public.loto_org_config c
    left join public.loto_org_secrets s on s.id = c.id
   where c.id = 1;

  -- Both URL and secret must be set for the dispatch to fire. Either
  -- being null means the operator hasn't finished configuring auto-
  -- push yet — we silently skip rather than failing the parent action.
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',       'application/json',
      'X-Internal-Secret',  v_secret
    ),
    body    := payload
  );
end $$;

-- The platform configuration page can no longer read the secret, so it sets it
-- and asks whether one exists through these two functions. Both check the same
-- platform-admin flag the page and loto_org_config_admin_write already use.
create or replace function public.set_push_dispatch_secret(p_secret text)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  then
    raise exception 'Platform admins only' using errcode = 'insufficient_privilege';
  end if;

  insert into public.loto_org_secrets (id, push_dispatch_secret, updated_by)
    values (1, nullif(btrim(p_secret), ''), auth.uid())
    on conflict (id) do update
      set push_dispatch_secret = excluded.push_dispatch_secret,
          updated_at           = now(),
          updated_by           = auth.uid();
end $$;

create or replace function public.push_dispatch_secret_configured()
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  then
    raise exception 'Platform admins only' using errcode = 'insufficient_privilege';
  end if;

  return exists (
    select 1 from public.loto_org_secrets
     where id = 1 and push_dispatch_secret is not null
  );
end $$;

revoke all on function public.set_push_dispatch_secret(text)    from public, anon;
revoke all on function public.push_dispatch_secret_configured() from public, anon;
grant execute on function public.set_push_dispatch_secret(text)    to authenticated;
grant execute on function public.push_dispatch_secret_configured() to authenticated;

-- ── 2. Per-tenant Anthropic API key ─────────────────────────────────────────

create table if not exists public.tenant_secrets (
  tenant_id         uuid primary key references public.tenants(id) on delete cascade,
  anthropic_api_key text,
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);

alter table public.tenant_secrets enable row level security;
revoke all on public.tenant_secrets from anon, authenticated;

comment on table public.tenant_secrets is
  'Per-tenant secrets. RLS on, no policies, no client grants: service role only. Read by lib/ai/getTenantApiKey.ts.';

-- A whitespace-only key meant "no override" before, so it is not copied. A
-- malformed non-empty key is copied as-is so getTenantApiKey keeps failing fast
-- for that tenant instead of silently switching it to the platform key.
insert into public.tenant_secrets (tenant_id, anthropic_api_key)
  select id, btrim(settings ->> 'anthropic_api_key')
    from public.tenants
   where btrim(coalesce(settings ->> 'anthropic_api_key', '')) <> ''
  on conflict (tenant_id) do update
    set anthropic_api_key = excluded.anthropic_api_key;

update public.tenants
   set settings = settings - 'anthropic_api_key'
 where settings ? 'anthropic_api_key';

commit;
