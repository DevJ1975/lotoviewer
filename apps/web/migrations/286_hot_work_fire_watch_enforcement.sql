-- Enforce the two post-work fire-watch rules migration 019 already states.
--
-- 019 documents both and enforces neither:
--
--   line 89:  "Permit cannot close until now() >= work_completed_at
--              + post_watch_minutes."
--   line 92:  "60 min is the NFPA 51B floor"
--             ...directly above `check (post_watch_minutes > 0 ...)`.
--
-- Both writes happen from the browser through PostgREST (app/hot-work/new
-- and the permit detail page's close-out dialog), so there is no server route
-- in the path — the database is the only place these can be enforced.
--
-- WHY THIS IS A FIRE RISK, not bookkeeping. The post-work watch exists because
-- hot work leaves smouldering ignition that develops AFTER the torch stops:
-- NFPA 51B §8.7 sets a 60-minute minimum for exactly that reason. Today a
-- permit can be issued with a 1-minute watch, and closed out as
-- 'task_complete' the instant work stops — or before work_completed_at is set
-- at all — so the watch can be skipped entirely while the permit record shows
-- an orderly close.
--
-- ── 1. Fire-watch floor ──────────────────────────────────────────────────
--
-- Added NOT VALID on purpose. Existing rows with a sub-60 watch are historical
-- safety records: they describe what actually happened on those jobs, and
-- rewriting them to satisfy a new constraint would falsify an audit trail an
-- inspector may later read. The constraint binds every new and updated row;
-- history stays as it was, and stays queryable for anyone who wants to find
-- the affected permits.
--
-- Run `alter table ... validate constraint hot_work_post_watch_nfpa_floor;`
-- once those legacy rows have been reviewed, if you want it enforced
-- retroactively.

begin;

alter table public.loto_hot_work_permits
  add constraint hot_work_post_watch_nfpa_floor
  check (post_watch_minutes >= 60 and post_watch_minutes <= 240)
  not valid;

comment on constraint hot_work_post_watch_nfpa_floor on public.loto_hot_work_permits is
  'NFPA 51B §8.7 minimum post-work fire watch is 60 minutes. The original check allowed 1.';

-- ── 2. Close-out gate ────────────────────────────────────────────────────
--
-- A trigger rather than a CHECK: the rule compares against now(), and CHECK
-- constraints must be immutable.
--
-- Only 'task_complete' is gated. The other reasons are the ones you need MOST
-- when something is going wrong — 'fire_observed' above all — and blocking
-- them behind a timer would leave a supervisor unable to record an emergency
-- until the watch expired. Closing early is the hazard; abandoning early is
-- the correct response to one.

create or replace function public.enforce_hot_work_post_watch()
returns trigger
language plpgsql
as $$
begin
  -- Only interested in the transition INTO a completed close-out.
  if new.cancel_reason is distinct from 'task_complete' then
    return new;
  end if;
  if old.cancel_reason is not distinct from 'task_complete' then
    return new;   -- already closed this way; not a new close-out
  end if;

  if new.work_completed_at is null then
    raise exception
      'Cannot close this permit as task complete: work has not been marked complete, so the post-work fire watch has not started (NFPA 51B 8.7).'
      using errcode = 'check_violation';
  end if;

  if now() < new.work_completed_at + make_interval(mins => new.post_watch_minutes) then
    raise exception
      'Cannot close this permit as task complete until the % minute post-work fire watch ends at % (NFPA 51B 8.7).',
      new.post_watch_minutes,
      to_char(new.work_completed_at + make_interval(mins => new.post_watch_minutes), 'YYYY-MM-DD HH24:MI TZ')
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function public.enforce_hot_work_post_watch() is
  'Blocks a task_complete close-out before the post-work fire watch has elapsed. Other cancel reasons — fire_observed above all — are deliberately not gated.';

drop trigger if exists trg_hot_work_post_watch on public.loto_hot_work_permits;
create trigger trg_hot_work_post_watch
  before update on public.loto_hot_work_permits
  for each row
  execute function public.enforce_hot_work_post_watch();

commit;
