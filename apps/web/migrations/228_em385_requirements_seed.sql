-- Migration 228: EM-385 Compliance — requirements catalog seed (both editions).
--
-- Seeds public.em385_requirements with the documents and records EM 385-1-1
-- expects a contract to keep, across all eight families. The same requirement
-- set is seeded for both the 2024 and 2014 editions via a cross join; the
-- editions differ in their `citation` reference (the chapter/section numbering
-- changed in the 2024 reorganisation). Citations here are topical references —
-- exact chapter/section numbers should be reconciled against the official
-- manual as the catalog is curated further.
--
-- `default_required = true` rows seed into every new project's register; `false`
-- rows are discipline-specific (diving, blasting, tunnelling, …) that a user
-- adds when that scope of work applies. Idempotent: on conflict (edition, code)
-- do nothing.

begin;

insert into public.em385_requirements (
  edition, category, code, title, description, citation, record_type,
  default_required, retention_rule, retention_years, renewal_interval_months,
  links_module, sort_order
)
select
  e.edition,
  r.category::text,
  r.code::text,
  r.title::text,
  r.description::text,
  format('EM 385-1-1 (%s) %s', e.edition, r.citation_suffix),
  r.record_type::text,
  r.default_required::boolean,
  r.retention_rule::text,
  r.retention_years::int,
  r.renewal_interval_months::int,
  r.links_module::text,
  r.sort_order::int
from (values ('2024'), ('2014')) as e(edition)
cross join (values
  -- ── APP & Activity Hazard Analyses ──────────────────────────────────────
  ('app_plan','APP','Accident Prevention Plan (APP)','Site-specific written APP addressing every element of the Appendix A outline; reviewed and accepted by the Government Designated Authority before work starts.','Appendix A','document',true,null,null,null,null,10),
  ('app_plan','AHA','Activity Hazard Analyses (AHAs)','One AHA per definable feature of work: work steps, anticipated hazards, controls, and the competent/qualified persons. Reviewed before the activity and when conditions change.','Appendix A / AHA','record_set',true,null,null,null,'jha',20),

  -- ── Site-specific written programs / plans (Part 11 / Appendix 5) ────────
  ('site_specific_plan','PLAN-EAP','Emergency Response & Contingency Plan','Medical, fire, severe-weather, and spill/environmental-release response, including evacuation and rescue.','App A Part 11','document',true,null,null,null,null,100),
  ('site_specific_plan','PLAN-FIRE','Fire Prevention Plan','Site fire prevention, extinguisher coverage, flammable storage, and emergency procedures.','App A Part 11','document',true,null,null,null,null,105),
  ('site_specific_plan','PLAN-HAZCOM','Hazard Communication Program','Written HazCom program with chemical inventory, labelling, SDS access, and employee training.','App A Part 11','document',true,null,null,null,'chemicals',110),
  ('site_specific_plan','PLAN-RESP','Respiratory Protection Program','Written program covering selection, fit testing, medical clearance, and maintenance.','App A Part 11','document',true,null,null,null,null,115),
  ('site_specific_plan','PLAN-HEAR','Hearing Conservation Program','Noise exposure assessment, monitoring, hearing protection, and audiometric testing.','App A Part 11','document',false,null,null,null,null,120),
  ('site_specific_plan','PLAN-IH','Exposure / Industrial Hygiene Monitoring Plan','Health-hazard control plan and exposure-monitoring strategy for the contract.','App A Part 11','document',false,null,null,null,'chemicals',125),
  ('site_specific_plan','PLAN-ABATE','Lead / Asbestos / Silica Abatement Plan','Compliance plan for regulated abatement work and respirable crystalline silica control.','App A Part 11','document',false,null,null,null,null,130),
  ('site_specific_plan','PLAN-CS','Confined Space Program','Permit-required confined space program: identification, entry procedures, atmospheric testing, and rescue.','App A Part 11','document',true,null,null,null,'confined-spaces',135),
  ('site_specific_plan','PLAN-LOTO','Hazardous Energy Control (Lockout/Tagout) Program','Written energy-control procedures, periodic inspections, and authorised-employee training.','App A Part 11','document',true,null,null,null,'loto',140),
  ('site_specific_plan','PLAN-FALL','Fall Protection & Prevention Plan','Site-specific plan addressing every fall hazard by phase, anchorage, and rescue.','App A Part 11','document',true,null,null,null,'working-at-heights',145),
  ('site_specific_plan','PLAN-EXCAV','Excavation & Trenching Plan','Protective systems, soil classification, spoil placement, access/egress, and inspection.','App A Part 11','document',false,null,null,null,null,150),
  ('site_specific_plan','PLAN-DEMO','Demolition Plan','Engineering survey and demolition sequencing, including hazardous-material handling.','App A Part 11','document',false,null,null,null,null,155),
  ('site_specific_plan','PLAN-STEEL','Steel Erection Plan','Site-specific erection plan including connection, decking, and fall protection.','App A Part 11','document',false,null,null,null,null,160),
  ('site_specific_plan','PLAN-CRANE','Crane & Rigging / Critical Lift Plan','Standard and critical lift plans: load, rigging, ground conditions, and coordination.','App A Part 11','document',false,null,null,null,null,165),
  ('site_specific_plan','PLAN-SCAFF','Scaffolding Plan','Scaffold design, erection/dismantling, and competent-person inspection scheme.','App A Part 11','document',false,null,null,null,null,170),
  ('site_specific_plan','PLAN-ELEC','Electrical Safety / Arc Flash / AEGCP','Electrical safe-work practices, arc-flash boundaries, and assured equipment grounding conductor program.','App A Part 11','document',true,null,null,null,'loto',175),
  ('site_specific_plan','PLAN-HOTWORK','Welding, Cutting & Hot Work Plan','Hot-work permit system, fire watch, and ventilation controls.','App A Part 11','document',true,null,null,null,'hot-work',180),
  ('site_specific_plan','PLAN-TRAFFIC','Traffic Control / Work Zone Plan','Internal and public traffic control, flagging, and work-zone protection.','App A Part 11','document',false,null,null,null,null,185),
  ('site_specific_plan','PLAN-HEAT','Heat & Cold Stress Prevention Plan','Acclimatisation, hydration, work/rest cycles, and monitoring.','App A Part 11','document',false,null,null,null,null,190),
  ('site_specific_plan','PLAN-DIVE','Diving Operations Plan','Dive plan and safe-practices manual for commercial diving operations.','App A Part 11','document',false,null,null,null,null,195),
  ('site_specific_plan','PLAN-MARINE','Float Plan / Working Over or Near Water','Man-overboard, life-saving equipment, and float plan for marine activities.','App A Part 11','document',false,null,null,null,null,200),
  ('site_specific_plan','PLAN-BLAST','Blasting Safety Plan','Explosives handling, storage, and accidental-discharge prevention.','App A Part 11','document',false,null,null,null,null,205),
  ('site_specific_plan','PLAN-TUNNEL','Underground Construction / Tunnelling Plan','Ventilation, gas monitoring, fire protection, and emergency rescue underground.','App A Part 11','document',false,null,null,null,null,210),
  ('site_specific_plan','PLAN-WEATHER','Severe Weather Plan','Storm, hurricane, lightning, and high-wind contingency procedures.','App A Part 11','document',false,null,null,null,null,215),
  ('site_specific_plan','PLAN-SANIT','Site Sanitation Plan','Potable water, toilets, washing facilities, and waste handling.','App A Part 11','document',false,null,null,null,null,220),
  ('site_specific_plan','PLAN-PILE','Pile Driving Plan','Pile-driving operations, equipment, and exclusion zones.','App A Part 11','document',false,null,null,null,null,225),
  ('site_specific_plan','PLAN-LAYOUT','Site Layout / Access & Haul Road Plan','Site layout, utilities, access and haul roads, and laydown areas.','App A Part 11','document',false,null,null,null,null,230),

  -- ── Forms & records ─────────────────────────────────────────────────────
  ('form_record','FORM-3394','Accident / Incident Report (ENG Form 3394)','USACE accident and near-miss reporting; immediate notification for serious mishaps.','ENG Form 3394','form',true,null,null,null,'incidents',300),
  ('form_record','FORM-OSHA300','OSHA 300 / 300A / 301 Logs','Recordable-injury logs and annual summary maintained and posted as required.','29 CFR 1904','record_set',true,'29 CFR 1904.33',5,null,'incidents',310),
  ('form_record','REC-MANHOURS','Monthly Exposure (Man-Hours) Report','Monthly contractor exposure man-hours submitted with the safety report.','Section 1','recurring',true,null,null,1,null,320),
  ('form_record','REC-DAILY','SSHO Daily Reports','Daily safety reports documenting site conditions, inspections, and corrections.','Section 1','recurring',true,null,null,null,null,330),
  ('form_record','REC-MEETINGS','Safety Meeting / Toolbox Talk Records','Records of safety meetings and pre-shift toolbox talks with attendance.','Section 1','recurring',true,null,null,null,'toolbox-talks',340),
  ('form_record','REC-PHASE','Preparatory & Initial Phase Inspection Records','Three-phase control records tying safety into definable features of work.','Section 1','record_set',true,null,null,null,null,350),
  ('form_record','REC-DEFICIENCY','Deficiency Tracking / Corrective Action Log','Log of identified deficiencies, responsible parties, and closure dates.','Section 1','record_set',true,null,null,null,null,355),
  ('form_record','REC-ORIENT','Site Safety Orientation Sign-In Roster','Roster proving each worker completed site safety orientation.','Section 1','record_set',true,null,null,null,null,360),

  -- ── Training & certification ────────────────────────────────────────────
  ('training_cert','TRN-SSHO','SSHO Qualification (EM-385 40-hr + OSHA 30-hr)','Site Safety and Health Officer qualification including the annual refresher.','Section 1','training_cert',true,null,null,12,'admin-training',400),
  ('training_cert','TRN-OSHA','OSHA 10 / 30-hr Construction Training','OSHA outreach cards for workers and supervisors.','Section 1','training_cert',true,null,null,null,'admin-training',410),
  ('training_cert','TRN-FIRSTAID','First Aid / CPR / AED Certification','Current certifications for designated first-aid providers.','Medical / First Aid','training_cert',true,null,null,24,'admin-training',420),
  ('training_cert','TRN-CRANE','Crane Operator (NCCCO) Certification','Certified crane operator credentials by crane type.','Cranes & Rigging','training_cert',false,null,null,60,'admin-training',430),
  ('training_cert','TRN-RIGGER','Rigger / Signalperson Qualification','Qualified rigger and signalperson records.','Cranes & Rigging','training_cert',false,null,null,null,'admin-training',440),
  ('training_cert','TRN-HAZWOPER','HAZWOPER 40-hr + 8-hr Refresher','Hazardous waste operations training for HTRW work.','29 CFR 1910.120','training_cert',false,null,null,12,'admin-training',450),
  ('training_cert','TRN-CS','Confined Space Entrant / Attendant / Supervisor Training','Role-based confined-space training records.','Confined Space','training_cert',false,null,null,null,'confined-spaces',460),
  ('training_cert','TRN-FALL','Fall Protection / Competent Person Training','Authorised-user and competent-person fall-protection training.','Fall Protection','training_cert',false,null,null,null,'working-at-heights',470),

  -- ── Competent / Qualified Person designations ───────────────────────────
  ('competent_person','CP-EXCAV','Excavation Competent Person','Designated competent person for excavation and trenching.','Excavation','designation',false,null,null,null,null,500),
  ('competent_person','CP-FALL','Fall Protection Competent / Qualified Person','Designated competent/qualified person for fall protection systems.','Fall Protection','designation',true,null,null,null,'working-at-heights',510),
  ('competent_person','CP-SCAFF','Scaffold Competent Person','Designated competent person for scaffold erection and inspection.','Scaffolding','designation',false,null,null,null,null,520),
  ('competent_person','CP-CS','Confined Space Entry Supervisor','Designated entry supervisor for permit-required confined spaces.','Confined Space','designation',false,null,null,null,'confined-spaces',530),
  ('competent_person','CP-CRANE','Crane / Rigging Qualified Person & Lift Director','Designated qualified person, lift director, and assembly/disassembly director.','Cranes & Rigging','designation',false,null,null,null,null,540),
  ('competent_person','CP-ELEC','Electrical Qualified Person','Designated qualified person for electrical work and energised tasks.','Electrical','designation',false,null,null,null,'loto',550),
  ('competent_person','CP-DEMO','Demolition Competent Person','Designated competent person for demolition operations.','Demolition','designation',false,null,null,null,null,560),
  ('competent_person','CP-IH','Industrial Hygiene / Health Qualified Person','Designated qualified person for industrial hygiene and health hazards.','Health & IH','designation',false,null,null,null,null,570),

  -- ── Inspections & calibration ───────────────────────────────────────────
  ('inspection','INSP-CRANE','Crane Annual Certification & Periodic Inspections','Annual certification plus frequent/periodic crane inspection records.','Cranes & Rigging','recurring',false,null,null,12,null,600),
  ('inspection','INSP-RIG','Rigging Gear Inspection','Periodic inspection of slings, shackles, and rigging hardware.','Cranes & Rigging','recurring',false,null,null,12,null,610),
  ('inspection','INSP-FALL','Fall Protection Equipment Inspection','Inspection of harnesses, lanyards, and anchorage connectors.','Fall Protection','recurring',true,null,null,12,'working-at-heights',620),
  ('inspection','INSP-FIRE','Fire Extinguisher Monthly / Annual Inspection','Monthly visual checks and annual maintenance of extinguishers.','Fire Prevention','recurring',true,null,null,1,null,630),
  ('inspection','INSP-EQUIP','Vehicle & Mechanized Equipment Inspection','Pre-use and periodic inspection of vehicles and powered equipment.','Vehicles & Equipment','recurring',true,null,null,null,'equipment-readiness',640),
  ('inspection','INSP-ELEC','Electrical / GFCI / AEGCP Testing','GFCI and assured-grounding conductor testing records.','Electrical','recurring',true,null,null,3,'loto',650),
  ('inspection','INSP-EYEWASH','Eyewash / Safety Shower Inspection','Weekly activation and annual inspection of emergency eyewash/showers.','Sanitation','recurring',false,null,null,1,null,660),
  ('inspection','CAL-GASDET','Gas Detector / Atmospheric Monitor Calibration','Calibration and bump-test records for atmospheric monitors.','Confined Space','recurring',false,null,null,1,'confined-spaces',670),
  ('inspection','INSP-LADDER','Ladder & Scaffold Inspection (Competent Person)','Competent-person inspection of ladders and scaffolds before use.','Scaffolding','recurring',true,null,null,null,null,680),

  -- ── Permits ─────────────────────────────────────────────────────────────
  ('permit','PERMIT-CS','Confined Space Entry Permits','Issued permit-required confined space entry permits.','Confined Space','record_set',false,null,null,null,'confined-spaces',700),
  ('permit','PERMIT-HOTWORK','Hot Work Permits','Issued hot-work permits with fire-watch sign-off.','Hot Work','record_set',true,null,null,null,'hot-work',710),
  ('permit','PERMIT-EXCAV','Excavation / Trench Permits','Issued excavation/trench entry permits.','Excavation','record_set',false,null,null,null,null,720),
  ('permit','PERMIT-LOTO','Energy Control (LOTO) Permits & Procedures','Applied lockout/tagout permits and equipment-specific procedures.','LOTO','record_set',true,null,null,null,'loto',730),
  ('permit','PERMIT-LIFT','Critical Lift Permits','Approved critical lift permits.','Cranes & Rigging','record_set',false,null,null,null,null,740),
  ('permit','PERMIT-DIG','Utility Locate / Dig Permits','Utility-locate confirmations and dig authorisations.','Excavation','record_set',false,null,null,null,null,750),
  ('permit','PERMIT-HEIGHT','Working at Heights Permits','Issued work-at-height permits where required.','Fall Protection','record_set',false,null,null,null,'working-at-heights',760),

  -- ── Exposure & medical (long retention) ─────────────────────────────────
  ('exposure_medical','EXP-AIR','Personal Air / Exposure Monitoring Records','Personal sampling results for airborne contaminants.','29 CFR 1910.1020','record_set',false,'29 CFR 1910.1020',30,null,'chemicals',800),
  ('exposure_medical','EXP-NOISE','Noise Dosimetry / Audiometric Records','Noise exposure and audiometric test records.','29 CFR 1910.1020','record_set',false,'29 CFR 1910.1020',30,null,null,810),
  ('exposure_medical','MED-SURV','Medical Surveillance Exam Records','Occupational medical surveillance examination records.','29 CFR 1910.1020','record_set',false,'29 CFR 1910.1020',30,null,null,820),
  ('exposure_medical','MED-RESP','Respirator Medical Clearance & Fit-Test Records','Medical clearance and qualitative/quantitative fit-test records.','29 CFR 1910.134','record_set',false,'29 CFR 1910.1020',30,null,null,830),
  ('exposure_medical','MED-FIRSTAID','First Aid / Treatment Log','Log of first-aid treatments provided on site.','Medical / First Aid','record_set',true,null,null,null,null,840),
  ('exposure_medical','EXP-HEAT','Heat Stress Monitoring Records','Environmental heat monitoring and worker-condition records.','Health & IH','record_set',false,null,null,null,null,850)
) as r(
  category, code, title, description, citation_suffix, record_type,
  default_required, retention_rule, retention_years, renewal_interval_months,
  links_module, sort_order
)
on conflict (edition, code) do nothing;

commit;
