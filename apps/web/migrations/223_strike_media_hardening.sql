-- Migration 223: STRIKE media hardening — access audit, watch gate, video read lockdown.
--
-- STRIKE videos are tenant IP. Until now the learner's browser minted its own
-- 30-minute signed URL straight from storage, which meant (a) no record of who
-- fetched which video when, and (b) any learner could hand a colleague a raw,
-- downloadable MP4 link. Playback URLs now come from a server route
-- (/api/strike/[moduleId]/media) that authenticates, rate-limits, logs the
-- issuance here, and signs a much shorter URL.
--
-- Three changes:
--   1. strike_media_access — append-only audit of every playback URL issued.
--      Inserts come from the media route via service role only (no insert
--      policy on purpose, same posture as ai_invocations). Reads are for
--      tenant admins reviewing who watched what, mirroring strike_attempts.
--   2. strike_tenant_settings.require_watch_percent — optional per-tenant
--      knob: learners must report watching at least this % of the video
--      before the quiz submit is accepted. Null disables the gate.
--   3. strike_media_read tightened — learners lose direct video reads (the
--      server route signs video URLs with the service role, which bypasses
--      RLS); captions and thumbnails stay member-readable so library UI can
--      keep rendering them cheaply.

begin;

create table if not exists public.strike_media_access (
  id                 uuid not null primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  module_id          uuid references public.strike_modules(id) on delete set null,
  module_version_id  uuid references public.strike_module_versions(id) on delete set null,
  -- 'storage' = Supabase signed URL; 'cloudflare' = Stream playback token.
  provider           text not null check (provider in ('storage', 'cloudflare')),
  media_kind         text not null default 'video' check (media_kind in ('video', 'captions', 'thumbnail')),
  -- Storage object path or provider video id — whatever the token grants.
  object_ref         text not null,
  token_ttl_seconds  int not null check (token_ttl_seconds > 0),
  issued_at          timestamptz not null default now(),
  client_context     jsonb not null default '{}'::jsonb
);

create index if not exists idx_strike_media_access_user
  on public.strike_media_access (tenant_id, user_id, issued_at desc);

alter table public.strike_media_access enable row level security;

drop policy if exists strike_media_access_read on public.strike_media_access;
create policy strike_media_access_read on public.strike_media_access
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );

alter table public.strike_tenant_settings
  add column if not exists require_watch_percent int
    check (require_watch_percent is null or require_watch_percent between 0 and 100);

-- Learner video reads move behind the server route. Direct storage reads of
-- video extensions now require tenant-admin (authoring/preview) or superadmin;
-- non-video assets (captions, thumbnails) keep the original member-read rules.
drop policy if exists strike_media_read on storage.objects;
create policy strike_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'strike-media'
    and case
      when split_part(name, '/', 1) = 'global' then
        case
          when lower(substring(name from '\.([^./]+)$')) in ('mp4', 'm4v', 'mov', 'webm')
            then public.is_superadmin()
          else true
        end
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        case
          when lower(substring(name from '\.([^./]+)$')) in ('mp4', 'm4v', 'mov', 'webm')
            then (split_part(name, '/', 1))::uuid in (select public.current_user_admin_tenant_ids())
              or public.is_superadmin()
          else (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids())
            or public.is_superadmin()
        end
      else false
    end
  );

notify pgrst, 'reload schema';

commit;
