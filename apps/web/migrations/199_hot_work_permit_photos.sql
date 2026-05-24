-- Migration 199: Hot Work permit area-condition photos.
--
-- OSHA 29 CFR 1910.252(a)(2) and NFPA 51B require the permit-authorizing
-- individual to verify the work area is safe before hot work and that a
-- fire watch observes it afterward. The defensible record of that
-- verification is a photo: combustibles cleared to 35 ft, an extinguisher
-- staged, fire blanket/shield in place, sprinklers operational.
--
-- One permit can carry several photos, so this is a child table rather
-- than fixed *_photo_url columns on loto_hot_work_permits — the same shape
-- as bbs_observation_photos (migration 081). `phase` tags each photo as
-- pre-work area prep or post-work fire-watch evidence so the printed
-- permit and audit trail can tell them apart.
--
-- Photos live in the loto-photos bucket under
--   <tenant_uuid>/hot-work/<permit_id>/<ts>.jpg
-- (see packages/core/src/storagePaths.ts -> hotWorkPhotoPath). The
-- tenant-scoped storage RLS from migration 033 already gates writes by
-- the leading tenant-UUID segment, so no storage policy change is needed.
--
-- Conventions mirror migration 081: tenant_id FK + active-tenant RLS,
-- idempotent, FK cascade on permit/tenant delete.

create table if not exists public.loto_hot_work_permit_photos (
  id          uuid not null primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  permit_id   uuid not null references public.loto_hot_work_permits(id) on delete cascade,
  -- Public URL of the stored object. The object key is built by
  -- hotWorkPhotoPath(); we persist the resolved public URL so renderers
  -- and the PDF can embed it without re-deriving the path.
  photo_url   text not null,
  -- pre_work  — area-prep evidence captured before authorizing.
  -- post_work — fire-watch evidence captured after work_completed_at.
  phase       text not null default 'pre_work'
                check (phase in ('pre_work', 'post_work')),
  caption     text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

create index if not exists idx_hot_work_photos_permit
  on public.loto_hot_work_permit_photos(permit_id, created_at);
create index if not exists idx_hot_work_photos_tenant
  on public.loto_hot_work_permit_photos(tenant_id);

comment on table public.loto_hot_work_permit_photos is
  'Area-condition photos for a hot work permit (OSHA 1910.252 / NFPA 51B). Retained with the permit for the OSHA audit trail — never hard-delete a closed permit''s photos.';
comment on column public.loto_hot_work_permit_photos.phase is
  'pre_work = area-prep evidence before authorizing; post_work = fire-watch evidence after work completion.';

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — active-tenant scoped, mirroring bbs_observation_photos (migration 081)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_hot_work_permit_photos enable row level security;

drop policy if exists hot_work_photos_tenant on public.loto_hot_work_permit_photos;
create policy hot_work_photos_tenant on public.loto_hot_work_permit_photos
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

notify pgrst, 'reload schema';
