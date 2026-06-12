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

commit;
