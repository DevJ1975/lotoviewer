-- Migration 304: mobile app support — Expo push tokens and in-app account
-- deletion requests.
--
-- 1. expo_push_tokens: one row per (device, user). loto_push_subscriptions
--    holds Web Push handles (endpoint + VAPID keys) and cannot carry an Expo
--    token, so phones get their own table. The server fan-out
--    (lib/notifications/expoPush.ts) reads it; the app writes it through
--    /api/push/expo-token.
--
-- 2. account_deletion_requests: App Store guideline 5.1.1(v) requires that
--    an app with accounts lets the user start deletion from inside the app.
--    Safety records are retained for OSHA recordkeeping, so the request is
--    queued for a tenant admin / support to process rather than deleting
--    the auth user immediately.
--
-- Idempotent.

begin;

create table if not exists public.expo_push_tokens (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  tenant_id     uuid references public.tenants(id) on delete cascade,
  token         text not null unique,
  platform      text not null check (platform in ('ios', 'android')),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists idx_expo_push_tokens_profile
  on public.expo_push_tokens(profile_id);

alter table public.expo_push_tokens enable row level security;

drop policy if exists expo_push_tokens_own on public.expo_push_tokens;
create policy expo_push_tokens_own on public.expo_push_tokens
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

comment on table public.expo_push_tokens is
  'Expo push tokens for the Soteria FIELD mobile app. One row per (device, user). Consumed by lib/notifications/expoPush.ts.';

create table if not exists public.account_deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  email         text not null,
  reason        text,
  status        text not null default 'pending'
                  check (status in ('pending', 'completed', 'rejected')),
  requested_at  timestamptz not null default now(),
  processed_at  timestamptz,
  processed_by  uuid references auth.users(id) on delete set null
);

-- At most one open request per user, so a double-tap or a retry is a no-op.
create unique index if not exists uq_account_deletion_requests_pending
  on public.account_deletion_requests(user_id)
  where status = 'pending';

alter table public.account_deletion_requests enable row level security;

drop policy if exists account_deletion_requests_select_own on public.account_deletion_requests;
create policy account_deletion_requests_select_own on public.account_deletion_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_superadmin());

-- Inserts and status changes go through /api/users/me/deletion-request with
-- the service-role client, so no insert/update policy is granted here.

comment on table public.account_deletion_requests is
  'In-app account deletion requests (App Store 5.1.1(v)). Processed by support within 30 days, per the privacy policy.';

commit;
