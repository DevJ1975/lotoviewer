-- Migration 080: module_manuals — platform-wide user manuals wiki.
--
-- One canonical manual per top-level feature module
-- (LOTO, Risk, Incidents, etc.), edited by superadmins, read by every
-- authenticated user. Mirrors release_notes (migration 058) for the
-- access posture: published rows visible to all authenticated users,
-- drafts visible only to superadmins.
--
-- Versioning: each PATCH archives the prior body into manual_versions
-- via a BEFORE-UPDATE trigger. The row's own `version` column bumps
-- on every body / title / summary change. Powers the per-manual
-- changelog + the master rollup + the diff view.
--
-- Search: a generated tsvector column on manuals + GIN index. The
-- /api/manuals/search route uses websearch_to_tsquery (same shape as
-- /api/safety-boards/search introduced in migration 078).
--
-- Storage: a public-read `module-manuals` bucket for inline
-- screenshots and embedded media. Path convention:
--   module-manuals/{module_id}/{uuid}.{ext}
--   module-manuals/_master/{uuid}.{ext}      (cross-module assets)
-- Writes restricted to superadmins via storage RLS.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- manuals — one row per module
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.manuals (
  id              uuid not null primary key default gen_random_uuid(),
  -- Slug matching packages/core/src/features.ts top-level ids
  -- (e.g. 'loto', 'risk-assessment', 'safety-boards'). Unique so the
  -- /manuals/[moduleId] route can resolve directly.
  module_id       text not null unique
                    check (module_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title           text not null check (length(trim(title)) between 1 and 200),
  -- One-line index blurb; surfaced on the /manuals tile.
  summary         text,
  body_md         text not null default '',
  -- Generated FTS column for /api/manuals/search.
  body_tsv        tsvector
                    generated always as (
                      setweight(to_tsvector('english', coalesce(title,   '')), 'A')
                      || setweight(to_tsvector('english', coalesce(summary, '')), 'B')
                      || setweight(to_tsvector('english', coalesce(body_md, '')), 'C')
                    ) stored,
  -- NULL = draft, only superadmins can see it. Non-NULL = published,
  -- visible to every authenticated user.
  published_at    timestamptz,
  -- Bumped on every body / title / summary change. The trigger below
  -- writes the OLD row to manual_versions before the bump.
  version         int not null default 1 check (version >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  updated_by      uuid references public.profiles(id) on delete set null
);

create index if not exists idx_manuals_published_at
  on public.manuals(published_at desc)
  where published_at is not null;

create index if not exists idx_manuals_fts
  on public.manuals using gin (body_tsv);

create index if not exists idx_manuals_updated_at
  on public.manuals(updated_at desc);

comment on table public.manuals is
  'Platform-wide user manuals wiki. One row per top-level module from features.ts. Edited by superadmins; published rows visible to every authenticated user.';

-- ────────────────────────────────────────────────────────────────────────────
-- manual_versions — full snapshots for changelog + diff
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.manual_versions (
  id            uuid not null primary key default gen_random_uuid(),
  manual_id     uuid not null references public.manuals(id) on delete cascade,
  -- The version number this snapshot represents (the manual.version
  -- value AT THE TIME the snapshot was taken — i.e. the OLD version
  -- before the new save bumped it).
  version       int  not null check (version >= 1),
  title         text not null,
  summary       text,
  body_md       text not null,
  -- Optional change_note supplied by the editor on save. The diff
  -- view shows this above the diff like a Wikipedia edit summary.
  change_note   text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null,
  unique (manual_id, version)
);

create index if not exists idx_manual_versions_manual
  on public.manual_versions(manual_id, version desc);

create index if not exists idx_manual_versions_created_at
  on public.manual_versions(created_at desc);

comment on table public.manual_versions is
  'Snapshot history for manuals. Written automatically by the manual_archive_before_update trigger whenever body_md / title / summary changes.';

-- ────────────────────────────────────────────────────────────────────────────
-- Trigger: archive the prior version before an UPDATE that changes
-- the body, title, or summary. The current edit's change_note rides
-- in via a session-local GUC (`app.manual_change_note`) so callers
-- can attach it without altering the row's columns. The route layer
-- sets it via SET LOCAL inside the same transaction; its absence is
-- benign (defaults to NULL).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.archive_manual_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change_note text;
begin
  -- Only archive when the textual content actually changes. A
  -- publish-toggle (published_at) without a body change does not
  -- bump the version — that's a state change, not a content change.
  if NEW.body_md   is distinct from OLD.body_md
     or NEW.title  is distinct from OLD.title
     or NEW.summary is distinct from OLD.summary then

    -- Pull the optional note set by the API route via SET LOCAL.
    -- current_setting(..., true) returns NULL if the GUC isn't set,
    -- which is exactly what we want.
    begin
      v_change_note := nullif(trim(current_setting('app.manual_change_note', true)), '');
    exception when others then
      v_change_note := null;
    end;

    insert into public.manual_versions
      (manual_id, version, title, summary, body_md, change_note, created_by)
    values
      (OLD.id, OLD.version, OLD.title, OLD.summary, OLD.body_md, v_change_note, NEW.updated_by);

    NEW.version := OLD.version + 1;
  end if;

  NEW.updated_at := now();
  return NEW;
end
$$;

drop trigger if exists trg_manual_archive_before_update on public.manuals;
create trigger trg_manual_archive_before_update
  before update on public.manuals
  for each row execute function public.archive_manual_version();

-- ────────────────────────────────────────────────────────────────────────────
-- update_manual() — RPC that performs an UPDATE inside a single
-- transaction with SET LOCAL app.manual_change_note. The route layer
-- (gated by requireSuperadmin) is the only legitimate caller. The
-- RPC bundles the GUC set + UPDATE atomically — Supabase connection
-- pooling means a separate set_config() call wouldn't reliably land
-- on the same connection as the subsequent UPDATE.
--
-- Authorisation: the route is the trust boundary. This function is
-- invoked by the service-role client, which bypasses RLS.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.update_manual(
  p_module_id        text,
  p_title            text         default null,
  p_summary          text         default null,
  p_summary_set      boolean      default false,
  p_body_md          text         default null,
  p_published_at     timestamptz  default null,
  p_clear_published  boolean      default false,
  p_updated_by       uuid         default null,
  p_change_note      text         default null
) returns public.manuals
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.manuals;
begin
  if p_change_note is not null then
    perform set_config('app.manual_change_note', p_change_note, true);
  end if;

  update public.manuals m set
    title        = coalesce(p_title,   m.title),
    summary      = case when p_summary_set then p_summary else m.summary end,
    body_md      = coalesce(p_body_md, m.body_md),
    published_at = case
      when p_clear_published        then null
      when p_published_at is not null then p_published_at
      else m.published_at
    end,
    updated_by   = coalesce(p_updated_by, m.updated_by)
   where m.module_id = p_module_id
   returning m.* into result;

  if not found then
    raise exception 'manual % not found', p_module_id;
  end if;
  return result;
end;
$$;

revoke all on function public.update_manual(text, text, text, boolean, text, timestamptz, boolean, uuid, text) from public;

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — published manuals visible to every authenticated user;
-- drafts + writes restricted to superadmins. Mirrors
-- release_notes_published_read / release_notes_superadmin_all.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.manuals          enable row level security;
alter table public.manual_versions  enable row level security;

drop policy if exists manuals_published_read    on public.manuals;
drop policy if exists manuals_superadmin_all    on public.manuals;
drop policy if exists manual_versions_read      on public.manual_versions;
drop policy if exists manual_versions_super_all on public.manual_versions;

create policy manuals_published_read on public.manuals
  for select to authenticated
  using (published_at is not null);

create policy manuals_superadmin_all on public.manuals
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- Versions follow the parent's visibility: a version is readable if
-- the parent manual is published, OR the caller is a superadmin.
create policy manual_versions_read on public.manual_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.manuals m
       where m.id = manual_versions.manual_id
         and m.published_at is not null
    )
  );

create policy manual_versions_super_all on public.manual_versions
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- ────────────────────────────────────────────────────────────────────────────
-- module-manuals storage bucket — public-read, superadmin-write.
-- ────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('module-manuals', 'module-manuals', true)
on conflict (id) do nothing;

drop policy if exists module_manuals_public_read    on storage.objects;
drop policy if exists module_manuals_superadmin_write on storage.objects;

create policy module_manuals_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'module-manuals');

create policy module_manuals_superadmin_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'module-manuals'
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.is_superadmin = true
    )
  )
  with check (
    bucket_id = 'module-manuals'
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.is_superadmin = true
    )
  );

notify pgrst, 'reload schema';

commit;
