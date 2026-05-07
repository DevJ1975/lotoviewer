-- Migration 058: release_notes — superadmin-published change announcements.
--
-- Use case: when a meaningful feature ships (a new module, a UX
-- change, a breaking-but-handled migration), the superadmin writes
-- a short note. The next time a tenant admin signs in, a banner
-- surfaces the unread note inline. Once they dismiss it, the
-- "seen" stamp lives in localStorage (no server-side per-user
-- read-state to manage at this scale — tenants don't span devices
-- enough to make that worth a table).
--
-- Notes are global (not tenant-scoped). Authors are superadmins;
-- consumers are every authenticated user. RLS reflects that:
-- everyone authenticated reads published notes; only superadmins
-- write.

begin;

create table if not exists public.release_notes (
  id            bigserial primary key,
  -- Free-form version label. Examples: 'v0.42', '2026-05-08',
  -- 'risk-module-v1'. Surfaced in the banner header.
  version       text not null,
  -- Short headline shown on the banner card.
  title         text not null,
  -- Body in markdown. The renderer is intentionally tiny — only
  -- handles paragraphs, lists, links, and bold; no embedded HTML
  -- to keep the XSS surface zero. See lib/markdown.ts.
  body_md       text not null,
  -- NULL = draft (visible only on /superadmin/release-notes).
  -- Non-NULL = published; surfaces to tenant users.
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null
);

create index if not exists idx_release_notes_published_at
  on public.release_notes(published_at desc)
  where published_at is not null;

comment on table public.release_notes is
  'Superadmin-authored changelog entries. Banner on /loto + tenant home pages surfaces the latest published note until the user dismisses it (localStorage seen-stamp).';

-- ──────────────────────────────────────────────────────────────────────────
-- RLS — anyone authenticated reads PUBLISHED notes; superadmin reads
-- everything (including drafts) + writes. Service-role bypasses RLS.
-- ──────────────────────────────────────────────────────────────────────────
alter table public.release_notes enable row level security;

drop policy if exists "release_notes_published_read" on public.release_notes;
create policy "release_notes_published_read" on public.release_notes
  for select to authenticated
  using (published_at is not null);

drop policy if exists "release_notes_superadmin_all" on public.release_notes;
create policy "release_notes_superadmin_all" on public.release_notes
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
