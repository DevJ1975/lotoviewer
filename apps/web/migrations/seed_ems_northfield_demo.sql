-- Demo seed for the EMS (ISO 14001) build: the fictional tenant
-- "Northfield Forge & Finish" (Northfield, TX) with the opt-in Environmental
-- module switched on, and each EMS phase's demo records
-- (docs/ems/EMS_IMPLEMENTATION_PLAN.md).
--
-- Everything here is invented. Never add a real customer's name, site,
-- permit numbers, findings, or people to this file.
--
-- This is NOT a numbered migration. Run it by hand against a dev or demo
-- database (SQL Editor or psql). It never touches an existing tenant.
--
-- Prereqs: migrations 027 (tenants), 209 (facilities), 294 (Environmental
-- opt-in) and 295-301 (Phase 1 registers) applied.
--
-- Idempotent: every row has a fixed id or natural key, so a re-run finds
-- what it made before and changes nothing. Dates are relative to the day it
-- runs, so the demo reads as current whenever it is loaded.

begin;

-- ── Phase 0: the tenant and its plant ──────────────────────────────────────

-- The tenant number comes from the shared sequence, like any superadmin-created
-- tenant. The select list only runs when the slug is absent, so a re-run does
-- not consume a number.
insert into public.tenants (tenant_number, slug, name, status, is_demo, modules)
select public.next_tenant_number(),
       'northfield-forge-demo',
       'Northfield Forge & Finish',
       'active',
       true,
       jsonb_build_object('environmental', true)
 where not exists (
   select 1 from public.tenants where slug = 'northfield-forge-demo'
 );

-- Every tenant needs exactly one primary facility (migrations 209-211).
insert into public.facilities (tenant_id, name, city, state, is_primary)
select t.id, 'Northfield Plant', 'Northfield', 'TX', true
  from public.tenants t
 where t.slug = 'northfield-forge-demo'
   and not exists (
     select 1 from public.facilities f where f.tenant_id = t.id
   );

-- ── Phase 1: context, scope and policy; aspects; obligations ──────────────
--
-- The story the registers tell on the hub:
--   context          green: five issues, climate change among them
--   scope & policy   green: scope v1 and a complete policy v1 signed after it
--   aspects          green: all 25 scored and in review; the walk-down shows
--                    coverage gaps where abnormal or emergency is unscored
--   obligations      amber: one review overdue, one evaluation overdue
--
-- Completed evaluations need a person and evidence files (migrations 298 and
-- 299), which SQL cannot supply honestly. apps/web/scripts/seed-ems-northfield-
-- evidence.mjs adds the four completed evaluations, the noncompliant one's
-- nonconformity, and real evidence files with verifiable hashes.

-- Fixed ids: 4e0f (for "NF") + a register number + the row's ordinal.
--   4e0f0001 aspects   4e0f0002 obligations   4e0f0003 evaluations
--   4e0f0004 issues    4e0f0005 parties
create temp table northfield on commit drop as
select t.id as tenant_id,
       f.id as facility_id,
       -- The next March 1 and July 1 on or after today.
       make_date(extract(year from current_date)::int
                 + (current_date > make_date(extract(year from current_date)::int, 3, 1))::int, 3, 1) as next_march_1,
       make_date(extract(year from current_date)::int
                 + (current_date > make_date(extract(year from current_date)::int, 7, 1))::int, 7, 1) as next_july_1
  from public.tenants t
  join public.facilities f on f.tenant_id = t.id and f.is_primary
 where t.slug = 'northfield-forge-demo';

create or replace function pg_temp.northfield_id(register int, ordinal int) returns uuid
language sql immutable as $$
  select format('4e0f%s-0000-4000-8000-%s', lpad(register::text, 4, '0'), lpad(ordinal::text, 12, '0'))::uuid
$$;

-- Clause 4.1: the issues that shape the EMS, climate change included (Amd 1:2024).
insert into public.ms_context_issues
  (id, tenant_id, discipline, kind, description, relevance, effect, last_reviewed_at, next_review_due)
select pg_temp.northfield_id(4, v.n), nf.tenant_id, 'ems', v.kind, v.description, v.relevance, v.effect,
       now() - interval '45 days', current_date + 320
  from northfield nf
 cross join (values
   (1, 'external', 'The state industrial stormwater general permit is due for renewal, and its monitoring terms may change.',
       'Outdoor scrap storage drains to the north outfall.', 'risk'),
   (2, 'external', 'Customers increasingly ask suppliers for product carbon data.',
       'Two of the largest customers have asked this year.', 'both'),
   (3, 'internal', 'Spill-response know-how sits with two maintenance technicians who retire within two years.',
       'Emergency preparedness (clause 8.2) depends on it.', 'risk'),
   (4, 'internal', 'Capital is approved for a powder-coat line that could replace part of the solvent-borne painting.',
       'Would cut the VOC aspect at the paint booth.', 'opportunity'),
   (5, 'climate', 'Climate change is relevant: heavier rainfall raises flooding and stormwater run-on at the yard, and hotter summers raise cooling demand.',
       'Determined at the annual context review.', 'risk')
 ) as v(n, kind, description, relevance, effect)
on conflict (id) do nothing;

-- Clause 4.3: where the EMS applies.
insert into public.ms_scope_statements
  (tenant_id, discipline, version, legal_entity, physical_boundary, activities, products_services,
   effective_from, next_review_due)
select nf.tenant_id, 'ems', 1,
       'Northfield Forge & Finish LLC',
       'The Northfield Plant in Northfield, TX: forge shop, heat treatment, machining and finishing buildings, and the yard inside the fence line.',
       'Closed-die forging, heat treatment, CNC machining, painting and powder coating of steel parts.',
       'Forged and finished steel components for industrial equipment makers.',
       current_date - 200, current_date + 165
  from northfield nf
on conflict (tenant_id, discipline, version) do nothing;

-- Clause 5.2: a complete policy, signed after the scope took effect.
insert into public.ms_policies
  (tenant_id, discipline, version, body, commitments, signatory_name, signatory_title, signed_at, next_review_due)
select nf.tenant_id, 'ems', 1,
       'Northfield Forge & Finish makes forged and finished steel parts with care for the environment. '
       || 'We protect the environment, including preventing pollution from our furnaces, paint line and yard; '
       || 'we fulfil our compliance obligations; and we continually improve our environmental management system '
       || 'to enhance our environmental performance. This policy frames our environmental objectives and is '
       || 'shared with everyone who works for or on behalf of the plant.',
       jsonb_build_object('ems.protect_environment', true, 'ems.fulfil_obligations', true, 'ems.continual_improvement', true),
       'Demo Plant Manager', 'Plant Manager',
       current_date - 190, current_date + 175
  from northfield nf
on conflict (tenant_id, discipline, version) do nothing;

-- The tenant's default scoring method: exactly what the API creates on first use
-- (DEFAULT_SCORING_METHOD in packages/core/src/scoringMethod.ts).
insert into public.ms_scoring_methods (tenant_id, discipline, name, significance_threshold, is_default)
select nf.tenant_id, 'ems', 'Severity × likelihood (5×5)', 12, true
  from northfield nf
 where not exists (
   select 1 from public.ms_scoring_methods m
    where m.tenant_id = nf.tenant_id and m.discipline = 'ems' and m.is_default and m.retired_at is null
 );

-- Clause 6.1.2: 25 aspects across five process areas, each scored under the
-- operating conditions that apply. A null pair means that condition is
-- deliberately unscored, so the walk-down shows the gap.
create temp table northfield_aspects (
  n int, process_area text, activity text, aspect text, impact text,
  life_cycle_stage text, flow text, controls text, status text,
  normal_severity int, normal_likelihood int,
  abnormal_severity int, abnormal_likelihood int,
  emergency_severity int, emergency_likelihood int
) on commit drop;

insert into northfield_aspects values
  -- Forge shop
  ( 1, 'Forge shop', 'Gas-fired forging furnaces', 'Natural gas combustion', 'Greenhouse gas and NOx emissions to air',
       'manufacturing', 'output', 'Burner tune-ups each year; furnace door seals checked weekly', 'controlled',
       4, 4,  4, 2,  null, null),
  ( 2, 'Forge shop', 'Die lubrication', 'Graphite lubricant overspray', 'Particulate emissions and floor contamination',
       'manufacturing', 'output', 'Overspray hoods at each press; daily floor sweep', 'controlled',
       2, 4,  3, 2,  null, null),
  ( 3, 'Forge shop', 'Descaling forged parts', 'Mill scale generation', 'Solid waste',
       'manufacturing', 'output', 'Scale collected in covered bins and sent for metal recycling', 'monitored',
       2, 5,  null, null,  null, null),
  ( 4, 'Forge shop', 'Forging press hydraulics', 'Hydraulic oil leak', 'Soil and stormwater contamination',
       'manufacturing', 'output', 'Drip pans; weekly leak walk; spill kit at each press', 'controlled',
       2, 3,  3, 3,  4, 3),
  ( 5, 'Forge shop', 'Compressed air for forging cells', 'Electricity use', 'Resource depletion and indirect greenhouse gas emissions',
       'manufacturing', 'input', 'Quarterly compressed-air leak survey', 'identified',
       3, 4,  null, null,  null, null),
  -- Heat treatment
  ( 6, 'Heat treatment', 'Oil quench tanks', 'Quench oil fire', 'Smoke emissions and contaminated firewater runoff',
       'manufacturing', 'output', 'Tank lids; fixed CO2 suppression; annual fire drill', 'controlled',
       2, 2,  3, 2,  5, 3),
  ( 7, 'Heat treatment', 'Quench oil changeout', 'Spent quench oil', 'Used oil generation',
       'end_of_life', 'output', 'Labeled used-oil containers; collected by a registered transporter', 'controlled',
       3, 3,  null, null,  null, null),
  ( 8, 'Heat treatment', 'Heat-treat furnaces', 'Natural gas use', 'Greenhouse gas emissions',
       'manufacturing', 'input', 'Furnace load scheduling to cut idle firing', 'identified',
       4, 3,  null, null,  null, null),
  ( 9, 'Heat treatment', 'Water quench', 'Process water use', 'Water resource depletion',
       'manufacturing', 'input', 'Closed-loop recirculation; meter read monthly', 'monitored',
       2, 3,  null, null,  null, null),
  (10, 'Heat treatment', 'Furnace relining', 'Spent refractory', 'Solid waste to landfill',
       'end_of_life', 'output', 'Waste profiled before disposal', 'identified',
       2, 2,  null, null,  null, null),
  -- Machining
  (11, 'Machining', 'CNC machining', 'Metalworking fluid in wastewater', 'Pollutant load to the city sewer',
       'manufacturing', 'output', 'Fluid concentration checked each shift; sump recycling', 'controlled',
       3, 3,  3, 2,  null, null),
  (12, 'Machining', 'CNC machining', 'Metal chips and swarf', 'Scrap generation (recyclable)',
       'manufacturing', 'output', 'Chip wringer; segregated scrap bins', 'controlled',
       1, 5,  null, null,  null, null),
  (13, 'Machining', 'Solvent parts washing', 'Solvent evaporation', 'VOC emissions to air',
       'manufacturing', 'output', 'Washer lids closed when idle; aqueous washer on trial', 'identified',
       3, 4,  null, null,  null, null),
  (14, 'Machining', 'Coolant disposal', 'Spent coolant', 'Hazardous waste generation',
       'end_of_life', 'output', 'Waste determination on file; licensed hauler', 'controlled',
       3, 3,  null, null,  3, 2),
  (15, 'Machining', 'Machine shop lighting and HVAC', 'Electricity use', 'Indirect greenhouse gas emissions',
       'operation', 'input', 'LED retrofit in progress', 'identified',
       2, 5,  null, null,  null, null),
  -- Finishing
  (16, 'Finishing', 'Spray painting', 'VOC from solvent-borne coatings', 'Ozone-forming emissions to air',
       'manufacturing', 'output', 'Booth filters; coating usage logged daily', 'controlled',
       4, 4,  3, 3,  null, null),
  (17, 'Finishing', 'Paint booth filter changes', 'Spent paint filters', 'Hazardous waste generation',
       'end_of_life', 'output', 'Waste determination on file; closed containers in the accumulation area', 'controlled',
       3, 4,  null, null,  3, 2),
  (18, 'Finishing', 'Shot blasting', 'Particulate emissions', 'Dust beyond the fence line',
       'manufacturing', 'output', 'Dust collector with a differential-pressure gauge', 'monitored',
       3, 3,  4, 3,  null, null),
  (19, 'Finishing', 'Paint mixing', 'Solvent spill', 'Soil and stormwater contamination',
       'manufacturing', 'output', 'Drums on secondary containment; spill kit in the mixing room', 'controlled',
       2, 2,  null, null,  4, 3),
  (20, 'Finishing', 'Powder-coat cure oven', 'Natural gas use', 'Greenhouse gas emissions',
       'manufacturing', 'input', 'Oven runs only on scheduled batches', 'identified',
       3, 3,  null, null,  null, null),
  -- Yard and utilities
  (21, 'Yard and utilities', 'Outdoor scrap and material storage', 'Stormwater contact with scrap', 'Pollutants in stormwater discharge',
       'operation', 'output', 'Covered roll-off bins; quarterly visual monitoring', 'monitored',
       3, 4,  4, 4,  null, null),
  (22, 'Yard and utilities', 'Forklift diesel fueling', 'Diesel spill', 'Soil and groundwater contamination',
       'operation', 'output', 'Double-walled tank; spill kit at the pump', 'controlled',
       2, 2,  null, null,  4, 3),
  (23, 'Yard and utilities', 'Space-heating boiler', 'Natural gas combustion', 'Greenhouse gas and NOx emissions to air',
       'operation', 'output', 'Annual boiler service', 'controlled',
       2, 4,  null, null,  null, null),
  (24, 'Yard and utilities', 'Chillers and HVAC units', 'Refrigerant leak', 'Ozone depletion and climate impact',
       'operation', 'output', 'Leak checks by a certified technician', 'controlled',
       2, 2,  3, 2,  null, null),
  (25, 'Yard and utilities', 'General plant waste', 'Mixed solid waste', 'Landfill use',
       'end_of_life', 'output', 'Cardboard and pallet recycling', 'monitored',
       1, 4,  null, null,  null, null);

insert into public.environmental_aspects
  (id, tenant_id, facility_id, process_area, activity, aspect, impact, life_cycle_stage, flow, controls, status,
   last_reviewed_at, next_review_due)
select pg_temp.northfield_id(1, a.n), nf.tenant_id, nf.facility_id, a.process_area, a.activity, a.aspect, a.impact,
       a.life_cycle_stage, a.flow, a.controls, a.status,
       now() - interval '60 days', current_date + 120 + a.n * 7
  from northfield nf
 cross join northfield_aspects a
on conflict (id) do nothing;

insert into public.environmental_aspect_scores
  (tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale, scored_at)
select nf.tenant_id, pg_temp.northfield_id(1, a.n), c.condition, c.severity, c.likelihood, m.id, c.rationale,
       now() - interval '60 days'
  from northfield nf
  join public.ms_scoring_methods m
    on m.tenant_id = nf.tenant_id and m.discipline = 'ems' and m.is_default and m.retired_at is null
 cross join northfield_aspects a
 cross join lateral (values
   ('normal',    a.normal_severity,    a.normal_likelihood,    'Routine operation, as seen on the demo walk-down.'),
   ('abnormal',  a.abnormal_severity,  a.abnormal_likelihood,  'Start-up, shutdown or an equipment fault.'),
   ('emergency', a.emergency_severity, a.emergency_likelihood, 'Credible worst case: a spill, fire or failure.')
 ) as c(condition, severity, likelihood, rationale)
 where c.severity is not null
   and not exists (
     select 1 from public.environmental_aspect_scores s
      where s.aspect_id = pg_temp.northfield_id(1, a.n) and s.operating_condition = c.condition
   );

-- Clause 6.1.3: 15 compliance obligations. Citations name public rules only;
-- no thresholds are stated. Obligation 12's review is deliberately overdue.
-- Obligation 1 is the compliance calendar's own EPCRA Tier II row
-- (SYSTEM_OBLIGATIONS in packages/core/src/complianceCalendar.ts), so turning
-- the Chemicals module on later finds it already seeded.
insert into public.compliance_calendar_obligations
  (id, tenant_id, facility_id, discipline, title, description, regulatory_ref, category, cadence, next_due_at,
   status, source, system_key, source_kind, jurisdiction, applicability_rationale, evaluation_cadence_days,
   last_reviewed_at, next_review_due)
select pg_temp.northfield_id(2, o.n), nf.tenant_id, nf.facility_id, 'ems', o.title, o.description, o.regulatory_ref,
       o.category, o.cadence,
       case o.due when 'march_1' then nf.next_march_1
                  when 'july_1'  then nf.next_july_1
                  -- The biennial report falls in even years.
                  when 'even_march_1' then (nf.next_march_1 + make_interval(years => extract(year from nf.next_march_1)::int % 2))::date
                  else current_date + o.due::int end,
       'open', o.source, o.system_key, o.source_kind, o.jurisdiction, o.rationale, o.evaluation_cadence_days,
       now() - interval '30 days', current_date + o.review_in_days
  from northfield nf
 cross join (values
   ( 1, 'File EPCRA Tier II report', 'Report hazardous chemical inventories to the SERC, LEPC, and local fire department.',
        '40 CFR 370', 'chemicals', 'annual', 'march_1', 'system', 'epcra-tier-ii', 'law', 'federal',
        'Diesel, quench oil and compressed gases are stored on site; the inventory is screened against Part 370 each January.', 365, 300),
   ( 2, 'TRI Form R screening', 'Screen listed-chemical use and file Form R where a threshold is crossed.',
        '40 CFR 372', 'chemicals', 'annual', 'july_1', 'tenant', null, 'law', 'federal',
        'A covered manufacturing sector; alloying metals in the steel are screened against Part 372 each year.', 365, 290),
   ( 3, 'Hazardous waste generator requirements', 'Count monthly generation, keep containers closed and labeled, and inspect the accumulation area.',
        '40 CFR Part 262', 'waste', 'monthly', '12', 'tenant', null, 'law', 'federal',
        'Spent paint filters, coolant and solvent waste are hazardous by determination.', 365, 280),
   ( 4, 'Hazardous waste biennial report', 'File the biennial report for any year the site is a large quantity generator.',
        '40 CFR 262.41', 'waste', 'biennial', 'even_march_1', 'tenant', null, 'law', 'federal',
        'Applies only in reporting years when the site generates as a large quantity generator.', 730, 270),
   ( 5, 'Universal waste lamps and batteries', 'Label, date and ship universal waste within the Part 273 time limits.',
        '40 CFR Part 273', 'waste', 'quarterly', '40', 'tenant', null, 'law', 'federal',
        'Fluorescent lamps and forklift batteries are managed as universal waste.', 365, 260),
   ( 6, 'Used oil management', 'Keep used-oil containers labeled and in good condition; use a registered transporter.',
        '40 CFR Part 279', 'waste', 'quarterly', '25', 'tenant', null, 'law', 'federal',
        'Spent quench and hydraulic oil is managed as used oil.', 365, 250),
   ( 7, 'SPCC plan five-year review', 'Review and amend the Spill Prevention, Control, and Countermeasure plan.',
        '40 CFR 112.5', 'spill', 'quinquennial', '400', 'tenant', null, 'law', 'federal',
        'Aboveground storage of diesel, quench and hydraulic oil makes the site subject to Part 112.', 365, 240),
   ( 8, 'SPCC inspections and integrity checks', 'Inspect tanks and containment on the schedule written into the SPCC plan.',
        '40 CFR 112.8', 'spill', 'monthly', '9', 'tenant', null, 'law', 'federal',
        'Inspection frequency follows the site SPCC plan.', 180, 230),
   ( 9, 'Industrial stormwater general permit', 'Quarterly visual monitoring, benchmark sampling and an annual site inspection.',
        'TPDES Multi-Sector General Permit TXR050000', 'stormwater', 'quarterly', '27', 'tenant', null, 'permit', 'state:TX',
        'Forging and metal finishing are covered sectors; outdoor scrap storage drains to the north outfall.', 365, 220),
   (10, 'Surface coating permit by rule', 'Keep the coating usage records that support the paint booth''s permit by rule.',
        '30 TAC Chapter 106', 'air', 'annual', '150', 'tenant', null, 'permit', 'state:TX',
        'The paint booth operates under a permit by rule.', 365, 210),
   (11, 'Industrial wastewater discharge permit', 'Submit self-monitoring reports to the city pretreatment program.',
        'City of Northfield pretreatment permit (40 CFR Part 403 program)', 'wastewater', 'semiannual', '60', 'tenant', null, 'permit', 'local:Northfield',
        'Parts-washer and coolant-separator effluent goes to the city sewer.', 365, 200),
   (12, 'Refrigerant leak inspection and repair', 'Track refrigerant additions and repair leaks in covered appliances.',
        '40 CFR Part 82 Subpart F', 'air', 'annual', '200', 'tenant', null, 'law', 'federal',
        'Process chillers and HVAC units hold regulated refrigerants.', 365, -21),
   (13, 'Customer restricted-substances declaration', 'Return the annual restricted-substances declaration to the customer.',
        'Customer supplier code', 'customer', 'annual', '90', 'tenant', null, 'contract', null,
        'A key customer''s supplier code requires it.', 365, 190),
   (14, 'Energy and water baseline report', 'Publish the plant''s annual energy and water baseline.',
        'Environmental policy commitment', 'voluntary', 'annual', '120', 'tenant', null, 'voluntary', null,
        'Top management committed to it with policy version 1.', null, 180),
   (15, 'Spill response drill', 'Run a spill drill at the paint mixing room or the fuel pump and record lessons learned.',
        'Emergency preparedness procedure (clause 8.2)', 'internal', 'semiannual', '45', 'tenant', null, 'internal', null,
        'The emergency preparedness procedure requires two drills a year.', 365, 170)
 ) as o(n, title, description, regulatory_ref, category, cadence, due, source, system_key, source_kind, jurisdiction,
        rationale, evaluation_cadence_days, review_in_days)
on conflict do nothing;

-- Which obligations each aspect answers to (aspect ordinal, obligation ordinal).
insert into public.environmental_aspect_obligations (tenant_id, aspect_id, obligation_id)
select nf.tenant_id, pg_temp.northfield_id(1, l.aspect), pg_temp.northfield_id(2, l.obligation)
  from northfield nf
 cross join (values
   ( 4,  7), ( 4,  8), ( 7,  6), (11, 11), (13,  2), (14,  3), (16, 10), (17,  3),
   (19, 15), (21,  9), (22,  7), (22,  8), (22, 15), (24, 12)
 ) as l(aspect, obligation)
on conflict do nothing;

-- Clause 4.2: interested parties; two needs became obligations.
insert into public.ms_interested_parties
  (id, tenant_id, discipline, name, needs_expectations, becomes_obligation, obligation_id, last_reviewed_at, next_review_due)
select pg_temp.northfield_id(5, p.n), nf.tenant_id, 'ems', p.name, p.needs, p.becomes_obligation,
       case when p.obligation is null then null else pg_temp.northfield_id(2, p.obligation) end,
       now() - interval '45 days', current_date + 320
  from northfield nf
 cross join (values
   (1, 'City of Northfield public works', 'Discharges within the pretreatment permit and on-time self-monitoring reports.', true, 11),
   (2, 'Neighbors along the east fence line', 'Little dust, odor and noise, and a heads-up about unusual events.', false, null),
   (3, 'Key customer', 'An annual restricted-substances declaration, and carbon data on request.', true, 13),
   (4, 'Employees', 'Safe chemical handling and spill training.', false, null)
 ) as p(n, name, needs, becomes_obligation, obligation)
on conflict (id) do nothing;

-- Clause 9.1.2: the two open evaluations (one overdue). The four completed
-- ones come from the evidence script described above. `on conflict do nothing`
-- also covers an evaluation the nightly job has already opened.
insert into public.ms_compliance_evaluations
  (id, tenant_id, facility_id, discipline, obligation_id, scheduled_for)
select pg_temp.northfield_id(3, e.n), nf.tenant_id, nf.facility_id, 'ems', pg_temp.northfield_id(2, e.obligation),
       current_date + e.scheduled_in_days
  from northfield nf
 cross join (values (5, 8, 14), (6, 6, -10)) as e(n, obligation, scheduled_in_days)
on conflict do nothing;

commit;
