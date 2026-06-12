-- Migration 227: read-path consolidation RPCs (perf PR 2).
--
-- Each function below collapses a per-row N+1 query loop in a hot read path
-- into a single set-based round-trip. Every one is a pure read
-- (language sql, stable), security definer with a pinned search_path, and
-- executable only by service_role — callers invoke it through the
-- service-role admin client (lib/supabaseAdmin.ts), never from the browser.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. chat_unread_counts() — per-channel unread tally for one member.
-- ────────────────────────────────────────────────────────────────────
-- Replaces the 2×N loop in /api/chat/unread and /api/chat/channels: for
-- every channel the caller belongs to, the routes counted (one round-trip
-- at a time) the non-deleted messages authored by someone else after the
-- caller's last-read marker, plus a second round-trip to resolve that
-- marker's timestamp. This does the whole thing in one pass.
--
-- Returns one row per membership with the unread tally and the caller's
-- muted flag, so the badge route can sum only non-muted channels and the
-- channel-list route can map counts by channel_id. Archived channels are
-- intentionally not filtered here — callers already scope their own channel
-- lists — which preserves today's behavior exactly.

create or replace function public.chat_unread_counts(
  p_user   uuid,
  p_tenant uuid
)
returns table (
  channel_id   uuid,
  unread_count integer,
  muted        boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select
    m.channel_id,
    count(msg.id)::int        as unread_count,
    (m.muted_at is not null)  as muted
  from public.chat_channel_members m
  left join public.chat_messages last_read
    on last_read.id = m.last_read_message_id
  left join public.chat_messages msg
    on  msg.channel_id      = m.channel_id
    and msg.tenant_id       = m.tenant_id
    and msg.deleted_at      is null
    and msg.author_user_id <> p_user
    and (last_read.created_at is null or msg.created_at > last_read.created_at)
  where m.user_id   = p_user
    and m.tenant_id = p_tenant
  group by m.channel_id, m.muted_at;
$$;

revoke all on function public.chat_unread_counts(uuid, uuid) from public;
revoke all on function public.chat_unread_counts(uuid, uuid) from anon;
revoke all on function public.chat_unread_counts(uuid, uuid) from authenticated;
grant execute on function public.chat_unread_counts(uuid, uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────
-- 2. get_gate_context() — one-row auth/tenant context for the API gate.
-- ────────────────────────────────────────────────────────────────────
-- The tenant auth gate (lib/auth/tenantGate.ts) needs, per request: the
-- caller's superadmin flag (profiles), their role on the active tenant
-- (tenant_memberships) and — for module-scoped gates — the tenant's
-- name/modules/settings/disabled_at (tenants). The module gate fetched
-- these as two sequential round-trips (membership, then tenant); this
-- returns all of it in one row so the gate makes a single call.
--
-- Always returns exactly one row (left joins off the user parameter), so
-- the caller reads fields without a length check: role is null when the
-- user is not a member of p_tenant, and tenant_exists is false when
-- p_tenant has no tenants row (e.g. a superadmin passing an unknown id).
-- The env-allowlist half of the superadmin check stays in TypeScript — it
-- depends on SUPERADMIN_EMAILS and the auth-server email, not the DB.

create or replace function public.get_gate_context(
  p_user   uuid,
  p_tenant uuid
)
returns table (
  is_superadmin      boolean,
  role               text,
  tenant_exists      boolean,
  tenant_name        text,
  tenant_modules     jsonb,
  tenant_settings    jsonb,
  tenant_disabled_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select
    coalesce(p.is_superadmin, false) as is_superadmin,
    m.role                           as role,
    (t.id is not null)               as tenant_exists,
    t.name                           as tenant_name,
    t.modules                        as tenant_modules,
    t.settings                       as tenant_settings,
    t.disabled_at                    as tenant_disabled_at
  from (select p_user as uid) base
  left join public.profiles p           on p.id = base.uid
  left join public.tenant_memberships m on m.user_id = base.uid and m.tenant_id = p_tenant
  left join public.tenants t            on t.id = p_tenant;
$$;

revoke all on function public.get_gate_context(uuid, uuid) from public;
revoke all on function public.get_gate_context(uuid, uuid) from anon;
revoke all on function public.get_gate_context(uuid, uuid) from authenticated;
grant execute on function public.get_gate_context(uuid, uuid) to service_role;

commit;
