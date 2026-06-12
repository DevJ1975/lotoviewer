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

-- ────────────────────────────────────────────────────────────────────
-- 3. ai_invocation_token_totals() — per-model token sums for a window.
-- ────────────────────────────────────────────────────────────────────
-- checkTenantBudget (lib/ai/rateLimit.ts) summed today's spend by fetching
-- EVERY successful ai_invocations row for the tenant and reducing in JS —
-- on a busy audit day that is thousands of rows over the wire on every AI
-- call. costForInvocation is linear in each token bucket for a given model,
-- so summing tokens per model in the DB and pricing the (handful of) model
-- groups in JS yields an identical total. This returns those per-model
-- sums; the pricing math stays in usageAggregator (single source of truth).

create or replace function public.ai_invocation_token_totals(
  p_tenant uuid,
  p_since  timestamptz
)
returns table (
  model              text,
  input_tokens       bigint,
  output_tokens      bigint,
  cache_read_tokens  bigint,
  cache_write_tokens bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select
    model,
    coalesce(sum(input_tokens),       0)::bigint as input_tokens,
    coalesce(sum(output_tokens),      0)::bigint as output_tokens,
    coalesce(sum(cache_read_tokens),  0)::bigint as cache_read_tokens,
    coalesce(sum(cache_write_tokens), 0)::bigint as cache_write_tokens
  from public.ai_invocations
  where tenant_id = p_tenant
    and status = 'success'
    and occurred_at >= p_since
  group by model;
$$;

revoke all on function public.ai_invocation_token_totals(uuid, timestamptz) from public;
revoke all on function public.ai_invocation_token_totals(uuid, timestamptz) from anon;
revoke all on function public.ai_invocation_token_totals(uuid, timestamptz) from authenticated;
grant execute on function public.ai_invocation_token_totals(uuid, timestamptz) to service_role;

-- ────────────────────────────────────────────────────────────────────
-- 4. get_tenant_health() — one-row-per-tenant superadmin health glance.
-- ────────────────────────────────────────────────────────────────────
-- The superadmin tenant-health route fired eight whole-table fetches and
-- tallied in JS, including pulling up to 50k audit_log rows just to derive
-- the most-recent activity per tenant. PostgREST can't GROUP BY, but a
-- function can: this returns each tenant's identity plus its counts and
-- true last-activity in one pass. max(created_at) over the full audit_log
-- (served by idx_audit_log_tenant_time) is also MORE accurate than the old
-- 50k-row window, which silently showed null for tenants whose last event
-- fell outside the most recent 50k rows globally.

create or replace function public.get_tenant_health(p_since timestamptz)
returns table (
  tenant_id          uuid,
  tenant_number      text,
  name               text,
  status             text,
  is_demo            boolean,
  member_count       bigint,
  equipment_count    bigint,
  active_permits     bigint,
  worker_count       bigint,
  open_tickets       bigint,
  ai_invocations_30d bigint,
  last_activity_at   timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select
    t.id,
    t.tenant_number,
    t.name,
    t.status,
    t.is_demo,
    coalesce(m.c,  0) as member_count,
    coalesce(e.c,  0) as equipment_count,
    coalesce(p.c,  0) as active_permits,
    coalesce(w.c,  0) as worker_count,
    coalesce(tk.c, 0) as open_tickets,
    coalesce(ai.c, 0) as ai_invocations_30d,
    al.last_activity_at
  from public.tenants t
  left join (select tenant_id, count(*) c from public.tenant_memberships group by tenant_id) m on m.tenant_id = t.id
  left join (select tenant_id, count(*) c from public.loto_equipment where decommissioned = false group by tenant_id) e on e.tenant_id = t.id
  left join (select tenant_id, count(*) c from public.loto_confined_space_permits where canceled_at is null group by tenant_id) p on p.tenant_id = t.id
  left join (select tenant_id, count(*) c from public.loto_workers where active = true group by tenant_id) w on w.tenant_id = t.id
  left join (select tenant_id, count(*) c from public.support_tickets where resolved_at is null group by tenant_id) tk on tk.tenant_id = t.id
  left join (select tenant_id, count(*) c from public.ai_invocations where occurred_at >= p_since group by tenant_id) ai on ai.tenant_id = t.id
  left join (select tenant_id, max(created_at) last_activity_at from public.audit_log where tenant_id is not null group by tenant_id) al on al.tenant_id = t.id
  order by t.tenant_number;
$$;

revoke all on function public.get_tenant_health(timestamptz) from public;
revoke all on function public.get_tenant_health(timestamptz) from anon;
revoke all on function public.get_tenant_health(timestamptz) from authenticated;
grant execute on function public.get_tenant_health(timestamptz) to service_role;

commit;
