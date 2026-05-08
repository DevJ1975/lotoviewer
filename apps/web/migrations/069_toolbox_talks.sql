-- Migration 069: Toolbox Talks Module — schema + RLS + 100 General
-- Industry seed topics.
--
-- A "toolbox talk" is a short pre-shift safety briefing (5–10 min)
-- that a supervisor delivers to the crew at the start of the day.
-- Attendees sign a roster proving they were present — required for
-- OSHA 1910.1200(h) (HazCom training documentation), Cal/OSHA T8
-- §3203 IIPP "training and instruction" recordkeeping, and the
-- general 29 CFR 1904 audit trail.
--
-- Three tables:
--
-- 1. toolbox_topics  — GLOBAL master library of topics (no tenant_id).
--                      Seeded with 100 General Industry items the
--                      cron picks from. Tenants do NOT generate or
--                      edit topics — abuse-prevention per the
--                      operator's call. Future industries (food,
--                      construction, oil-and-gas) get appended here.
--
-- 2. toolbox_talks   — Per-tenant generated talks. The weekly cron
--                      picks 7 unused topics for the tenant's industry,
--                      runs each through Claude Sonnet to produce a
--                      site-appropriate body, and inserts one row per
--                      (tenant, talk_date). Daily rotation = the
--                      list page filters by today's talk_date.
--
-- 3. toolbox_talk_signatures — Sign-in roster for a talk. Any tenant
--                      member can add a signature (themselves or a
--                      coworker who's standing next to them). The
--                      signature_data is a base64 PNG from the
--                      SignaturePad canvas; signed_at is server-side
--                      now() so a worker can't backdate.
--
-- Idempotent — guarded with `if not exists` / `do $$ ... $$`.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. toolbox_topics — global master library (NOT tenant-scoped)
-- ──────────────────────────────────────────────────────────────────────────
--
-- Industry tagging lets the cron pick topics relevant to the tenant's
-- declared industry. v1 ships only 'general' — every tenant gets the
-- same pool. When more industries land we extend the check + seed.

create table if not exists public.toolbox_topics (
  id           uuid not null primary key default gen_random_uuid(),
  -- The supervisor-facing title shown on the list page.
  title        text not null,
  -- One-paragraph summary the AI grounds against; not shown to
  -- attendees directly. Keeps the AI on topic without the supervisor
  -- having to write the brief themselves.
  summary      text not null,
  -- Industry pool. 'general' = OSHA 1910 General Industry topics
  -- applicable to most workplaces. Future enums: 'construction'
  -- (1926), 'food', 'oil_gas', 'maritime' (1915).
  industry     text not null default 'general'
                 check (industry in ('general','construction','food','oil_gas','maritime')),
  -- OSHA / ANSI / NFPA reference if applicable. Helps the AI cite
  -- the right standard in the generated body.
  reference    text,
  -- Soft retire — when a topic stops being relevant we flip this
  -- false instead of deleting the row (existing talks reference it).
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists idx_toolbox_topics_industry_active
  on public.toolbox_topics(industry) where active = true;

-- toolbox_topics is read-only from the app's perspective. The cron
-- uses supabaseAdmin (service-role) to read from it; tenants don't
-- query it directly. RLS denies all by default — no policy = no
-- access for authenticated/anon roles. This is the abuse-prevention
-- gate the operator asked for.
alter table public.toolbox_topics enable row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. toolbox_talks — per-tenant generated daily talks
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.toolbox_talks (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  topic_id        uuid not null references public.toolbox_topics(id),

  -- Date this talk is scheduled to be delivered. UNIQUE per
  -- (tenant_id, talk_date) — exactly one talk per tenant per day.
  -- The list page does `where talk_date = current_date` to surface
  -- "today's talk."
  talk_date       date not null,

  -- AI-generated content, snapshotted at generation time. Storing the
  -- final text means a topic edit (e.g. fixing a typo in summary)
  -- doesn't retroactively change a talk that's already been delivered
  -- and signed.
  title           text not null,
  body_markdown   text not null,
  key_points      text[] not null default '{}',
  -- 1–3 sentence supervisor cue card to hand to whoever's running
  -- the meeting — what to emphasize, what questions to ask the crew.
  delivery_notes  text,

  -- Provenance — which model produced this body, and when the cron
  -- ran. NULL model = manually inserted (shouldn't happen in v1 but
  -- the column doesn't preclude future "import a custom talk" path).
  generated_by    text,                       -- 'cron' | 'manual'
  generated_at    timestamptz not null default now(),
  ai_model        text,

  created_at      timestamptz not null default now(),

  unique (tenant_id, talk_date)
);

create index if not exists idx_toolbox_talks_tenant_date
  on public.toolbox_talks(tenant_id, talk_date desc);
create index if not exists idx_toolbox_talks_tenant_topic
  on public.toolbox_talks(tenant_id, topic_id);

alter table public.toolbox_talks enable row level security;

drop policy if exists toolbox_talks_tenant_scope on public.toolbox_talks;
create policy toolbox_talks_tenant_scope on public.toolbox_talks
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

-- ──────────────────────────────────────────────────────────────────────────
-- 3. toolbox_talk_signatures — sign-in roster
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.toolbox_talk_signatures (
  id               uuid not null primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  talk_id          uuid not null references public.toolbox_talks(id) on delete cascade,

  -- Worker identity. signer_user_id is set when the signer is the
  -- logged-in user; null when an attendee signs through a coworker's
  -- session (typed + signed-by-hand). Both modes are valid — the
  -- supervisor's session captures the whole roster.
  signer_user_id   uuid references auth.users(id),
  signer_name      text not null,
  -- Optional employee number / badge ID. Free text — crews use
  -- different formats and the field is for the audit trail, not a
  -- foreign key.
  employee_id      text,

  -- Base64-encoded PNG from the SignaturePad canvas. Stored inline
  -- (not in Supabase Storage) because (a) the payload is tiny —
  -- typically 5–15 KB compressed signatures — and (b) keeping the
  -- signature with the row simplifies the audit-trail bundle PDF
  -- (no separate fetch round-trip per attendee). For very large
  -- crews (>100 signatures/talk) consider migrating to Storage.
  signature_data   text not null,

  signed_at        timestamptz not null default now(),
  -- IP of the signer's session at sign-time. Used for the audit
  -- trail in case a worker disputes their signature later.
  signed_ip        text,

  -- Prevent double-sign by the same logged-in user on the same
  -- talk. A coworker without a user_id can sign multiple times
  -- (they'd have a different name each time anyway).
  unique (talk_id, signer_user_id)
);

create index if not exists idx_toolbox_signatures_tenant_talk
  on public.toolbox_talk_signatures(tenant_id, talk_id, signed_at desc);

alter table public.toolbox_talk_signatures enable row level security;

drop policy if exists toolbox_signatures_tenant_scope on public.toolbox_talk_signatures;
create policy toolbox_signatures_tenant_scope on public.toolbox_talk_signatures
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

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Seed: 100 General Industry topics
-- ──────────────────────────────────────────────────────────────────────────
-- Curated against OSHA 1910 subparts (PPE, walking/working surfaces,
-- hazard communication, lockout/tagout, machine guarding, electrical,
-- fire prevention, ergonomics, emergency action, materials handling).
-- Using `on conflict do nothing` is impossible here (no natural key
-- on title) so we guard the bulk insert with a not-exists check —
-- if any general topic already exists, skip the seed entirely. This
-- keeps the migration safely re-runnable.

do $seed$
begin
  if not exists (select 1 from public.toolbox_topics where industry = 'general') then
    insert into public.toolbox_topics (title, summary, industry, reference) values
    ('Slips, Trips, and Falls Prevention', 'Same-level falls cause about 25% of all workplace injury claims. Cover housekeeping, spill response, footwear, and reporting hazards immediately.', 'general', 'OSHA 1910 Subpart D'),
    ('Personal Protective Equipment Basics', 'When PPE is required, how to inspect it before each use, and what to do if it''s damaged. Reinforces that PPE is the last line of defense, not the first.', 'general', '29 CFR 1910.132'),
    ('Hazard Communication and SDS Awareness', 'How to read a Safety Data Sheet, the GHS pictograms, and where to find the SDS for every chemical on site.', 'general', '29 CFR 1910.1200'),
    ('Lockout/Tagout — Why It Saves Lives', 'Stored energy kills. Cover the six energy types, who is authorized vs. affected, and the rule of one-lock-per-worker.', 'general', '29 CFR 1910.147'),
    ('Machine Guarding Inspection', 'A guard removed for cleaning that doesn''t go back on is one of the most common amputation root causes. Inspect before every shift.', 'general', '29 CFR 1910.212'),
    ('Electrical Safety — Cords and Outlets', 'Frayed cords, overloaded strips, and wet outlets. When to take a tool out of service and tag it for repair.', 'general', '29 CFR 1910 Subpart S'),
    ('Fire Extinguisher Use — PASS Method', 'Pull, Aim, Squeeze, Sweep. When to fight vs. evacuate. The two-minute rule.', 'general', '29 CFR 1910.157'),
    ('Emergency Action Plan Refresher', 'Where the muster point is, who the floor wardens are, and the difference between an evacuation and a shelter-in-place.', 'general', '29 CFR 1910.38'),
    ('First Aid and Bloodborne Pathogen Awareness', 'Universal precautions, location of first-aid kits, and the procedure for reporting any exposure incident.', 'general', '29 CFR 1910.1030'),
    ('Hand Tool Safety', 'Right tool for the job, inspection points, and why ''cheater bars'' on wrenches break wrists every year.', 'general', '29 CFR 1910 Subpart P'),
    ('Power Tool Safety', 'GFCI use outdoors and in damp areas, kickback awareness on saws, and trigger lockout when carrying.', 'general', '29 CFR 1910.243'),
    ('Ladder Safety — 4:1 Rule', 'One foot of base for every four feet of height. Three points of contact. Never the top two rungs.', 'general', '29 CFR 1910.23'),
    ('Stairway and Walkway Hazards', 'Cluttered stairs, missing handrails, and wet treads. The duty to report a hazard is everyone''s.', 'general', '29 CFR 1910.25'),
    ('Manual Lifting and Back Safety', 'Bend at the knees, keep loads close, ask for help over 50 lbs. Why team-lift signals matter.', 'general', '29 CFR 1910 General Duty Clause'),
    ('Ergonomics at the Workstation', 'Monitor height, chair adjustment, and the 20-20-20 rule for screen breaks.', 'general', 'NIOSH Ergonomic Guidelines'),
    ('Heat Illness Prevention', 'Hydration, shade, and recognizing the early signs of heat exhaustion before it becomes heat stroke.', 'general', 'OSHA NEP CPL 03-00-024'),
    ('Cold Stress Awareness', 'Layering, frostbite vs. hypothermia signs, and the buddy system in cold work.', 'general', 'OSHA Cold Stress Guide'),
    ('Hearing Conservation and Noise', 'When earplugs vs. earmuffs, the 8-hour TWA of 85 dBA, and reporting equipment that''s gotten louder.', 'general', '29 CFR 1910.95'),
    ('Eye and Face Protection', 'Z87.1-rated eyewear, side shields, and when a face shield is required in addition to safety glasses.', 'general', '29 CFR 1910.133'),
    ('Respiratory Protection Basics', 'Fit-test status, when a dust mask is and isn''t enough, and the medical-clearance requirement.', 'general', '29 CFR 1910.134'),
    ('Foot Protection — Steel Toe vs. Composite', 'ASTM F2413 ratings, when metatarsal guards are required, and electrical-hazard footwear.', 'general', '29 CFR 1910.136'),
    ('Head Protection — Hard Hat Inspection', 'Crack inspection, expiration dates, and why stickers reduce shell strength.', 'general', '29 CFR 1910.135'),
    ('Hand Protection — Choosing the Right Glove', 'Cut levels, chemical resistance, and the rule about no gloves around rotating equipment.', 'general', '29 CFR 1910.138'),
    ('Working at Heights — Fall Protection Basics', 'The 4-foot trigger height, anchor-point ratings, and the ABCs of fall arrest.', 'general', '29 CFR 1910 Subpart D'),
    ('Scaffolding Safety', 'Daily inspection tag, the 1:4 base-to-height rule for free-standing, and proper guardrail height.', 'general', '29 CFR 1910.27'),
    ('Mobile Elevating Work Platforms', 'Pre-shift inspection, harness tie-off in boom lifts, and ground-condition assessment.', 'general', 'ANSI A92.20'),
    ('Forklift Pre-Operation Checklist', 'Daily inspection items, certification expiry, and the three-point mounting rule.', 'general', '29 CFR 1910.178'),
    ('Pedestrian-Forklift Separation', 'Designated walkways, eye contact rules, and why ''honk at every blind corner'' is non-negotiable.', 'general', '29 CFR 1910.178'),
    ('Pallet Jack Safety', 'Pull-don''t-push for control, foot position, and load stability before moving.', 'general', '29 CFR 1910.178'),
    ('Confined Space Awareness — Recognize and Refuse', 'What makes a space ''permit-required,'' and why entering one without a permit is a refusal-to-work right.', 'general', '29 CFR 1910.146'),
    ('Hot Work Permit Basics', 'Why fire watch is required 30 minutes after work stops, and the 35-foot rule for combustibles.', 'general', '29 CFR 1910.252'),
    ('Welding Fume Awareness', 'Local exhaust requirements, hexavalent chromium in stainless, and respiratory clearance.', 'general', '29 CFR 1910.252'),
    ('Compressed Gas Cylinder Handling', 'Cap on when moving, secured upright when stored, and 20-foot separation between fuel and oxygen.', 'general', '29 CFR 1910.101'),
    ('Pressurized Systems Awareness', 'Bleed-down before disconnecting, never aim a pneumatic at skin, and the ''dead-man'' principle.', 'general', '29 CFR 1910.169'),
    ('Chemical Spill Response', 'Three rings of response — secure, contain, clean. When to call HazMat and when not to.', 'general', '29 CFR 1910.120'),
    ('Eyewash and Safety Shower Inspection', '15-minute flush rule, weekly activation test, and unobstructed access within 10 seconds of the hazard.', 'general', '29 CFR 1910.151 / ANSI Z358.1'),
    ('Universal Waste Handling', 'Batteries, lamps, and aerosols — labeled containers, accumulation time limits, and manifests.', 'general', '40 CFR 273'),
    ('Walking-Working Surface Inspection', 'Standing-water, oil leaks, and damaged grating — the duty to fix vs. report depends on training.', 'general', '29 CFR 1910 Subpart D'),
    ('Storage and Stacking Safety', 'Heavy on the bottom, no overhang, and the 18-inch sprinkler clearance rule.', 'general', '29 CFR 1910.176'),
    ('Material Handling — Crane Awareness', 'Never walk under a suspended load, watch the rigger''s hand signals, and the swing-radius zone.', 'general', '29 CFR 1910.179'),
    ('Rigging and Sling Inspection', 'Daily inspection tags, working-load limits, and what kinks and broken wires mean.', 'general', 'ASME B30.9'),
    ('Battery and UPS Safety', 'Acid burns, hydrogen venting, and why eye protection is mandatory when checking electrolyte.', 'general', '29 CFR 1910.305'),
    ('Arc Flash Awareness', 'Why labels matter, the four PPE categories, and ''always assume energized'' until proven otherwise.', 'general', 'NFPA 70E'),
    ('Working Alone — Check-In Procedures', 'When the buddy-system rule applies, GPS check-in tools, and the ''dead-man'' alarm timeout.', 'general', 'OSHA General Duty Clause'),
    ('Driving for Work — Distracted Driving', 'Hands-free isn''t risk-free. The ''one-task-at-a-time'' principle behind the wheel.', 'general', 'NIOSH Motor Vehicle Safety'),
    ('Vehicle Pre-Trip Inspection', 'Tire pressure, lights, mirrors, and the 7-point pre-trip checklist.', 'general', '49 CFR 396.13'),
    ('Backing Vehicles — Spotter Use', 'Why 90% of vehicle incidents on site happen in reverse, and the GOAL principle (Get Out And Look).', 'general', 'OSHA Backing Tip Sheet'),
    ('Stop-Work Authority', 'Anyone, any time. The right to refuse unsafe work without retaliation.', 'general', 'OSHA Whistleblower Protection'),
    ('Reporting Near Misses', 'For every recordable, there are 30 near-misses. Reporting them is how the next injury is prevented.', 'general', 'OSHA Recordkeeping § 1904'),
    ('Incident Investigation Basics', 'Five-Why technique, evidence preservation, and why blame-finding never improves outcomes.', 'general', 'ANSI/ASSP Z590.3'),
    ('OSHA Recordkeeping for Workers', 'What''s recordable, why it matters, and your right to see your own form 301.', 'general', '29 CFR 1904'),
    ('Whistleblower Rights and Protections', 'You can''t be fired for reporting safety concerns. Section 11(c) and how to file.', 'general', 'OSH Act §11(c)'),
    ('Mental Health and Stigma in Construction Work', 'Suicide rates in trades are 4× the national average. Recognizing distress and the 988 lifeline.', 'general', 'NIOSH NORA Initiative'),
    ('Fatigue and Sleep Safety', 'Working 17 hours straight = 0.05 BAC equivalent. Why scheduling matters as much as PPE.', 'general', 'NIOSH Work Hours Guide'),
    ('Substance Abuse and the Job Site', 'Prescription med disclosure, fitness-for-duty, and the company EAP.', 'general', 'DOT/SAMHSA Workplace'),
    ('Workplace Violence Prevention', 'Recognizing escalation, de-escalation phrases, and the duty to report threats.', 'general', 'OSHA 3148 Guidelines'),
    ('Active Shooter — Run, Hide, Fight', 'In that order. Why the run option saves the most lives and what makes a good barricade.', 'general', 'DHS Active Shooter Guide'),
    ('Severe Weather and Lightning', '30-30 rule for lightning, sheltering during high winds, and tornado-warning vs. watch.', 'general', 'NWS / OSHA Weather'),
    ('Earthquake Drop, Cover, Hold On', 'Why doorways aren''t safe, and the post-quake hazards (gas, glass, aftershocks).', 'general', 'CDC Earthquake Guide'),
    ('Pandemic Hygiene at Work', 'Hand hygiene, the 6-foot principle, and when to stay home.', 'general', 'CDC Workplace Guidance'),
    ('Distracted Walking — Phones on Site', 'The ''heads-down'' fall risk. Designated phone zones and why no scrolling on stairs.', 'general', 'NIOSH Mobile Device Use'),
    ('Tool Tethering at Heights', 'A 4-pound wrench from 30 feet hits with 2,500 lbs of force. Why every tool above 4 feet needs a tether.', 'general', 'ANSI/ISEA 121'),
    ('Concrete and Cement Burns', 'Wet cement is caustic — pH 12+. Skin damage often shows up hours after exposure.', 'general', 'OSHA Hazard Alert SHIB'),
    ('Silica Dust Awareness', 'Respirable crystalline silica, the 50 µg/m³ PEL, and water-suppression on masonry cuts.', 'general', '29 CFR 1910.1053'),
    ('Asbestos Awareness — When to Stop Work', 'Recognizing ACM in older buildings and the duty to stop and call the abatement contractor.', 'general', '29 CFR 1910.1001'),
    ('Lead Exposure Awareness', 'Demolition, soldering, and old paint. Blood-lead monitoring and hand-washing before eating.', 'general', '29 CFR 1910.1025'),
    ('Hexavalent Chromium in Welding', 'Stainless welding releases CrVI. Local exhaust, respirator, and biological monitoring.', 'general', '29 CFR 1910.1026'),
    ('Mold and Indoor Air Quality', 'Visible mold = call facilities. Symptoms to report and why eradication isn''t a DIY task.', 'general', 'OSHA Indoor Air Quality'),
    ('Carbon Monoxide — The Silent Killer', 'Propane forklifts indoors, generator placement, and the 35 ppm 8-hour PEL.', 'general', '29 CFR 1910.1000'),
    ('Hydrogen Sulfide Awareness', 'Rotten-egg smell at 10 ppm, olfactory fatigue at 100 ppm, and IDLH at 100 ppm.', 'general', 'NIOSH H2S Guide'),
    ('Oxygen Deficiency in Enclosed Areas', 'Below 19.5% = warning. Below 16% = impaired judgment. Below 10% = unconsciousness in seconds.', 'general', '29 CFR 1910.146'),
    ('Cold Work and Frostbite Recognition', 'White, waxy skin = call medical. Re-warming should never be done with the affected worker on the job.', 'general', 'OSHA Cold Stress'),
    ('Pinch Point and Crush Hazard Awareness', 'Hands inside the bite of a roller, fingers on the closing side of a clamp. Body parts vs. moving steel never wins.', 'general', '29 CFR 1910.212'),
    ('Hot Surface and Burn Prevention', 'Steam lines, exhaust manifolds, and ovens. The 140°F line where contact = scald in 5 seconds.', 'general', 'ASTM F1060'),
    ('Cryogenic Liquid Handling', 'LN₂, LCO₂, and the rapid-expansion explosion risk. Face shields and cryogenic gloves.', 'general', 'CGA P-12'),
    ('Stored Pressure Hazards (Tanks and Lines)', 'Always assume residual pressure. Bleed-down, tag-out, and never-on-the-side rule for fittings.', 'general', '29 CFR 1910.169'),
    ('Pressure Washer Safety', 'Injection injuries from 3,000-psi spray are surgical emergencies. Never aim at skin, never leave running.', 'general', 'CPSC Pressure Washer Safety'),
    ('Abrasive Blasting Hazards', 'Silica in old sandblasting media, eye injuries, and the 8-hour Pb-paint exposure cap.', 'general', '29 CFR 1910.94'),
    ('Demolition Pre-Job Survey', 'Identify utilities, asbestos, lead, and structural integrity before the first cut.', 'general', '29 CFR 1910 Subpart T'),
    ('Excavation Pre-Entry Checks', 'Sloping, benching, or shoring above 5 feet. Daily competent-person inspection.', 'general', '29 CFR 1926.651'),
    ('Underground Utility Strikes — Call 811', 'Markings expire after 14 days. White-line your dig, hand-dig within 18 inches.', 'general', 'CGA Best Practices'),
    ('Public and Visitor Safety on Site', 'Visitor escorts, sign-in logs, and PPE for non-workers in active areas.', 'general', 'OSHA General Duty Clause'),
    ('Subcontractor Coordination', 'Pre-task safety meeting, scope-of-work review, and the ''one job, one rules'' principle.', 'general', 'OSHA Multi-Employer Citation'),
    ('Permit-Required Work — Why It Exists', 'Why a permit slows you down on purpose. The four most common permit types and what they protect.', 'general', 'OSHA General Duty Clause'),
    ('Tool and Equipment Inspection Discipline', 'Pre-shift, post-incident, and quarterly. The colored-tag system and what each color means.', 'general', '29 CFR 1910 Subpart P'),
    ('Job Hazard Analysis (JHA) — Reading One', 'Every worker should review the JHA for the task before starting. The supervisor''s sign-off doesn''t replace yours.', 'general', 'ANSI/ASSP Z590.3'),
    ('Pre-Task Planning — The Take-5', 'Five steps: check task, check tools, check site, check team, check yourself. Two minutes saves the day.', 'general', 'ANSI/ASSP Z10'),
    ('Communication and Radio Discipline', 'Clear, slow, repeat-back. Why ''10-4'' isn''t enough for permit work.', 'general', 'OSHA General Duty Clause'),
    ('Visitors, Cell Phones, and PPE on the Floor', 'When a contractor needs an escort, when phones go in the locker, and the no-PPE-no-entry rule.', 'general', '29 CFR 1910.132'),
    ('Housekeeping — The 5-Minute End-of-Shift', 'A clean job site is a safe one. Tools back, trash out, lights off.', 'general', '29 CFR 1910.22'),
    ('Smoking and Combustible Areas', 'Designated smoking areas, no smoking within 50 feet of fuel, and butt-can use.', 'general', '29 CFR 1910.1000'),
    ('Food and Drink in the Work Area', 'No eating in dust- or chemical-handling zones. Hand-washing before breaks.', 'general', '29 CFR 1910.141'),
    ('Restroom and Drinking Water Access', 'Potable water within 50 feet, restroom counts per worker, and the right to take a break.', 'general', '29 CFR 1910.141'),
    ('Recordkeeping for Workers — 300/300A/301', 'What goes on each form, the February 1 posting, and your right to a copy of your own 301.', 'general', '29 CFR 1904'),
    ('OSHA Inspection — What to Expect', 'Walkaround rights, employee interviews, and the closing conference.', 'general', 'OSHA FOM CPL 02-00-164'),
    ('Behavioral Safety — Catching Yourself', 'The ''what could go wrong'' question before every action. Why catching yourself is more powerful than being caught.', 'general', 'NIOSH PtD Initiative'),
    ('Pre-Work Stretching and Warm-Up', '5 minutes of stretching reduces strain injuries 30%. Five movements every shift.', 'general', 'NIOSH Ergo Guide'),
    ('Hydration and Break Discipline', 'A pint of water per hour in heat. Why ''pushing through'' is a leading indicator of heat stroke.', 'general', 'OSHA Heat Illness'),
    ('PPE Hygiene and Storage', 'Sweaty respirator straps, dirty hard-hat suspensions, and shared eye protection. Personal means personal.', 'general', '29 CFR 1910.132'),
    ('Site Sign-In and Accountability', 'Why the muster list is the most important document on the job. Sign in, sign out, every time.', 'general', '29 CFR 1910.38');
  end if;
end
$seed$;

notify pgrst, 'reload schema';

commit;
