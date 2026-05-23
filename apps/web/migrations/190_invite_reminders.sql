-- Migration 190: invite reminder + soft-cancel lifecycle.
--
-- Tracks weekly reminder emails to invitees who were created but have
-- never signed in. A daily cron (/api/cron/invite-reminders) sends up to
-- four weekly reminders; if the invitee still has not signed in roughly a
-- week after the fourth reminder, the cron SOFT-CANCELS the invite.
--
-- Soft-cancel is reversible by design: the tenant_memberships row is
-- RETAINED (an admin can clear invite_cancelled_at to reactivate it) and
-- nothing — neither the membership, the profile, nor the auth user — is
-- ever deleted. The only behavioural effect is that a cancelled invite
-- stops granting tenant access (see the gate-function changes below).
--
-- Idempotent: re-runs are safe (add column if not exists, create index if
-- not exists, create or replace function).

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Reminder/cancellation bookkeeping on the membership row
-- ────────────────────────────────────────────────────────────────────────────
alter table public.tenant_memberships
  add column if not exists invite_reminders_sent  int not null default 0,
  add column if not exists invite_last_reminder_at timestamptz,
  add column if not exists invite_cancelled_at      timestamptz,
  add column if not exists invite_cancelled_reason  text;

-- The cron only scans un-cancelled memberships; a partial index keeps that
-- daily scan cheap as the roster grows.
create index if not exists idx_tenant_memberships_invite_pending
  on public.tenant_memberships(tenant_id)
  where invite_cancelled_at is null;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A soft-cancelled invite must stop granting tenant access
--
-- These two functions are the tenant-access gates used by every domain
-- table's RLS policy. The ONLY change here is an additive
-- `invite_cancelled_at is null` predicate. Existing membership rows have
-- invite_cancelled_at = NULL, so their resolution is byte-for-byte
-- unchanged — no active user can lose access from this migration. The
-- bodies are otherwise reproduced verbatim from migrations 029 and 049.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.tenant_id
    from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid()
     and t.disabled_at is null
     and m.invite_cancelled_at is null
$$;

create or replace function public.current_user_admin_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.tenant_id
    from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid()
     and m.role in ('owner', 'admin')
     and t.disabled_at is null
     and m.invite_cancelled_at is null
$$;
revoke all on function public.current_user_admin_tenant_ids() from public;
grant execute on function public.current_user_admin_tenant_ids() to authenticated;

notify pgrst, 'reload schema';

commit;
