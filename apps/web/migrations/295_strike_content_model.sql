-- Migration 295: STRIKE block content, member-keyed completions, block
-- evidence, and closing browser-forgeable training records.
--
-- 1. Content. `content jsonb` holds the presentation blocks (motion scenes,
--    drag-sort, drag-match, hotspot, scenario, callout). The DB checks only
--    that `content.blocks` is an array — the house idiom (see 145): block
--    schemas evolve faster than migrations should, so the shape is pinned
--    by parseStrikeContent() in packages/core/src/strikeContent.ts. The
--    graded quiz stays in strike_quiz_* so its answer key remains
--    column-revocable (migration 260); a jsonb document can't be half-granted.
--
-- 2. Members. Permit gating keys on the roster (`members`), and contractors
--    on a roster may have no login. Attempts and completions gain
--    `member_id`; `user_id` becomes optional, with one of the two required.
--    Existing rows are backfilled through members.profile_id.
--
-- 3. Evidence. Attempts are now opened when the learner starts, so block
--    events (seen / completed / interaction) bind to an attempt and the
--    submit route can refuse a pass until every required block was reached.
--
-- 4. Forgery. strike_completions_insert (114) let any learner insert a
--    passing completion for themselves straight from the browser, and
--    strike_attempts_update let them set passed = true on their own attempt.
--    Harmless while completions were informational; fatal once a completion
--    unlocks a permit. No browser code writes either table — grading runs in
--    /api/strike/[moduleId]/submit on the service role — so learner write
--    paths are removed. Admins keep insert for manually recorded training.
--
-- Idempotent.

begin;

-- ── 1. Content columns ─────────────────────────────────────────────────

alter table public.strike_module_versions
  add column if not exists content       jsonb,
  add column if not exists validity_days int,
  add column if not exists locale        text not null default 'en',
  add column if not exists download_path text;

alter table public.strike_module_versions drop constraint if exists strike_versions_content_blocks_ck;
alter table public.strike_module_versions
  add constraint strike_versions_content_blocks_ck
    check (content is null or jsonb_typeof(content -> 'blocks') = 'array');

alter table public.strike_module_versions drop constraint if exists strike_versions_validity_days_ck;
alter table public.strike_module_versions
  add constraint strike_versions_validity_days_ck
    check (validity_days is null or validity_days > 0);

comment on column public.strike_module_versions.content is
  'Presentation blocks: {"blocks": [...]}. Shape validated by parseStrikeContent (packages/core/src/strikeContent.ts). The graded quiz lives in strike_quiz_* so the answer key stays column-revoked.';
comment on column public.strike_module_versions.download_path is
  'strike-media path of the rendered MP4 learners may download. Delivery-only: writable after publish, like video_*.';
comment on column public.strike_module_versions.validity_days is
  'Days a passing completion of this version stays current. Null = no expiry.';

-- Extend the freeze (294) to the new content columns. download_path stays
-- writable: it is a rendition of frozen content, rendered after approval.
create or replace function public.strike_guard_frozen_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.strike_version_is_frozen(old.status) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'STRIKE version % is %; archive it instead of deleting', old.id, old.status
      using errcode = 'integrity_constraint_violation';
  end if;

  if not (
       new.status = old.status
       or (old.status = 'published'  and new.status in ('superseded', 'archived'))
       or (old.status = 'superseded' and new.status = 'archived')
     )
  then
    raise exception 'STRIKE version % cannot move from % to %', old.id, old.status, new.status
      using errcode = 'integrity_constraint_violation';
  end if;

  if new.module_id               is distinct from old.module_id
     or new.tenant_id              is distinct from old.tenant_id
     or new.library_scope          is distinct from old.library_scope
     or new.version_number         is distinct from old.version_number
     or new.transcript             is distinct from old.transcript
     or new.reference_paths        is distinct from old.reference_paths
     or new.duration_seconds       is distinct from old.duration_seconds
     or new.passing_score          is distinct from old.passing_score
     or new.retake_limit           is distinct from old.retake_limit
     or new.created_by             is distinct from old.created_by
     or new.supersedes_completions is distinct from old.supersedes_completions
     or new.content                is distinct from old.content
     or new.validity_days          is distinct from old.validity_days
     or new.locale                 is distinct from old.locale
  then
    raise exception 'STRIKE version % is % and its content is frozen; create a new version', old.id, old.status
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end;
$$;

-- ── Questions: formative vs graded ─────────────────────────────────────

alter table public.strike_quiz_questions
  add column if not exists graded    boolean not null default true,
  add column if not exists block_key text,
  add column if not exists bank_tag  text;

-- An inline formative check must never gate a credential.
alter table public.strike_quiz_questions drop constraint if exists strike_questions_formative_ck;
alter table public.strike_quiz_questions
  add constraint strike_questions_formative_ck
    check (block_key is null or graded = false);

-- 260 revokes then grants explicitly, so new columns are invisible to the
-- browser until named here. None of them reveal the answer key.
revoke select on public.strike_quiz_questions from authenticated, anon;
grant  select (id, module_version_id, tenant_id, library_scope, question_type,
               prompt, sort_order, required, points, created_at,
               graded, block_key, bank_tag)
  on public.strike_quiz_questions to authenticated;

-- ── 2. Member-keyed attempts and completions ───────────────────────────

alter table public.strike_attempts
  add column if not exists member_id uuid references public.members(id) on delete cascade;
alter table public.strike_completions
  add column if not exists member_id uuid references public.members(id) on delete cascade;

alter table public.strike_attempts    alter column user_id drop not null;
alter table public.strike_completions alter column user_id drop not null;

update public.strike_attempts a
   set member_id = m.id
  from public.members m
 where a.member_id is null and m.tenant_id = a.tenant_id and m.profile_id = a.user_id;

update public.strike_completions c
   set member_id = m.id
  from public.members m
 where c.member_id is null and m.tenant_id = c.tenant_id and m.profile_id = c.user_id;

alter table public.strike_attempts drop constraint if exists strike_attempts_learner_ck;
alter table public.strike_attempts
  add constraint strike_attempts_learner_ck check (user_id is not null or member_id is not null);
alter table public.strike_completions drop constraint if exists strike_completions_learner_ck;
alter table public.strike_completions
  add constraint strike_completions_learner_ck check (user_id is not null or member_id is not null);

create index if not exists strike_completions_member_idx
  on public.strike_completions(tenant_id, member_id, module_id, completed_at desc)
  where member_id is not null;
create index if not exists strike_attempts_member_idx
  on public.strike_attempts(tenant_id, member_id, module_version_id)
  where member_id is not null;

-- ── 3. Block evidence ──────────────────────────────────────────────────

create table if not exists public.strike_block_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  attempt_id  uuid not null references public.strike_attempts(id) on delete cascade,
  block_key   text not null check (block_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  event       text not null check (event in ('seen', 'completed', 'interaction')),
  dwell_ms    int check (dwell_ms is null or dwell_ms >= 0),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  unique (attempt_id, block_key, event)
);

comment on table public.strike_block_events is
  'Per-block learning evidence for an attempt. Written only by /api/strike/[moduleId]/events (service role); the submit route requires every required block before a pass counts. Client-reported, so it deters skipping rather than proving attention.';

alter table public.strike_block_events enable row level security;

drop policy if exists strike_block_events_read on public.strike_block_events;
create policy strike_block_events_read on public.strike_block_events
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
      or attempt_id in (select id from public.strike_attempts where user_id = auth.uid())
    )
  );

-- ── 4. Remove browser-forgeable write paths ────────────────────────────

drop policy if exists strike_attempts_insert on public.strike_attempts;
drop policy if exists strike_attempts_update on public.strike_attempts;

drop policy if exists strike_completions_insert on public.strike_completions;
create policy strike_completions_insert on public.strike_completions
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and source = 'admin'
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
