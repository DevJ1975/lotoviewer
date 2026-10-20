-- Migration 294: freeze published STRIKE content; make "this version
-- invalidates prior completions" an explicit, recorded decision.
--
-- Two defects carried open from the strike_security_hardening handoff
-- (docs/handoffs/2026-08-29-strike-phase-2.md, defects #4 and #5):
--
-- #5 Published versions were silently mutable. Nothing stopped an UPDATE of
--    a published version's passing_score, or an edit to one of its quiz
--    answers, so every historical completion bound to that version quietly
--    changed meaning. A completion is evidence for an auditor; the content
--    it certifies must not move under it.
--
-- #4 Publishing any new version marked the entire workforce untrained,
--    because the learner page compared every completion against the latest
--    version id. A typo fix and a material change were indistinguishable.
--    `supersedes_completions` records which one the author meant; the app
--    only demands a version match when it is true.
--
-- The freeze is a BEFORE trigger with NO role bypass, unlike
-- profiles_guard_privileged_columns (249): the routes that write these
-- tables run as service_role, so a bypass would exempt exactly the writers
-- that need fencing. Allowed on a frozen version: forward status moves
-- (published → superseded → archived) and the delivery-only columns
-- (video_*, thumbnail_path, captions_path, published_at), which point at
-- renditions of the content rather than the content itself.
--
-- Frozen versions cannot be deleted either: archive them. That also keeps
-- the question/answer triggers below from ever seeing a cascade from a
-- frozen parent.
--
-- Idempotent: create-or-replace + drop-if-exists.

begin;

alter table public.strike_module_versions
  add column if not exists supersedes_completions boolean not null default false;

comment on column public.strike_module_versions.supersedes_completions is
  'True when this version is a material change: completions of earlier versions stop counting as current once it publishes. False (default) for minor edits, where prior completions remain valid. Frozen once published.';

create or replace function public.strike_version_is_frozen(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('published', 'superseded', 'archived')
$$;

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
  then
    raise exception 'STRIKE version % is % and its content is frozen; create a new version', old.id, old.status
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists strike_versions_freeze on public.strike_module_versions;
create trigger strike_versions_freeze
  before update or delete on public.strike_module_versions
  for each row execute function public.strike_guard_frozen_version();

create or replace function public.strike_guard_frozen_question()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.strike_module_versions
   where id in (
     case when tg_op = 'INSERT' then null else old.module_version_id end,
     case when tg_op = 'DELETE' then null else new.module_version_id end
   )
     and public.strike_version_is_frozen(status)
   limit 1;

  if v_status is not null then
    raise exception 'Quiz questions of a % STRIKE version are frozen; create a new version', v_status
      using errcode = 'integrity_constraint_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists strike_questions_freeze on public.strike_quiz_questions;
create trigger strike_questions_freeze
  before insert or update or delete on public.strike_quiz_questions
  for each row execute function public.strike_guard_frozen_question();

create or replace function public.strike_guard_frozen_answer()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select v.status into v_status
    from public.strike_quiz_questions q
    join public.strike_module_versions v on v.id = q.module_version_id
   where q.id in (
     case when tg_op = 'INSERT' then null else old.question_id end,
     case when tg_op = 'DELETE' then null else new.question_id end
   )
     and public.strike_version_is_frozen(v.status)
   limit 1;

  if v_status is not null then
    raise exception 'Quiz answers of a % STRIKE version are frozen; create a new version', v_status
      using errcode = 'integrity_constraint_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists strike_answers_freeze on public.strike_quiz_answers;
create trigger strike_answers_freeze
  before insert or update or delete on public.strike_quiz_answers
  for each row execute function public.strike_guard_frozen_answer();

notify pgrst, 'reload schema';

commit;
