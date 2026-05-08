-- 077_safety_boards_tier1.sql
-- Tier 1 upgrade to /safety-boards: turn the generic forum into a
-- safety-specific tool that connects discussion to work.
--
-- Adds (per the evaluation):
--   1. Thread kinds — hazard_report | near_miss_reflection |
--      lesson_learned | alert | question | discussion. Drives icons,
--      default ordering, and per-kind metadata.
--   2. Linked entity — polymorphic (linked_entity_type, linked_entity_id)
--      so a thread can attach to an incident, equipment, permit,
--      near-miss, or action item. Reverse-render on the entity page.
--   3. Acknowledgement opt-in — admin marks a thread "requires
--      acknowledgement"; tenant members must ack; auditable trail.
--   4. Attachments on threads and replies — polymorphic over target
--      type, stored in a private bucket scoped by tenant prefix.
--   5. Source-thread tracking on incident_actions — one-click
--      "create CAPA from thread" stores a back-reference so the
--      action page can show "↶ from thread" and the thread page can
--      show "✅ resolved by action #N."

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- safety_board_threads — additive columns
-- ────────────────────────────────────────────────────────────────────────────
alter table public.safety_board_threads
  add column if not exists kind text not null default 'discussion'
    check (kind in (
      'hazard_report','near_miss_reflection','lesson_learned',
      'alert','question','discussion'
    )),
  -- Type-specific structured fields (severity, location, equipment_id,
  -- etc.). Keys validated at the API layer per kind. Stays jsonb so a
  -- new kind doesn't require a migration.
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  -- Polymorphic link. type checked at the API layer; we don't add an
  -- FK because target_id points across multiple tables. Soft-link
  -- so the thread survives if the target is deleted.
  add column if not exists linked_entity_type text
    check (linked_entity_type is null or linked_entity_type in (
      'incident','near_miss','equipment','hot_work_permit','confined_space',
      'incident_action','jha','toolbox_talk'
    )),
  add column if not exists linked_entity_id uuid,
  -- Admin-set: members must acknowledge before the in-app banner clears.
  add column if not exists acknowledgement_required boolean not null default false;

create index if not exists idx_safety_threads_kind
  on public.safety_board_threads(tenant_id, kind, last_reply_at desc)
  where deleted_at is null;

create index if not exists idx_safety_threads_linked_entity
  on public.safety_board_threads(linked_entity_type, linked_entity_id)
  where linked_entity_type is not null and deleted_at is null;

create index if not exists idx_safety_threads_ack_required
  on public.safety_board_threads(tenant_id, acknowledgement_required)
  where acknowledgement_required = true and deleted_at is null;

-- ────────────────────────────────────────────────────────────────────────────
-- incident_actions — source thread back-reference
-- ────────────────────────────────────────────────────────────────────────────
alter table public.incident_actions
  add column if not exists source_thread_id uuid
    references public.safety_board_threads(id) on delete set null;

create index if not exists idx_incident_actions_source_thread
  on public.incident_actions(source_thread_id)
  where source_thread_id is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- safety_board_acknowledgements — proof-of-notification
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.safety_board_acknowledgements (
  thread_id   uuid not null references public.safety_board_threads(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  -- Optional free-text response (e.g. "trained crew on procedure").
  comment     text,
  -- Snapshot of the thread title at ack time so an audit report
  -- still makes sense if the title is later edited.
  thread_title_at_ack text not null,
  primary key (thread_id, user_id)
);

create index if not exists idx_safety_acks_thread
  on public.safety_board_acknowledgements(thread_id, acknowledged_at);
create index if not exists idx_safety_acks_user
  on public.safety_board_acknowledgements(user_id, tenant_id, acknowledged_at desc);

alter table public.safety_board_acknowledgements enable row level security;

drop policy if exists safety_acks_tenant_scope on public.safety_board_acknowledgements;
create policy safety_acks_tenant_scope on public.safety_board_acknowledgements
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- safety_board_attachments — polymorphic over thread/reply
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.safety_board_attachments (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  -- 'thread' or 'reply'. Set at upload time once the parent exists;
  -- nullable on first insert because the upload route returns an
  -- attachment id before the post is created (same lifecycle as
  -- chat_message_attachments — see migration 073).
  target_type     text check (target_type in ('thread','reply')),
  target_id       uuid,
  uploaded_by     uuid not null references auth.users(id),
  storage_path    text not null,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 25_000_000),
  width           int,
  height          int,
  filename        text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_safety_attachments_target
  on public.safety_board_attachments(target_type, target_id)
  where target_type is not null and target_id is not null;

create index if not exists idx_safety_attachments_orphans
  on public.safety_board_attachments(uploaded_by, created_at)
  where target_id is null;

alter table public.safety_board_attachments enable row level security;

drop policy if exists safety_attachments_tenant_scope on public.safety_board_attachments;
create policy safety_attachments_tenant_scope on public.safety_board_attachments
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- safety-board-attachments storage bucket (private)
-- Path: safety-board-attachments/{tenant_id}/{thread_or_reply_uuid}/{attachment_uuid}/{filename}
-- ────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('safety-board-attachments', 'safety-board-attachments', false)
on conflict (id) do nothing;

drop policy if exists safety_board_attachments_tenant_scope on storage.objects;
create policy safety_board_attachments_tenant_scope on storage.objects
  for all to authenticated
  using (
    bucket_id = 'safety-board-attachments'
    and (
      (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    bucket_id = 'safety-board-attachments'
    and (
      (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

notify pgrst, 'reload schema';

commit;
