-- Migration 110: Backfill toolbox talks for May 9 - June 30, 2026.
--
-- The cron generator at /api/cron/generate-toolbox-talks normally
-- writes one talk per tenant per day, sourced from Anthropic. This
-- migration seeds 53 days of talks deterministically without an LLM
-- round-trip — useful for:
--
--   * Demo + onboarding tenants that need a populated archive
--     immediately rather than waiting weeks for the cron to fill in
--   * Resilience: if the cron / Anthropic is unreachable, the
--     archive still has content
--   * Tests of the archive UI (53 rows is enough to show pagination)
--
-- Strategy:
--   1. CTE picks 53 distinct general-industry topics, ordered by id
--      (stable, repeatable, no random()).
--   2. CTE generates the date series May 9 - June 30 inclusive
--      (53 dates).
--   3. JOIN by row_number maps topic -> date 1:1.
--   4. INSERT one row per (tenant, date) for every active tenant,
--      with on conflict do nothing so re-runs are idempotent.
--
-- Body template uses each topic's title + summary + reference so the
-- bodies are coherent and topic-specific; not LLM-generated, but
-- workable. Supervisors can re-generate any day's talk later via
-- the cron's manual trigger if they want richer copy.
--
-- Idempotent — guarded by `on conflict (tenant_id, talk_date) do
-- nothing` so re-running won't duplicate or clobber a real talk
-- the cron has already produced.

begin;

with topic_pool as (
  select
    id, title, summary, reference,
    row_number() over (order by id) as rn
  from public.toolbox_topics
  where active and industry = 'general'
  order by id
  limit 53
),
date_series as (
  select
    d::date as talk_date,
    row_number() over (order by d) as rn
  from generate_series(
    '2026-05-09'::date,
    '2026-06-30'::date,
    '1 day'::interval
  ) as d
),
plan as (
  select
    t.id      as topic_id,
    t.title   as topic_title,
    t.summary as topic_summary,
    coalesce(t.reference, 'OSHA General Duty Clause § 5(a)(1)') as topic_reference,
    d.talk_date
  from date_series d
  join topic_pool t on t.rn = d.rn
)
insert into public.toolbox_talks (
  tenant_id,
  topic_id,
  talk_date,
  title,
  body_markdown,
  key_points,
  delivery_notes,
  generated_by,
  generated_at,
  ai_model
)
select
  ten.id,
  p.topic_id,
  p.talk_date,
  p.topic_title,
  format(
    e'## %s\n\n'
    '%s\n\n'
    '### Why this matters today\n\n'
    'Take two minutes before starting work to think specifically about how this hazard shows up in **your** task today. '
    'The headline above is the standard line; the details that keep you safe live in your JHA, SDS, equipment placard, '
    'or the procedure your supervisor signed off. Read them. Don''t assume.\n\n'
    '### What we ask from each crew\n\n'
    '- Pre-task review of the JHA, SDS, LOTO procedure, or equipment placard for the work\n'
    '- Visual inspection of tools, PPE, guards, anchor points, and emergency-stop locations\n'
    '- Buddy check — does your crewmate know what you''re about to do, and how to help if it goes wrong?\n'
    '- Stop-work authority — anyone, any time, no retaliation\n'
    '- Sign the roster below when the briefing is complete\n\n'
    '### What to avoid\n\n'
    '- Skipping the JHA review because "we did this yesterday"\n'
    '- Working around a guard, lock, or barrier "just for a second"\n'
    '- Assuming a piece of equipment is de-energized without verifying\n\n'
    '### Reference\n\n'
    '%s\n\n'
    '### Today''s commitment\n\n'
    'We take the two minutes. We verify. We sign the roster. If something feels wrong, we stop and ask.',
    p.topic_title,
    p.topic_summary,
    p.topic_reference
  )                                                          as body_markdown,
  array[
    'Pre-task review of the JHA, SDS, or procedure for the work',
    'Visual inspection of tools, PPE, guards, and emergency-stop locations',
    'Buddy check — confirm your crewmate knows the plan',
    'Stop-work authority — anyone, any time, no retaliation',
    'Sign the roster after the briefing'
  ]                                                          as key_points,
  'Pause after the title to ask the crew "what could go wrong on this task today?" — let them name two or three before you move on.' as delivery_notes,
  'manual'                                                   as generated_by,
  now()                                                      as generated_at,
  null                                                       as ai_model
from plan p
cross join public.tenants ten
on conflict (tenant_id, talk_date) do nothing;

commit;
