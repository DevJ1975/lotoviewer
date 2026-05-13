-- Migration 136: Toolbox Talks yearly topic packs.
--
-- The original toolbox-talks seed shipped 100 General Industry topics.
-- This migration extends General Industry to a full one-year pool by
-- adding 265 additional topics, and adds a separate 365-topic
-- Construction pack. The cron still generates the final daily talk
-- body with AI; these rows are the curated safety rails it grounds on.

begin;

alter table public.toolbox_topics
  add column if not exists source_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'toolbox_topics_source_key_key'
      and conrelid = 'public.toolbox_topics'::regclass
  ) then
    alter table public.toolbox_topics
      add constraint toolbox_topics_source_key_key unique (source_key);
  end if;
end $$;

comment on column public.toolbox_topics.source_key is
  'Stable seed identifier for idempotent toolbox topic-pack migrations.';

with config as (
  select
    array[
      'Aisle housekeeping',
      'Wet floor response',
      'Stair and handrail use',
      'Loading dock edge awareness',
      'Forklift pedestrian separation',
      'Pallet stacking stability',
      'Manual lifting and team lifts',
      'Overhead storage checks',
      'Machine guard verification',
      'Pinch point awareness',
      'Conveyor start-up checks',
      'Lockout before clearing jams',
      'Electrical cord inspection',
      'Temporary power control',
      'Arc flash boundary awareness',
      'Compressed air safe use',
      'Noise exposure and hearing protection',
      'Eye wash station access',
      'Chemical label checks',
      'Safety Data Sheet lookup',
      'Spill kit readiness',
      'Flammable liquid storage',
      'Hot work fire watch',
      'Fire extinguisher access',
      'Emergency exit routes',
      'Evacuation roll call',
      'First-aid reporting',
      'Heat stress prevention',
      'Cold stress prevention',
      'Fatigue and shift handoff',
      'Line-of-fire positioning',
      'Hand tool inspection',
      'Blade and cutter control',
      'Ladder selection',
      'Step stool use',
      'Working from platforms',
      'Respirator seal checks',
      'Glove selection',
      'Safety glasses fit',
      'High-visibility clothing',
      'Battery charging safety',
      'Powered industrial truck charging',
      'Materials handling pinch points',
      'Racking damage reporting',
      'Waste container labeling',
      'Sanitation chemical mixing',
      'Food allergen cross-contact',
      'Lab sample handling',
      'Confined space recognition',
      'Permit-required entry warning signs',
      'Visitor and contractor control',
      'Near-miss reporting',
      'Stop-work authority'
    ]::text[] as focuses,
    array[
      'spot the hazard before work starts',
      'verify the control is in place',
      'pause when conditions change',
      'report the weak signal early',
      'coach a teammate in the moment'
    ]::text[] as actions,
    array[
      'production start-up',
      'cleaning and sanitation',
      'maintenance work',
      'shipping and receiving',
      'warehouse movement',
      'laboratory support',
      'end-of-shift turnover'
    ]::text[] as contexts
),
general_rows as (
  select
    s.n + 100 as pack_day,
    c.focuses[((s.n - 1) % cardinality(c.focuses)) + 1] as focus,
    c.actions[(((s.n - 1) / cardinality(c.focuses)) % cardinality(c.actions)) + 1] as action,
    c.contexts[((s.n - 1) % cardinality(c.contexts)) + 1] as context
  from generate_series(1, 265) as s(n)
  cross join config c
)
insert into public.toolbox_topics (source_key, title, summary, industry, reference, active)
select
  'general-year-pack-' || lpad(pack_day::text, 3, '0'),
  focus || ': ' || action,
  'General Industry yearly pack day ' || pack_day || '. Use a plain-language pre-shift scenario about ' ||
    lower(focus) || ' during ' || lower(context) || '. Have the supervisor ask the crew to ' ||
    lower(action) || ', point out the nearest control, and name the person they will tell if the condition is not right.',
  'general',
  'OSHA 1910 / General Duty Clause',
  true
from general_rows
on conflict (source_key) do update
set title = excluded.title,
    summary = excluded.summary,
    industry = excluded.industry,
    reference = excluded.reference,
    active = true;

with config as (
  select
    array[
      'Fall protection harness inspection',
      'Tie-off point selection',
      'Leading edge control',
      'Guardrail gap correction',
      'Ladder angle and footing',
      'Extension ladder access',
      'Step ladder positioning',
      'Scaffold plank inspection',
      'Scaffold tag checks',
      'Aerial lift pre-use inspection',
      'Scissor lift pothole protection',
      'Boom lift rescue planning',
      'Trench protective systems',
      'Trench access and egress',
      'Spoil pile setback',
      'Underground utility locating',
      'Excavation water control',
      'Competent person stop-work',
      'Crane swing radius control',
      'Rigging hardware inspection',
      'Tagline communication',
      'Suspended load exclusion zones',
      'Forklift and telehandler spotters',
      'Backing equipment communication',
      'Traffic control setup',
      'Flagger visibility',
      'Dump truck bed hazards',
      'Concrete pump hose control',
      'Rebar impalement protection',
      'Formwork access',
      'Masonry wall bracing',
      'Steel erection bolt-up zones',
      'Deck opening covers',
      'Roof edge warning lines',
      'Skylight fall hazards',
      'Hot work permit checks',
      'Fire watch readiness',
      'Temporary power GFCI checks',
      'Extension cord routing',
      'Panel cover and knockout checks',
      'Silica dust control',
      'Concrete cutting water control',
      'Respirable dust housekeeping',
      'Lead paint disturbance',
      'Asbestos suspect material stop-work',
      'Confined space recognition',
      'Permit entry attendant duties',
      'Atmospheric testing sequence',
      'Welding fume ventilation',
      'Grinding spark control',
      'Cut-resistant glove selection',
      'Eye and face protection',
      'Hard hat condition',
      'High-visibility gear',
      'Hearing protection near equipment',
      'Heat illness prevention',
      'Cold weather footing',
      'Lightning stop-work',
      'Wind limits for lifts',
      'Material staging',
      'Housekeeping around trades',
      'Nail and sharp debris control',
      'Tool tethering',
      'Powder-actuated tool control',
      'Saw blade guard checks',
      'Jackhammer body position',
      'Manual material handling',
      'Subcontractor coordination',
      'Daily plan changes',
      'Visitor path control',
      'Emergency access routes',
      'First-aid and rescue location',
      'Near-miss reporting'
    ]::text[] as focuses,
    array[
      'confirm the plan before the task starts',
      'verify the control before exposure',
      'stop when the site condition changes',
      'communicate the hazard across trades',
      'correct the problem before production continues'
    ]::text[] as actions,
    array[
      'morning mobilization',
      'trade overlap',
      'material delivery',
      'weather change',
      'equipment movement',
      'elevated work',
      'end-of-shift cleanup'
    ]::text[] as contexts
),
construction_rows as (
  select
    s.n as pack_day,
    c.focuses[((s.n - 1) % cardinality(c.focuses)) + 1] as focus,
    c.actions[(((s.n - 1) / cardinality(c.focuses)) % cardinality(c.actions)) + 1] as action,
    c.contexts[((s.n - 1) % cardinality(c.contexts)) + 1] as context
  from generate_series(1, 365) as s(n)
  cross join config c
)
insert into public.toolbox_topics (source_key, title, summary, industry, reference, active)
select
  'construction-year-pack-' || lpad(pack_day::text, 3, '0'),
  focus || ': ' || action,
  'Construction yearly pack day ' || pack_day || '. Use a jobsite huddle scenario about ' ||
    lower(focus) || ' during ' || lower(context) || '. Have the foreman ask the crew to ' ||
    lower(action) || ', identify the competent person or spotter when relevant, and point to the control that keeps the next task safe.',
  'construction',
  'OSHA 1926 / Construction Safety',
  true
from construction_rows
on conflict (source_key) do update
set title = excluded.title,
    summary = excluded.summary,
    industry = excluded.industry,
    reference = excluded.reference,
    active = true;

commit;
