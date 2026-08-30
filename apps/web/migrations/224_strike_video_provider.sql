-- Migration 224: STRIKE video provider columns — Cloudflare Stream delivery.
--
-- Raw MP4s served from Supabase Storage are downloadable and don't adapt to
-- field-network bandwidth. Delivery moves to Cloudflare Stream: tokenized,
-- expiring HLS with `requireSignedURLs` and downloads disabled. Supabase
-- Storage remains the master archive — video_path keeps pointing at the
-- original upload, so the tenant always owns the source file even if the
-- streaming provider changes.
--
--   video_provider     'storage' (legacy direct playback, still supported)
--                      or 'cloudflare' (Stream HLS via signed token).
--   video_external_id  Cloudflare Stream video UID (32 hex chars).
--   video_ready        Stream finished transcoding; playable.
--   video_meta         provider-reported details (size, dims, state).
--
-- The check constraint makes "cloudflare without a UID" unrepresentable at
-- the database layer; packages/core/src/strikeMedia.ts enforces the same
-- shape for application code.

begin;

alter table public.strike_module_versions
  add column if not exists video_provider text not null default 'storage'
    check (video_provider in ('storage', 'cloudflare')),
  add column if not exists video_external_id text,
  add column if not exists video_ready boolean not null default false,
  add column if not exists video_meta jsonb not null default '{}'::jsonb;

alter table public.strike_module_versions
  drop constraint if exists strike_versions_provider_ck;
alter table public.strike_module_versions
  add constraint strike_versions_provider_ck check (
    video_provider = 'storage'
    or (video_provider = 'cloudflare' and video_external_id is not null)
  );

notify pgrst, 'reload schema';

commit;
