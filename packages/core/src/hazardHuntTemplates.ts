// Hazard Hunt — the editable "starter library" of cadence checklists. Pure data,
// no I/O, no DOM, no Node. The seed API route reads HAZARD_HUNT_TEMPLATE_LIBRARY
// and writes one `inspection_templates` row per cadence (category='hazard_hunt')
// plus one `inspection_template_items` row per item, stamping each item's
// `config` jsonb with { hazard_category, severity_hint, regulatory_ref }.
//
// Why a library, not a hard-coded schema: every site's hazards differ. This is
// the *opinionated default* a tenant is seeded with — a CSP-curated sweep of the
// OSHA 1910 + Cal/OSHA Title 8 general-industry hazards. Once instantiated, the
// rows are ordinary inspection-template rows that admins add to, prune, reweight,
// or rephrase. Treat this file as the factory preset, never as a runtime source
// of truth for an existing tenant.
//
// Cadence design (lean → deep, so the daily sweep stays fast enough to actually
// happen every shift):
//   • daily   — walk-the-floor: housekeeping, egress, PPE, tools, forklifts,
//               heat. Things that change shift-to-shift.
//   • weekly  — equipment / electrical / chemical *condition* checks that drift
//               over days: guarding, LOTO, wiring, HazCom, flammables, cylinders.
//   • monthly — program-level + lower-frequency hazards: emergency action plans,
//               respiratory/hearing/radiation programs, confined space, WVPP,
//               first aid, sanitation.
//
// Prompts are phrased so PASS = the safe/compliant condition; a failed item is
// therefore an unsafe condition and (for life-safety items) auto-creates a
// corrective action. `weight` is 1 by default and 2–3 for life-safety hazards
// (egress, LOTO, machine guarding, electrical, fall, forklift, fire, confined
// space) so the weighted score punishes the failures that can kill.

import type { HazardCategory, HazardHuntCadence, SeverityHint } from './hazardHunt'

// One inspectable line on a cadence checklist. Maps 1:1 to an
// `inspection_template_items` row; the last three fields become its `config`.
export interface HazardHuntTemplateItemSeed {
  /** Grouping header shown in the run UI, e.g. "Means of egress & exit routes". */
  section:         string
  /** Inspector-facing question, phrased so PASS = the safe/compliant condition. */
  prompt:          string
  /** Maps to the generic inspection item type. Only pass_fail_na is scored. */
  itemType:        'pass_fail_na' | 'photo' | 'text'
  /** The shared 9-category taxonomy; carried unchanged when a finding escalates. */
  hazardCategory:  HazardCategory
  /** Triage default the finding inherits before a human re-rates it. */
  severityHint:    SeverityHint
  /** 1 default; 2–3 for life-safety items so the weighted score reflects risk. */
  weight:          number
  /** true for high-consequence items: a fail auto-opens a corrective action. */
  failCreatesAction: boolean
  /** Federal + California citation(s), e.g. "29 CFR 1910.22; Cal/OSHA T8 §3273". */
  regulatoryRef:   string
}

// One cadence checklist = one `inspection_templates` row plus its items.
export interface HazardHuntTemplateSeed {
  cadence:     HazardHuntCadence
  /** Template display name, e.g. "Daily Hazard Hunt". */
  name:        string
  description: string
  items:       HazardHuntTemplateItemSeed[]
}

// ── Daily Hazard Hunt ──────────────────────────────────────────────────────────
// Lean walk-the-floor sweep. Only the hazards that genuinely change shift-to-shift
// so the hunt is short enough to run every day. ~14 items.
const DAILY_ITEMS: HazardHuntTemplateItemSeed[] = [
  // Walking-working surfaces & housekeeping — physical
  {
    section: 'Walking-working surfaces & housekeeping',
    prompt: 'Floors, aisles, and work areas are clean, dry, and free of slip, trip, and fall hazards (spills, debris, trailing cords, accumulated materials).',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.22; Cal/OSHA T8 §3273, §3380',
  },
  {
    section: 'Walking-working surfaces & housekeeping',
    prompt: 'Storage is stable and orderly, with nothing stacked so as to fall, block sprinklers (18 in clearance), or obstruct walkways.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'low',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.22; Cal/OSHA T8 §3273',
  },
  // Means of egress & exit routes — physical (life safety)
  {
    section: 'Means of egress & exit routes',
    prompt: 'Exit routes, aisles, and exit doors are unobstructed, unlocked from the inside, and clearly marked with illuminated exit signs.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.36-.37; Cal/OSHA T8 §3215-§3220',
  },
  {
    section: 'Means of egress & exit routes',
    prompt: 'Photograph any blocked, locked, or unmarked exit route observed today.',
    itemType: 'photo', hazardCategory: 'physical', severityHint: 'high',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.37; Cal/OSHA T8 §3215-§3220',
  },
  // Hand & portable powered tools — mechanical
  {
    section: 'Hand & portable powered tools',
    prompt: 'Hand and portable powered tools in use are in safe condition, with guards in place and damaged or defective tools removed from service.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'moderate',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.242; Cal/OSHA T8 §3556',
  },
  {
    section: 'Hand & portable powered tools',
    prompt: 'Powered-tool cords, plugs, and air hoses are intact (no exposed conductors, cuts, or makeshift repairs).',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.242; Cal/OSHA T8 §3556',
  },
  // Personal protective equipment — physical
  {
    section: 'Personal protective equipment',
    prompt: 'Workers are wearing the PPE required for their task (eye, hand, foot, hearing, head) and it is in serviceable condition.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.132-.138; Cal/OSHA T8 §3380-§3400',
  },
  {
    section: 'Personal protective equipment',
    prompt: 'Required PPE is available and stocked at the point of use (eyewash-adjacent goggles, glove dispensers, hearing protection at posted areas).',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'low',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.132; Cal/OSHA T8 §3380',
  },
  // Powered industrial trucks (forklifts) — mechanical (life safety)
  {
    section: 'Powered industrial trucks (forklifts)',
    prompt: 'Forklifts and powered industrial trucks in use passed their pre-shift inspection, and only trained, authorized operators are driving them.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.178; Cal/OSHA T8 §3650, §3664',
  },
  {
    section: 'Powered industrial trucks (forklifts)',
    prompt: 'Pedestrian/forklift travel paths are observed (horn use at blind corners, posted speed, no riders, forks lowered when parked).',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.178; Cal/OSHA T8 §3664',
  },
  // Ventilation / indoor air & heat illness — environmental (heat is the daily piece)
  {
    section: 'Ventilation / indoor air & heat illness',
    prompt: 'On hot days, heat-illness controls are in place where exposure exists: cool potable water, access to shade, and rest breaks available.',
    itemType: 'pass_fail_na', hazardCategory: 'environmental', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.94; Cal/OSHA T8 §3395, §5142',
  },
  {
    section: 'Ventilation / indoor air & heat illness',
    prompt: 'Local exhaust ventilation serving dusty, fume, or vapor-generating operations is running and capturing at the source.',
    itemType: 'pass_fail_na', hazardCategory: 'environmental', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.94; Cal/OSHA T8 §5142',
  },
  // A free-text capture so the daily walk records anything the fixed items miss.
  {
    section: 'Walking-working surfaces & housekeeping',
    prompt: 'Note any other unsafe condition, near-miss, or at-risk behavior observed during today’s walk.',
    itemType: 'text', hazardCategory: 'physical', severityHint: 'low',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.22; Cal/OSHA T8 §3203',
  },
  {
    section: 'Hand & portable powered tools',
    prompt: 'Guards and barriers on bench grinders, saws, and other in-use shop equipment are present and adjusted (tongue guard ≤ 1/4 in, work rest ≤ 1/8 in).',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.215; Cal/OSHA T8 §3556',
  },
]

// ── Weekly Hazard Hunt ───────────────────────────────────────────────────────
// Equipment / electrical / chemical *condition* checks that drift over days
// rather than shifts, plus the daily walk-the-floor sections at a deeper level.
// ~27 items.
const WEEKLY_ITEMS: HazardHuntTemplateItemSeed[] = [
  // Walking-working surfaces & housekeeping — physical
  {
    section: 'Walking-working surfaces & housekeeping',
    prompt: 'Floor surfaces are sound (no broken, uneven, or worn areas), and required guardrails and toe boards on platforms and open-sided floors are intact.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.22; Cal/OSHA T8 §3273, §3210',
  },
  {
    section: 'Walking-working surfaces & housekeeping',
    prompt: 'Floor markings (aisles, equipment clearances, hazard zones) are visible and accurate.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'low',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.22; Cal/OSHA T8 §3273',
  },
  // Means of egress & exit routes — physical (life safety)
  {
    section: 'Means of egress & exit routes',
    prompt: 'All required exits are usable: doors open in the direction of travel where required, hardware works, and exit-route width is maintained.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.36-.37; Cal/OSHA T8 §3215-§3220',
  },
  {
    section: 'Means of egress & exit routes',
    prompt: 'Exit signs and emergency/egress lighting are illuminated and unobstructed; non-exit doors that could be mistaken for exits are marked "Not an Exit".',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.37; Cal/OSHA T8 §3216',
  },
  // Fire protection (extinguishers/sprinklers) — physical (life safety)
  {
    section: 'Fire protection (extinguishers/sprinklers)',
    prompt: 'Portable fire extinguishers are present, mounted, fully charged, unobstructed, and within travel-distance limits for their class.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.157; Cal/OSHA T8 §6151',
  },
  {
    section: 'Fire protection (extinguishers/sprinklers)',
    prompt: 'Sprinkler heads have ≥ 18 in clearance below them and are undamaged; fire-equipment access (riser, FDC, hydrants) is clear.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.159; Cal/OSHA T8 §6151',
  },
  // Electrical safety & wiring — electrical (life safety)
  {
    section: 'Electrical safety & wiring',
    prompt: 'Electrical panels are closed, labeled, and have ≥ 36 in of unobstructed working clearance; no open knockouts or missing covers.',
    itemType: 'pass_fail_na', hazardCategory: 'electrical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.303-.305; Cal/OSHA T8 §2340',
  },
  {
    section: 'Electrical safety & wiring',
    prompt: 'No unauthorized extension cords or power strips used as permanent wiring, and no daisy-chained strips or cords run through doors, walls, or ceilings.',
    itemType: 'pass_fail_na', hazardCategory: 'electrical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.305; Cal/OSHA T8 §2395',
  },
  {
    section: 'Electrical safety & wiring',
    prompt: 'GFCI protection is provided in wet/damp locations and outdoors; junction and outlet boxes have intact covers and no exposed conductors.',
    itemType: 'pass_fail_na', hazardCategory: 'electrical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.304-.305; Cal/OSHA T8 §2395',
  },
  {
    section: 'Electrical safety & wiring',
    prompt: 'Photograph any exposed energized part, blocked panel, or improvised wiring found this week.',
    itemType: 'photo', hazardCategory: 'electrical', severityHint: 'high',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.303; Cal/OSHA T8 §2340',
  },
  // Machine guarding & point-of-operation — mechanical (life safety)
  {
    section: 'Machine guarding & point-of-operation',
    prompt: 'Point-of-operation, nip points, rotating parts, and power-transmission components are guarded; guards are secured and not bypassed.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.212/.219; Cal/OSHA T8 §4002-§4070',
  },
  {
    section: 'Machine guarding & point-of-operation',
    prompt: 'Machines are anchored where required and have functioning emergency stops within reach of the operator.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.212; Cal/OSHA T8 §4070',
  },
  {
    section: 'Machine guarding & point-of-operation',
    prompt: 'Photograph any machine running with a missing, defeated, or modified guard.',
    itemType: 'photo', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.212; Cal/OSHA T8 §4002',
  },
  // Control of hazardous energy (LOTO) — mechanical (life safety)
  {
    section: 'Control of hazardous energy (LOTO)',
    prompt: 'Energy-isolating devices on serviceable equipment are capable of being locked out, and lockout/tagout devices and a written procedure are available at the machine.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.147; Cal/OSHA T8 §3314',
  },
  {
    section: 'Control of hazardous energy (LOTO)',
    prompt: 'No equipment is found bypassed, blocked, or running with a lock/tag that does not match an authorized employee or active work order.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.147; Cal/OSHA T8 §3314',
  },
  // Hand & portable powered tools — mechanical
  {
    section: 'Hand & portable powered tools',
    prompt: 'Tool inventory is in safe condition: no mushroomed chisel heads, cracked handles, defeated guards, or out-of-service tools left in circulation.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.242; Cal/OSHA T8 §3556',
  },
  // Personal protective equipment — physical
  {
    section: 'Personal protective equipment',
    prompt: 'PPE stock is adequate and undamaged, and a current PPE hazard assessment exists for each area/task requiring it.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.132; Cal/OSHA T8 §3380',
  },
  // Hazard Communication (labels/SDS) — chemical
  {
    section: 'Hazard Communication (labels/SDS)',
    prompt: 'All hazardous-chemical containers (including secondary/transfer containers) are labeled with product identity and hazard warnings.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'moderate',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.1200; Cal/OSHA T8 §5194',
  },
  {
    section: 'Hazard Communication (labels/SDS)',
    prompt: 'Safety Data Sheets are accessible to employees for every hazardous chemical on site, and no unlabeled unknown substances are present.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.1200; Cal/OSHA T8 §5194',
  },
  // Flammable/combustible liquid storage — chemical
  {
    section: 'Flammable/combustible liquid storage',
    prompt: 'Flammable and combustible liquids are stored in approved containers/cabinets, within quantity limits, and away from ignition sources and exits.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.106; Cal/OSHA T8 §5417',
  },
  {
    section: 'Flammable/combustible liquid storage',
    prompt: 'Dispensing and transfer of flammables is bonded/grounded where required, and spill controls (absorbents, secondary containment) are in place.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'high',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.106; Cal/OSHA T8 §5417',
  },
  // Compressed gas cylinders — chemical
  {
    section: 'Compressed gas cylinders',
    prompt: 'Compressed-gas cylinders are upright, secured against falling (chain/strap), and segregated by hazard class (oxidizers from fuels).',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.101; Cal/OSHA T8 §4649-§4651',
  },
  {
    section: 'Compressed gas cylinders',
    prompt: 'Cylinder valve-protection caps are in place on cylinders not in use, and cylinders are kept away from heat and electrical-arc sources.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.101; Cal/OSHA T8 §4650',
  },
  // Ergonomics / manual material handling — ergonomic
  {
    section: 'Ergonomics / manual material handling',
    prompt: 'Manual material-handling tasks use available aids (carts, hoists, lift assists), and observed lifting/postures are within reasonable limits.',
    itemType: 'pass_fail_na', hazardCategory: 'ergonomic', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: 'OSH Act §5(a)(1); Cal/OSHA T8 §5110',
  },
  {
    section: 'Ergonomics / manual material handling',
    prompt: 'Repetitive-motion workstations are set up to reduce awkward postures (reach, height, fixturing) where a hazard has been identified.',
    itemType: 'pass_fail_na', hazardCategory: 'ergonomic', severityHint: 'low',
    weight: 1, failCreatesAction: false,
    regulatoryRef: 'OSH Act §5(a)(1); Cal/OSHA T8 §5110',
  },
  // Powered industrial trucks (forklifts) — mechanical (life safety)
  {
    section: 'Powered industrial trucks (forklifts)',
    prompt: 'Forklift charging/fueling areas are ventilated, free of ignition sources, and equipped with required spill/eyewash provisions; daily checklists are being completed.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.178; Cal/OSHA T8 §3650',
  },
  // Fall protection / working at heights — physical (life safety)
  {
    section: 'Fall protection / working at heights',
    prompt: 'Work at height ≥ 4 ft (general industry) is protected by guardrails, covers, or personal fall arrest; fall-arrest equipment in use is inspected and undamaged.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.28; Cal/OSHA T8 §3210',
  },
  {
    section: 'Fall protection / working at heights',
    prompt: 'Ladders and fixed/portable stairs are in safe condition (no damage, proper angle/extension, secured) and rated for the load and use.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.23; Cal/OSHA T8 §3210',
  },
]

// ── Monthly Hazard Hunt ──────────────────────────────────────────────────────
// Program-level governance plus the lower-frequency hazards a daily/weekly sweep
// would not surface. Folds the weekly equipment/chemical checks up to a program
// view and adds emergency-action, respiratory/hearing/radiation, confined space,
// workplace-violence, sanitation, and first-aid programs. ~36 items.
const MONTHLY_ITEMS: HazardHuntTemplateItemSeed[] = [
  // Walking-working surfaces & housekeeping — physical
  {
    section: 'Walking-working surfaces & housekeeping',
    prompt: 'Site-wide housekeeping program is effective: recurring slip/trip sources are being corrected, not just cleaned up repeatedly.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.22; Cal/OSHA T8 §3273, §3380',
  },
  // Means of egress & exit routes — physical (life safety)
  {
    section: 'Means of egress & exit routes',
    prompt: 'Occupant load, exit capacity, and travel distances remain adequate for current use; no layout/storage changes have compromised an exit route.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.36-.37; Cal/OSHA T8 §3215-§3220',
  },
  // Emergency action / fire prevention — physical (life safety)
  {
    section: 'Emergency action / fire prevention',
    prompt: 'A written Emergency Action Plan and Fire Prevention Plan are current, posted/accessible, and reflect the actual site layout and hazards.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.38-.39; Cal/OSHA T8 §3220-§3221',
  },
  {
    section: 'Emergency action / fire prevention',
    prompt: 'Emergency evacuation drills, alarm tests, and assembly-point assignments are up to date and documented.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.38; Cal/OSHA T8 §3220',
  },
  // Fire protection (extinguishers/sprinklers) — physical (life safety)
  {
    section: 'Fire protection (extinguishers/sprinklers)',
    prompt: 'Fixed fire-protection systems (sprinklers, alarms, hydrants, standpipes) have current inspection/service tags and no out-of-service impairments.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.157, .159; Cal/OSHA T8 §6151',
  },
  {
    section: 'Fire protection (extinguishers/sprinklers)',
    prompt: 'Portable extinguishers have documented monthly visual checks and current annual maintenance, with employees trained on their use.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.157; Cal/OSHA T8 §6151',
  },
  // Electrical safety & wiring — electrical (life safety)
  {
    section: 'Electrical safety & wiring',
    prompt: 'Electrical equipment shows no signs of overheating, arcing, or deterioration; identified deficiencies from prior hunts are corrected, not deferred.',
    itemType: 'pass_fail_na', hazardCategory: 'electrical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.303-.305; Cal/OSHA T8 §2340, §2395',
  },
  // Machine guarding & point-of-operation — mechanical (life safety)
  {
    section: 'Machine guarding & point-of-operation',
    prompt: 'Machine guarding is verified across all production equipment (including infrequently used machines), and guard removals are controlled by procedure.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.212/.219; Cal/OSHA T8 §4002-§4070',
  },
  // Control of hazardous energy (LOTO) — mechanical (life safety)
  {
    section: 'Control of hazardous energy (LOTO)',
    prompt: 'The energy-control (LOTO) program has machine-specific procedures, the required annual periodic inspection is current, and authorized employees are trained.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.147; Cal/OSHA T8 §3314',
  },
  // Hazard Communication (labels/SDS) — chemical
  {
    section: 'Hazard Communication (labels/SDS)',
    prompt: 'The written HazCom program, chemical inventory, and SDS library are current, and employee HazCom training covers every hazard class on site.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.1200; Cal/OSHA T8 §5194',
  },
  // Flammable/combustible liquid storage — chemical
  {
    section: 'Flammable/combustible liquid storage',
    prompt: 'Aggregate on-site quantities of flammable/combustible liquids remain within code limits, and storage rooms/cabinets meet construction and ventilation requirements.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.106; Cal/OSHA T8 §5417',
  },
  // Compressed gas cylinders — chemical
  {
    section: 'Compressed gas cylinders',
    prompt: 'Cylinder storage areas are compliant (segregation, securing, ventilation, signage), and cylinders are within hydrostatic-test and labeling requirements.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.101; Cal/OSHA T8 §4649-§4651',
  },
  // Respiratory protection program — chemical
  {
    section: 'Respiratory protection program',
    prompt: 'A written Respiratory Protection Program is in place where respirators are used, with current medical evaluations, fit tests, and training for each wearer.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.134; Cal/OSHA T8 §5144',
  },
  {
    section: 'Respiratory protection program',
    prompt: 'Respirators are stored clean and protected, cartridges/filters are within their change-out schedule, and no unauthorized respirator use is occurring.',
    itemType: 'pass_fail_na', hazardCategory: 'chemical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.134; Cal/OSHA T8 §5144',
  },
  // Bloodborne pathogens / sanitation — biological
  {
    section: 'Bloodborne pathogens / sanitation',
    prompt: 'Where occupational exposure exists, the Bloodborne Pathogens program (exposure control plan, sharps containers, PPE, HBV vaccination offer) is current.',
    itemType: 'pass_fail_na', hazardCategory: 'biological', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.1030; Cal/OSHA T8 §5193',
  },
  {
    section: 'Bloodborne pathogens / sanitation',
    prompt: 'Sanitation is maintained: potable water, clean toilet and washing facilities, and proper waste handling; no vermin/pest harborage.',
    itemType: 'pass_fail_na', hazardCategory: 'biological', severityHint: 'low',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.141; Cal/OSHA T8 §3362',
  },
  // Ergonomics / manual material handling — ergonomic
  {
    section: 'Ergonomics / manual material handling',
    prompt: 'Ergonomic risk factors flagged in prior hunts or MSD reports are being engineered out, and the ergonomics program addresses high-risk jobs.',
    itemType: 'pass_fail_na', hazardCategory: 'ergonomic', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: 'OSH Act §5(a)(1); Cal/OSHA T8 §5110',
  },
  // Powered industrial trucks (forklifts) — mechanical (life safety)
  {
    section: 'Powered industrial trucks (forklifts)',
    prompt: 'All forklift operators have current (≤ 3-year) evaluations and training, and the fleet is on a documented preventive-maintenance schedule.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.178; Cal/OSHA T8 §3650, §3664',
  },
  // Fall protection / working at heights — physical (life safety)
  {
    section: 'Fall protection / working at heights',
    prompt: 'Fall-protection program covers all routine elevated work and rooftop/equipment access; anchorage points are certified and PFAS gear is on its inspection schedule.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.28; Cal/OSHA T8 §3210',
  },
  // Confined spaces (signage/permits) — environmental (life safety)
  {
    section: 'Confined spaces (signage/permits)',
    prompt: 'Permit-required confined spaces are identified and posted with danger signs, secured against unauthorized entry, and covered by a written entry program.',
    itemType: 'pass_fail_na', hazardCategory: 'environmental', severityHint: 'extreme',
    weight: 3, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.146; Cal/OSHA T8 §5157',
  },
  {
    section: 'Confined spaces (signage/permits)',
    prompt: 'Entry equipment (gas monitors calibrated, ventilation, retrieval/rescue gear) is available and serviceable, and rescue arrangements are in place.',
    itemType: 'pass_fail_na', hazardCategory: 'environmental', severityHint: 'extreme',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.146; Cal/OSHA T8 §5157',
  },
  {
    section: 'Confined spaces (signage/permits)',
    prompt: 'Photograph each permit-required confined-space entry point and its posted danger signage.',
    itemType: 'photo', hazardCategory: 'environmental', severityHint: 'high',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.146; Cal/OSHA T8 §5157',
  },
  // Ventilation / indoor air & heat illness — environmental
  {
    section: 'Ventilation / indoor air & heat illness',
    prompt: 'Mechanical and local-exhaust ventilation systems are maintained and effective, and a written Heat Illness Prevention Plan exists where heat exposure occurs.',
    itemType: 'pass_fail_na', hazardCategory: 'environmental', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.94; Cal/OSHA T8 §5142, §3395',
  },
  // Noise / hearing conservation — physical
  {
    section: 'Noise / hearing conservation',
    prompt: 'Where noise exposure meets the action level, a Hearing Conservation Program is in place: monitoring, audiograms, hearing protection, and signage.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.95; Cal/OSHA T8 §5095-§5100',
  },
  {
    section: 'Noise / hearing conservation',
    prompt: 'High-noise areas are posted, and hearing protection with adequate attenuation is available and worn where required.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.95; Cal/OSHA T8 §5097',
  },
  // Ionizing/non-ionizing radiation — radiological
  {
    section: 'Ionizing/non-ionizing radiation',
    prompt: 'Radiation sources (X-ray, gauges, lasers, RF/UV) are inventoried, posted with the required caution signs, and access is restricted to authorized users.',
    itemType: 'pass_fail_na', hazardCategory: 'radiological', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.1096; Cal/OSHA T8 §5075-§5085',
  },
  {
    section: 'Ionizing/non-ionizing radiation',
    prompt: 'Personnel dosimetry, surveys, and interlock/shielding checks are current for sources requiring them, and exposures are within applicable limits.',
    itemType: 'pass_fail_na', hazardCategory: 'radiological', severityHint: 'high',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.1096; Cal/OSHA T8 §5075-§5085',
  },
  // Workplace violence / psychosocial — psychosocial
  {
    section: 'Workplace violence / psychosocial',
    prompt: 'A written Workplace Violence Prevention Plan (CA SB 553) is in place, the violent-incident log is maintained, and employees are trained on reporting.',
    itemType: 'pass_fail_na', hazardCategory: 'psychosocial', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: 'OSH Act §5(a)(1); Cal/OSHA T8 §3342 (WVPP, CA SB 553)',
  },
  {
    section: 'Workplace violence / psychosocial',
    prompt: 'Physical security controls (access control, lighting, panic alarms, sightlines) and de-escalation/reporting procedures address identified WPV risks.',
    itemType: 'pass_fail_na', hazardCategory: 'psychosocial', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: 'OSH Act §5(a)(1); Cal/OSHA T8 §3342',
  },
  // First aid & medical — physical
  {
    section: 'First aid & medical',
    prompt: 'Adequate first-aid supplies are available and stocked, trained first-aid responders are designated (where no infirmary is nearby), and an AED (if provided) is serviceable.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.151; Cal/OSHA T8 §3400',
  },
  {
    section: 'First aid & medical',
    prompt: 'Where employees are exposed to corrosive materials, suitable emergency eyewash and/or drench facilities are within reach, unobstructed, and functioning.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'high',
    weight: 2, failCreatesAction: true,
    regulatoryRef: '29 CFR 1910.151; Cal/OSHA T8 §5162',
  },
  // Personal protective equipment — physical
  {
    section: 'Personal protective equipment',
    prompt: 'PPE hazard assessments are reviewed and current for all areas/tasks, and specialty PPE (arc-flash, chemical, respiratory) matches the assessed hazards.',
    itemType: 'pass_fail_na', hazardCategory: 'physical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.132-.138; Cal/OSHA T8 §3380-§3400',
  },
  // Hand & portable powered tools — mechanical
  {
    section: 'Hand & portable powered tools',
    prompt: 'A documented periodic inspection of tools and powered equipment is performed, and a process exists to tag-out and repair defective tools.',
    itemType: 'pass_fail_na', hazardCategory: 'mechanical', severityHint: 'moderate',
    weight: 1, failCreatesAction: false,
    regulatoryRef: '29 CFR 1910.242; Cal/OSHA T8 §3556',
  },
  // Program-level free-text capture so the monthly review records systemic gaps.
  {
    section: 'Emergency action / fire prevention',
    prompt: 'Note any program-level gap, repeat finding, or systemic hazard trend that warrants escalation to the risk register this month.',
    itemType: 'text', hazardCategory: 'physical', severityHint: 'low',
    weight: 1, failCreatesAction: false,
    regulatoryRef: 'Cal/OSHA T8 §3203 (IIPP)',
  },
]

// The three-cadence starter library the seed route reads. Frozen as a readonly
// tuple so a consumer cannot mutate the factory preset in place; admins edit the
// instantiated DB rows, never this source.
export const HAZARD_HUNT_TEMPLATE_LIBRARY: readonly HazardHuntTemplateSeed[] = [
  {
    cadence: 'daily',
    name: 'Daily Hazard Hunt',
    description:
      'Lean walk-the-floor sweep of the hazards that change shift-to-shift: housekeeping, ' +
      'egress, PPE, tools, forklift operations, and heat illness. Built to run in minutes ' +
      'so it actually happens every day.',
    items: DAILY_ITEMS,
  },
  {
    cadence: 'weekly',
    name: 'Weekly Hazard Hunt',
    description:
      'Condition-based inspection of equipment, electrical, and chemical hazards that drift ' +
      'over days — machine guarding, lockout/tagout, wiring, fire protection, HazCom, ' +
      'flammables, compressed gas, and fall protection.',
    items: WEEKLY_ITEMS,
  },
  {
    cadence: 'monthly',
    name: 'Monthly Hazard Hunt',
    description:
      'Program-level governance review plus the lower-frequency hazards: emergency action ' +
      'and fire prevention plans, respiratory/hearing/radiation programs, confined spaces, ' +
      'workplace-violence prevention, sanitation, and first-aid/medical readiness.',
    items: MONTHLY_ITEMS,
  },
] as const
