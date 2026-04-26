-- Migration 016: Web Push subscriptions for browser / iPad PWA notifications.
--
-- Why: a permit expiring in 30 min or an atmospheric reading that just
-- failed should reach a supervisor even if the app isn't open. iOS
-- 16.4+ ships Web Push for installed PWAs; Chrome / Edge / Firefox have
-- supported it for years. This table stores the per-device subscription
-- handles produced by serviceWorker.pushManager.subscribe so we can
-- send notifications server-side via the web-push library.
--
-- Idempotent.

create table if not exists public.loto_push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  -- One row per (device, profile). The same human can have several
  -- entries — one per browser / iPad they enable on. profile FK so we
  -- can scope notifications by user when a workflow needs it.
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  -- The full Web Push endpoint URL produced by the browser. Always
  -- unique — same device + same VAPID key always produces the same
  -- string. Unique index lets the subscribe flow upsert idempotently.
  endpoint    text not null unique,
  -- ECDH public key + auth secret from the subscription's keys field.
  -- Both are url-safe base64 strings; the web-push library wants them
  -- raw and recomposes the encryption envelope itself.
  p256dh      text not null,
  auth        text not null,
  -- Audit-trail fields. user_agent helps a support engineer tell which
  -- device a stale subscription belongs to.
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_push_subs_profile
  on public.loto_push_subscriptions(profile_id);

comment on table public.loto_push_subscriptions is
  'Web Push subscription handles. One row per (device, profile). Created via serviceWorker.pushManager.subscribe; consumed by /api/push/dispatch.';

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — a user manages only their own subscriptions; admins can read all
--       so the admin push-dispatch endpoint can find every device.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_push_subscriptions enable row level security;

drop policy if exists "loto_push_subs_self_or_admin" on public.loto_push_subscriptions;
create policy "loto_push_subs_self_or_admin" on public.loto_push_subscriptions
  for all
  using (
    profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  )
  with check (
    profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );
