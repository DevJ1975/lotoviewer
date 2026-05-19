// Source of truth for the Working at Heights wiki page AND for the
// AI assistant's knowledge base. The wiki page (./page.tsx) imports
// SECTIONS and renders each one via the shared WikiPage component;
// the seed script (apps/web/scripts/seed-working-at-heights-manual.mjs)
// imports the same SECTIONS and ingests them into knowledge_documents
// + knowledge_chunks so the assistant can answer questions with the
// exact same prose the operator sees on screen.
//
// Editing protocol: change a paragraph here, bump CURRENT_VERSION in
// page.tsx, add a CHANGELOG row, then re-run the seed script to push
// the updated chunks into the knowledge base (the script is
// idempotent — same sha256 = skip).

export interface ManualSection {
  id:    string
  title: string
  /** Paragraphs of prose. Each renders as a `<p>` in the wiki. */
  paragraphs: string[]
  /** Optional bullet list after the paragraphs. */
  bullets?: string[]
  /** Optional regulatory citations (label + canonical URL). */
  citations?: Array<{ label: string; url: string }>
  /** Optional do/don't pair shown after the bullets. */
  dodonts?: { dos: string[]; donts: string[] }
}

export const MANUAL_TITLE       = 'Working at Heights'
export const MANUAL_SUBTITLE    = 'Federal OSHA + Cal/OSHA fall protection — equipment, people, paperwork.'
export const MANUAL_VERSION     = '1.4.0'
export const MANUAL_LAST_UPDATED = '2026-05-19'

export const SECTIONS: ManualSection[] = [
  // ────────────────────────────────────────────────────────────────
  {
    id:    'overview',
    title: 'What this module covers',
    paragraphs: [
      'Working at Heights is the umbrella term for any task where a worker can fall and be injured. Federal OSHA cites fall protection more often than almost any other standard — Walking-Working Surfaces (Subpart D) and Fall Protection (Subpart M) regularly take the #1 and #2 spots in the annual Top 10. This module gives you the inventory, the inspections, the calculator, the permit, and the audit trail to keep your program defensible.',
      'Scope: portable ladders, fixed ladders, personal fall arrest systems (PFAS — harness, lanyard, SRL, anchor connector), engineered anchor points, aerial work platforms, roof safety zones, suspension trauma straps, and the rescue equipment needed when a fall happens. If a worker can fall from one elevation to another, this module covers it.',
      'Out of scope (covered by other modules): confined-space entry vertical rescues (Confined Spaces module), hot-work above grade (Hot Work module — but the fall protection still lives here), and crane operator suspended-personnel platforms (a separate engineering review).',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'roles',
    title: 'Three OSHA-defined people roles',
    paragraphs: [
      'Federal OSHA recognises three distinct people roles in a fall protection program. These are legal designations, not job titles — every person doing at-height work has to be one of them, and the documentation expectations differ.',
    ],
    bullets: [
      'Authorized Person — the worker doing the at-height task. Must be trained per 1910.30 (general industry) or 1926.503 (construction). Annual refresher is industry best practice; OSHA requires retraining "whenever necessary" which auditors interpret as ≤12 months.',
      'Competent Person (CP) — identifies fall hazards, has the authority to stop work and correct them, and inspects PFAS equipment annually. CP designation is task-specific (scaffold CP, fall-protection CP, excavation CP — not interchangeable). Documented certification required.',
      'Qualified Person (QP) — designs and certifies engineered anchorages and horizontal lifeline systems. Typically a licensed Professional Engineer. The QP signs off on anchor load ratings; the CP inspects them in service.',
    ],
    citations: [
      { label: '29 CFR 1910.30 (general industry training)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.30' },
      { label: '29 CFR 1926.503 (construction training)',    url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.503' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'trigger-heights',
    title: 'When fall protection is required',
    paragraphs: [
      'The height at which fall protection becomes mandatory depends on the type of work and which jurisdiction governs the site. Get this wrong and a worker is exposed or the system is overspecified — both are citations waiting to happen.',
    ],
    bullets: [
      'Federal OSHA general industry (Subpart D, 1910.28): 4 ft to an unprotected edge; 4 ft for hoist areas; established walking-working surface trigger.',
      'Federal OSHA construction (Subpart M, 1926.501): 6 ft to an unprotected edge in most cases; 10 ft for scaffolds (Subpart L); 6 ft for steel erection with the exception of connectors and decking specialists.',
      'Federal OSHA ladders (1910.23 and 1926.1053): fall protection on fixed ladders >24 ft new construction; existing fixed ladders >24 ft must have a ladder safety system or lifeline by November 18, 2036.',
      'Cal/OSHA (Title 8 §3210, §1670, §1671): 7.5 ft trigger for unprotected sides in some construction contexts — stricter than federal in those cases. Always apply the stricter rule where federal and state overlap.',
      'Aerial work platforms: PFAS required at all heights in boom-type lifts (ANSI A92.20-2022 §6.5). Scissor lifts do not require PFAS unless the worker leaves the platform — but the platform guardrails must remain intact.',
    ],
    citations: [
      { label: '29 CFR 1910.28', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.28' },
      { label: '29 CFR 1926.501', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.501' },
      { label: 'Cal/OSHA T8 §1670', url: 'https://www.dir.ca.gov/title8/1670.html' },
      { label: 'Cal/OSHA T8 §3210', url: 'https://www.dir.ca.gov/title8/3210.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'hierarchy',
    title: 'Hierarchy of controls',
    paragraphs: [
      'OSHA and ANSI Z359 both expect a hierarchy of fall protection, applied in order. Skipping a tier without documentation is the easiest way to fail an audit.',
    ],
    bullets: [
      'Eliminate — remove the at-height task entirely (do it on the ground, use a longer tool, move the work to a fab shop).',
      'Passive prevention — guardrails, parapets, covers. Best because no worker action is required to stay safe.',
      'Active prevention (restraint) — a tether short enough that the worker physically cannot reach the fall edge. No fall, no arrest forces.',
      'Active arrest — a system that catches a falling worker (harness + shock-absorbing lanyard or SRL + anchor). Last resort because it accepts that a fall will occur.',
      'Administrative controls — designated walkways, controlled access zones, safety monitors. These supplement the physical controls; they do not replace them.',
    ],
    dodonts: {
      dos: [
        'Document why you chose the tier you did. A reviewer asking "why arrest instead of restraint" needs an answer in the JHA.',
        'Re-evaluate the hierarchy every time the task layout changes. A new piece of equipment can open an elimination opportunity.',
      ],
      donts: [
        'Skip directly to PFAS because it is the easiest to issue. PFAS is the LAST resort.',
        'Mix restraint and arrest hardware. A restraint lanyard is not rated for arrest forces; using it to arrest a fall is a 50/50 fatality risk.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'portable-ladders',
    title: 'Portable ladders',
    paragraphs: [
      'Portable ladders are the most-used and most-abused at-heights equipment on any site. Type rating, condition, and setup are the three audit hot points.',
      'Type rating is the maximum combined load (worker + clothing + tools + materials) the ladder can safely support. ANSI A14 type ratings: IAA (Special Duty, 375 lbf), IA (Extra Heavy Duty, 300 lbf), I (Heavy Duty, 250 lbf), II (Medium Duty, 225 lbf), III (Light Duty, 200 lbf). Industrial sites should default to Type IA or IAA — a worker with a tool belt and PPE often exceeds 250 lbf.',
    ],
    bullets: [
      'Pre-use inspection by the user, every shift: rails for cracks, rungs for damage and grease, feet for missing rubber, spreaders for proper engagement, labels legible.',
      'Periodic inspection by the Competent Person: annually, after any exposure to fire/chemicals, after any incident, before returning a ladder from storage.',
      'Setup: 1:4 angle for extension ladders (1 ft out per 4 ft up); 3 ft of ladder above the landing; tied off at the top when used above 20 ft (Cal/OSHA §3276(b)).',
      'Three points of contact — codified in Cal/OSHA §3276(d). No carrying tools in hands; tools go on a tool belt or are hoisted separately.',
      'Top two steps of a stepladder are off-limits; spreaders fully open and locked; never use a closed stepladder as a leaning ladder.',
    ],
    citations: [
      { label: '29 CFR 1910.23 (portable ladders)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.23' },
      { label: 'Cal/OSHA T8 §3276',                 url: 'https://www.dir.ca.gov/title8/3276.html' },
      { label: 'ANSI A14.x family',                 url: 'https://www.americanladderinstitute.org/' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'fixed-ladders',
    title: 'Fixed ladders and the 2036 lifeline deadline',
    paragraphs: [
      'Federal OSHA rewrote Subpart D in 2017 to phase out cage-style fall protection on fixed ladders. The science is unambiguous: cages do not catch falls — workers tumble inside them and still hit the ground. Cages are now decorative on existing ladders and prohibited as the sole fall protection on new installations.',
      'The compliance calendar for fixed ladders over 24 ft: new ladders installed after November 18, 2018 must have a ladder safety system (rail or cable) or a personal fall arrest system from day one. Existing ladders may keep their cages until November 18, 2036, at which point they must be retrofitted with a ladder safety system or a PFAS. Every fixed ladder over 24 ft on your site needs a retrofit plan with a target date — running out the clock to 2035 is a procurement risk.',
    ],
    bullets: [
      'Annual inspection by the Competent Person — frame integrity, rung condition, anchorage corrosion, safety device function, hatch operation.',
      'Document the safety device serial number alongside the ladder record — they are inspected as a pair.',
      'Roof hatch counts: most roof access points need either a grab bar or a ladder safety device at the top to prevent the worker exiting backwards.',
    ],
    citations: [
      { label: '29 CFR 1910.28(b)(9) (fixed ladder fall protection)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.28' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'harnesses',
    title: 'Harnesses — fit, lifecycle, and the D-ring decision',
    paragraphs: [
      'A full-body harness is the only acceptable connection to a fall arrest system since 1998. Body belts were banned for fall arrest by 29 CFR 1926.502(d)(17). Despite that, body belts are still occasionally found in stockrooms — the moment you see one, condemn it.',
      'Harness D-ring placement matters: the dorsal D-ring (between the shoulder blades) is the fall-arrest connection, the sternal (chest) D-ring is for ladder climbing or rescue, the side (hip) D-rings are for work positioning, and the front-waist D-ring is for descent. Connecting a fall arrest lanyard to a side D-ring will fail the post-fall inspection.',
    ],
    bullets: [
      'Service life — manufacturer-defined, typically 5 to 10 years from date of first use OR date of manufacture if unused, whichever comes first. Track expiry per serial number; expired harnesses must be condemned even if they look fine.',
      'Fit — ANSI Z359.11 now addresses female-fit and size variations. A loose harness lets the dorsal D-ring slide down during a fall, which can fold the spine. Fit is part of the pre-use inspection.',
      'Webbing — check for cuts, abrasion, UV degradation (faded color), heat damage (glazed fibers), chemical exposure (discoloration), or burns. Any visible damage = condemn.',
      'Stitching — every stitch on every load-bearing tape. A single broken stitch can unzip under arrest load.',
      'Hardware — D-rings free of cracks/burrs, buckles function smoothly, grommets undamaged.',
      'Flame-resistant harnesses required for hot work, electrical work, and welding at height.',
    ],
    citations: [
      { label: 'ANSI Z359.11 (Body Harnesses)', url: 'https://www.assp.org/standards/standards-topics/z359-fall-protection' },
      { label: '29 CFR 1926.502(d)(17) (body belt prohibition)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.502' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'lanyards',
    title: 'Lanyards — restraint vs positioning vs arrest',
    paragraphs: [
      'Lanyards split into three categories and they are NOT interchangeable. Using a restraint lanyard to arrest a fall, or a positioning lanyard to break a fall, is a serious injury waiting to happen.',
    ],
    bullets: [
      'Restraint lanyard — short, non-elastic, no shock absorber. The worker physically cannot reach the fall edge. Cannot withstand arrest forces; using it for arrest is potentially fatal.',
      'Positioning lanyard — typically 4-6 ft, attaches to side D-rings, lets the worker lean back against a structure (rebar tying, scaffold erection). Not for arrest; the worker must also have an arrest system tied off independently.',
      'Shock-absorbing arrest lanyard — typically 6 ft, with a tear-out energy absorber that deploys on impact. After deployment the lanyard is destroyed; quarantine immediately.',
      'Twin-leg ("100% tie-off") arrest lanyard — two legs with a single shock absorber, used for transitions where the worker disconnects one leg to move past an obstruction. The other leg stays connected throughout. Required for many ironwork and structural tasks.',
      'Snap hook compatibility — every snap hook must be self-closing and self-locking with double-action gates. Roll-out (gate-side load) is a leading cause of arrested-fall injuries; the connection must be sized so the hook captor cannot ride on the gate.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'srl',
    title: 'Self-retracting lifelines (SRLs)',
    paragraphs: [
      'An SRL is a spring-loaded reel that pays out lifeline as the worker moves and locks under acceleration. SRLs are the preferred arrest device when clearance below the anchor is limited — they reduce the free-fall distance from a lanyard\'s 6 ft to typically under 2 ft.',
      'SRLs come in three ANSI classes. Class 1 SRLs lock above the worker and are typical of the older "yoyo" style. Class 2 SRLs lock at any angle — including with a leading-edge / sharp-edge variant for steel decking. Class 2 SRLs are increasingly required for any work where the lifeline could go over an edge.',
    ],
    bullets: [
      'Pre-use inspection — verify retraction (pull out 1 ft, release, must retract cleanly), verify lock (sharp tug must lock the reel), check the housing for damage, check the lifeline for cuts/fraying, check the snap hook gate function.',
      'Annual factory recertification — many manufacturers require return-to-factory after a deployment OR every 2 years OR every 5 years depending on model. Track the recertification due date per serial.',
      'Leading-edge SRLs are mandatory when the lifeline could be loaded over an edge sharper than 0.005 in (typical of structural steel). Standard SRLs will fail there.',
    ],
    citations: [
      { label: 'ANSI Z359.14 (Self-Retracting Devices)', url: 'https://www.assp.org/standards/standards-topics/z359-fall-protection' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'anchors',
    title: 'Anchor points — the foundation of every PFAS',
    paragraphs: [
      'A fall arrest system without a proven anchor is a costume. OSHA requires every anchor to be either rated at 5,000 lbf per attached worker (1910.140(c)(13)) OR designed and engineered with a 2:1 safety factor under supervision of a Qualified Person. The 5,000 lbf rule is the default — engineered systems are the way out for facilities where rated anchors aren\'t pre-installed.',
      'Anchor types divide into improvised (a structural member chosen by a Competent Person for a single task) and engineered (pre-designed, certified, drawing on file). Improvised anchors are legal but burden-of-proof falls on the CP every time. Engineered anchors are the audit-friendly path.',
    ],
    bullets: [
      'Every engineered anchor requires: drawing of record, calculated load rating, QP sign-off, installation date, annual CP inspection, 5-year recertification (or as manufacturer specifies).',
      'Pull-test verification — engineered anchors may require a static pull test to 12x the rated load on installation. Capture the test certificate.',
      'Horizontal lifeline systems are engineered anchorages with sag, dynamic load, and span-design constraints. Treat each system as an engineered structure with its own inspection regime.',
      'After any fall arrest event — the anchor must be inspected before re-use. If the engineering analysis required pull-testing, it requires re-pull-testing after any loading event.',
    ],
    citations: [
      { label: '29 CFR 1910.140(c)(13) (5,000 lbf rule)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.140' },
      { label: 'ANSI Z359.18 (Anchorage Connectors)',     url: 'https://www.assp.org/standards/standards-topics/z359-fall-protection' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clearance-calculation',
    title: 'Fall clearance — the calculation that decides the system',
    paragraphs: [
      'The trigger height ("4 ft requires fall protection") is the easy half. The harder question — and the one most programs get wrong — is whether the available clearance below the anchor allows the chosen system to arrest the fall before the worker contacts the ground or a lower level.',
      'For a shock-absorbing 6 ft lanyard: required clearance below the anchor = 6 ft lanyard + 3.5 ft deceleration distance + 1.5 ft harness stretch + 5 ft worker below the dorsal D-ring + 2 ft safety margin = ~18 ft total. If the anchor sits less than 18 ft above the next lower surface, a standard lanyard is unsafe; switch to an SRL.',
      'For a Class 1 SRL: required clearance ≈ 2 ft SRL lockup + 1.5 ft harness stretch + 5 ft worker + 2 ft safety = ~10.5 ft. This is why SRLs are preferred whenever clearance is constrained — they need roughly half the drop distance of a lanyard.',
      'Swing fall — if the anchor is offset horizontally from the worker, a fall pendulums. The worker can swing into a structure or back to ground level horizontally. Calculate the swing-fall radius as part of the clearance check; if swing brings the worker to a lower elevation, the clearance worst-case is from there, not from the worker\'s starting point.',
    ],
    bullets: [
      'Use the in-app calculator at /working-at-heights/calculator — it walks you through anchor height, lanyard vs SRL choice, swing-fall offset, and emits the required-clearance value.',
      'If no system gives positive clearance, the task cannot proceed at that location. Move the anchor, add restraint instead, or change the work plan.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'rescue-plan',
    title: 'Rescue plans — the most-cited fall violation',
    paragraphs: [
      '29 CFR 1926.502(d)(20) requires a rescue plan IN ADVANCE for every personal fall arrest task. Not "we\'ll call 911" — a written plan, with named rescuers, named equipment, named evacuation route. This is the most-cited fall protection violation year after year because most operators treat rescue as an afterthought.',
      'Suspension trauma (also called orthostatic intolerance) starts within 6 to 15 minutes of a hanging fall. Blood pools in the legs, the worker faints, and brain perfusion drops. By the time fire services arrive at most industrial sites, you are already past the safe window. The rescue plan must be self-sufficient — your own people, your own equipment, on your own clock.',
    ],
    bullets: [
      'Equipment — Rescue Descent Device (RDD), ladder, vertical lifeline rescue system, suspension trauma straps on every worker.',
      'People — named primary and backup rescuers, both trained on the specific equipment in the plan. Refresher drills at least annually.',
      'Activation — who calls 911, who deploys the rescue equipment, who tends to the suspended worker (talking to them, keeping them awake, raising their legs if possible).',
      'Self-rescue — if the worker is conscious, suspension trauma straps let them stand in the harness and relieve leg pressure. Drill this as a normal part of training.',
      'After-action — every actual rescue triggers an incident report, equipment quarantine, fit-for-duty assessment of the rescued worker, retraining for everyone exposed.',
    ],
    citations: [
      { label: '29 CFR 1926.502(d)(20)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.502' },
      { label: 'OSHA Safety and Health Information Bulletin — Suspension Trauma', url: 'https://www.osha.gov/sites/default/files/publications/shib032404.pdf' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'permits',
    title: 'Working-at-Heights Permit',
    paragraphs: [
      'The Working-at-Heights Permit is the gate that forces every other element of the program to come together for a specific task on a specific shift. It is to fall protection what the Hot Work Permit is to ignition sources and the Confined Space Permit is to atmospheres — a one-shift authorization that issues only when every prerequisite is verified.',
      'A permit is not always legally required, but it is the cheapest way to push back against the most common audit findings. Issuing the permit forces the Competent Person to confirm every prerequisite at the moment of issue; refusing to issue forces the work to fix the gap before proceeding. The permit log itself becomes part of the documentation OSHA inspectors will ask for.',
    ],
    bullets: [
      'Worker authorization current — Authorized Person training in date, including refresher within the last 12 months.',
      'Competent Person on-site for issue — the CP cannot issue from a different facility; presence matters for hazard assessment.',
      'Harness / lanyard / SRL inspected this shift — pre-use inspection logged within the last 12 hours per component used on the permit.',
      'Each component in mfg service life — service-life expiry checked per serial; expired equipment auto-rejects the permit.',
      'Anchor inspected within the annual CP window — engineered anchors with their certification dates current; improvised anchors documented in this permit.',
      'Anchor capacity adequate — 5,000 lbf per worker (default) or engineered 2:1 safety factor for the number of attached workers.',
      'Clearance calculation passed — calculator output stored on the permit so an auditor can see the math that proved the system fits the location.',
      'Rescue plan present for this location — and named rescuers verified on shift, with their equipment cached and ready.',
      'Weather hold check — wind under manufacturer limit (typically 25 mph), no lightning, no ice on walking surfaces.',
      'Skylights, leading edges, falling-object exposures identified and controlled in the work zone.',
      'JHA for the task attached — fall hazard explicitly listed with controls.',
    ],
    dodonts: {
      dos: [
        'Sign the permit on-site, not from a desk. The CP must walk the work zone with the worker before issue.',
        'Display the active permit at the worksite — paper copy on the lift, mobile copy on the worker, status-board copy at the supervisor desk.',
        'Re-issue at every shift change. Fresh pre-use inspections, fresh weather check, fresh rescue-team confirmation.',
        'Suspend the permit immediately on weather change, equipment failure, or any near-miss in the work zone.',
      ],
      donts: [
        'Issue retroactively after work has already started. A permit is a precondition, not a record.',
        'Reuse yesterday\'s permit. The conditions that justified yesterday\'s issue are not still true today.',
        'Substitute a JHA for the permit. The JHA documents hazards; the permit verifies preconditions and authorizes work.',
        'Issue without a named rescuer and verified rescue equipment. Suspension trauma starts in minutes.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'aerial-platforms',
    title: 'Aerial work platforms (AWPs)',
    paragraphs: [
      'JLG, Genie, and other AWP equipment are workplace fixtures and they have their own fall protection rules. ANSI A92.20-2022 replaced A92.5/6 and consolidated the requirements.',
    ],
    bullets: [
      'Boom-type lifts (articulating or telescoping booms) — PFAS REQUIRED at all heights, even when the basket is at ground level. The whip-acceleration of a boom in a stop can eject an unrestrained operator. PFAS anchored to the manufacturer-designated anchor inside the basket; not to the basket rail.',
      'Scissor lifts — PFAS not required by federal OSHA as long as the platform guardrails are intact and the worker remains inside. PFAS becomes required if the worker leaves the platform (e.g. to access a structure) and the platform-mounted anchor is rated for it.',
      'Operator certification — per-equipment-type training. A scissor-lift card does NOT certify boom-lift operation. Cards are typically valid 3 years; manufacturers may require shorter cycles.',
      'Daily pre-use inspection — log emergency stop, hydraulic leaks, tire condition, control function, guardrail integrity. Field-mobile QR scan into the inspection register.',
    ],
    citations: [
      { label: 'ANSI A92.20-2022 (AWP Design)', url: 'https://www.americanladderinstitute.org/' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'roof-safety',
    title: 'Roof safety and skylights',
    paragraphs: [
      'Industrial roofs are deceptively dangerous. Skylights look like solid panels but are not load-rated; falls through skylights are a top-3 fatality cause in roofing work. Cal/OSHA §3212(e) specifically requires every skylight to have a screen or a rated cover. A typical industrial skylight needs to support 200 lbf without deflecting more than the panel\'s breaking strain — most don\'t.',
      'A documented walking-surface plan for every roof: designated paths (yellow paint or markers), leading edges (warning lines 6 ft from the edge), skylights flagged with covers or guardrails, controlled access zones for non-routine work, designated areas for break/storage.',
    ],
    bullets: [
      'Pre-work skylight inspection — every skylight visible from the work zone tagged and verified for cover/screen presence.',
      'Roof Access Permit — many facilities issue a permit just to GO on the roof, separate from any at-height work permit.',
      'Snow / wet conditions add slip hazards on top of fall hazards. Combination of the two is the leading cause of weather-related roof fatalities.',
    ],
    citations: [
      { label: 'Cal/OSHA T8 §3212', url: 'https://www.dir.ca.gov/title8/3212.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'inspections',
    title: 'Inspection cycles — pre-use, periodic, post-event',
    paragraphs: [
      'Every piece of fall protection equipment lives on three inspection cycles. Confuse them and you fail the audit.',
    ],
    bullets: [
      'Pre-use — the WORKER, every time the equipment is used. Sub-30-second visual check via QR scan: webbing intact, hardware functional, labels legible, date stamps in service. Photo capture for any concern. Failed pre-use = quarantine on the spot.',
      'Periodic — the COMPETENT PERSON, annually at minimum. Detailed inspection covering every stitching panel, every grommet, every D-ring. Documented sign-off, photo of serial label, photo of any noted condition. Per-component logged.',
      'Post-event — anytime equipment is exposed to fire, chemicals, heat (welding sparks), unusual loading, or an actual fall arrest. CP inspection BEFORE return to service. If the event involved deployment of a shock absorber, the lanyard is permanently dead.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'quarantine',
    title: 'Quarantine and condemnation',
    paragraphs: [
      'When equipment fails an inspection it has to come out of service immediately AND be documented. The single most common audit finding after rescue-plan gaps is condemned equipment being found back in service because the field never got the word.',
    ],
    bullets: [
      'Tag — physical red tag or visible quarantine zip-tie applied at the point of failure, not later from the stockroom.',
      'Remove — the item goes to the quarantine cage, NOT back to the toolroom shelf. Same physical access controls as condemned hard hats.',
      'Record — quarantine entered in the inventory with reason, photo of condition, inspector, date.',
      'Destroy — if condemned, the equipment is cut/cut-up so it cannot accidentally return to service. Photo the destroyed state, attach to the record.',
      'Replace — purchasing trigger so the field crew doesn\'t go without. Some sites carry a 1.2x buffer specifically to allow inspection failures to ripple without operational impact.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'training',
    title: 'Training requirements',
    paragraphs: [
      '29 CFR 1910.30 (general industry) and 1926.503 (construction) describe the training every Authorized Person needs before working at height. The standards are written in terms of what the worker must DEMONSTRATE, not how many classroom hours — a paper certificate without practical observation is insufficient.',
    ],
    bullets: [
      'Recognise fall hazards in the work area.',
      'Use, inspect, and don the assigned PFAS (harness donning is a hands-on demonstration).',
      'Use ladders and stairways correctly, including the 3-points-of-contact rule.',
      'Identify the rescue plan applicable to the task and self-rescue with suspension trauma straps.',
      'Recognise weather and condition holds.',
      'Refresher — annually as best practice, ALWAYS after an incident, ALWAYS when equipment or procedure changes, ALWAYS when the worker exhibits a competency gap.',
    ],
    citations: [
      { label: '29 CFR 1910.30', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.30' },
      { label: '29 CFR 1926.503', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.503' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'contractors',
    title: 'Sub-contractor fall protection',
    paragraphs: [
      'Roofers, painters, antenna techs, window washers, HVAC contractors — most facilities have more at-height work done by sub-contractors than by their own crews. The host employer is on the hook for the contractor\'s fall protection program; document accordingly.',
    ],
    bullets: [
      'Prequalification — gate every at-height contractor on evidence of: written fall protection plan, named Competent Person, training records for the assigned crew, equipment inspection logs, insurance covering at-height claims.',
      'Project-specific JHA — the contractor\'s JHA for the specific task on your site, reviewed by your CP before work starts.',
      'Daily check-in — contractor\'s crew confirmed on the daily roster; their equipment shown to be in date.',
      'Joint audits — periodic walk-arounds with the contractor\'s CP to surface program drift early.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'incident-response',
    title: 'After a fall',
    paragraphs: [
      'Falls are the leading cause of construction fatalities and a top-3 cause across general industry. Every fall — even one without injury — triggers a workflow.',
    ],
    bullets: [
      'Medical — every fallen worker is medically evaluated, even if they appear uninjured. Suspension trauma can present hours later.',
      'Equipment — every component involved is quarantined immediately. A deployed shock-absorbing lanyard is permanently dead; the anchor and harness need CP inspection before re-use.',
      'Anchor — engineered anchors need a re-inspection AND potentially a re-pull-test (per engineering documentation).',
      'Investigation — full incident investigation per the Incident Reporting module. Root cause, contributing factors, CAPA.',
      'Retraining — everyone exposed to the same hazard pattern gets refresher training before resuming similar work.',
      'Notify — Cal/OSHA reportable serious injury or fatality within 8 hours (Title 8 §342). Federal OSHA reportable fatality within 8 hours and any in-patient hospitalisation/amputation/loss-of-eye within 24 hours (1904.39).',
    ],
    citations: [
      { label: '29 CFR 1904.39 (federal reporting)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1904/1904.39' },
      { label: 'Cal/OSHA T8 §342 (state reporting)', url: 'https://www.dir.ca.gov/title8/342.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'documentation',
    title: 'Documentation an OSHA inspector will ask for',
    paragraphs: [
      'When Cal/OSHA or federal OSHA shows up — for a complaint, a planned inspection, or after an incident — the records below are what keeps the program defensible. If you can produce all of these within the same business day, you are in the top quartile of programs.',
    ],
    bullets: [
      'Written fall protection plan (per task or per location, depending on facility complexity).',
      'Training records for every Authorized Person, with skill demonstrations and refresher dates.',
      'Competent Person designations with scope, training certificate, and signed scope-of-authority memo.',
      'Equipment inventory with per-serial inspection history (pre-use + periodic).',
      'Engineered anchor documentation: drawings, QP sign-off, pull-test certificates, annual inspections.',
      'Rescue plans per location or per task class.',
      'Permit log if you issue Work-at-Heights Permits.',
      'Incident reports for every fall (arrested or not), with CAPA and follow-up training records.',
      'Sub-contractor prequalification packets.',
      'Drift audit history — quarantine log, condemnation log, equipment turnover.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'faq',
    title: 'Frequently asked questions',
    paragraphs: [
      'These are the questions our customers ask us most often. The assistant in this module can also answer ad-hoc questions referencing this manual plus the cited OSHA and Cal/OSHA standards.',
    ],
    bullets: [
      'Q: We use a stepladder occasionally to reach 8 ft shelves. Do workers need fall protection? A: Federal OSHA general industry triggers at 4 ft to an unprotected edge — but a stepladder is a controlled work surface, not an unprotected edge. PFAS is not required for stepladder use; what IS required is competent ladder use, 3-points-of-contact, no top-two-step use, and a daily pre-use inspection.',
      'Q: A new contractor is coming next week to install rooftop HVAC. What do we owe them? A: A copy of your facility\'s fall protection plan, the names and contact info for your CP, identification of every fixed anchor available to them (with inspection records), and a documented walk-through of skylights and roof hazard zones.',
      'Q: Can I keep the cage on my fixed ladder past 2036? A: No. Existing fixed ladders over 24 ft must have either a ladder safety system (rail or cable) or PFAS by November 18, 2036. Cage-only is non-compliant after that date regardless of when the ladder was installed.',
      'Q: Our anchor is rated for 5,000 lbf. Two workers tied off to it — is that legal? A: Only if it\'s rated for 5,000 lbf PER WORKER (i.e. 10,000 lbf for two), OR if a Qualified Person engineered it with a 2:1 safety factor for two-person use. The default 5,000 lbf rating applies to single-person attachment.',
      'Q: How do I know if my lanyard needs an SRL instead? A: Run the clearance calculator. If the available clearance below the anchor is less than ~18 ft, a standard 6-ft shock-absorbing lanyard cannot safely arrest a fall; switch to an SRL.',
      'Q: One of our harnesses is past its 5-year service life but looks brand new. Can we keep using it? A: No. Manufacturer service life is binding regardless of visual condition. Condemn and replace.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'glossary',
    title: 'Glossary',
    paragraphs: [
      'Common terms used throughout the manual and the module UI.',
    ],
    bullets: [
      'Anchor — the structural attachment point for a PFAS. Rated ≥5,000 lbf per worker or engineered with a 2:1 safety factor.',
      'Arrest force — the peak force a falling worker experiences when the lanyard deploys; OSHA caps this at 1,800 lbf on the body.',
      'Authorized Person — a worker trained to perform at-height work per 1910.30 / 1926.503.',
      'Class 1 / Class 2 SRL — ANSI Z359.14 classes; Class 2 supports loading at any angle including leading edges.',
      'Competent Person (CP) — capable of identifying hazards and with authority to correct them; the equipment inspector and permit issuer.',
      'Deceleration distance — typically 3.5 ft for a shock-absorbing lanyard; the stopping distance after the absorber deploys.',
      'D-ring — the load-bearing connection point on a harness; dorsal (back) for arrest, sternal (chest) for climbing/rescue, side (hips) for positioning, front waist for descent.',
      'Fall clearance — the distance below the anchor the worker needs before the arrest system completes; if insufficient, the system is unsafe.',
      'Free fall distance — the distance the worker falls before the arrest system engages; OSHA caps this at 6 ft for general industry.',
      'PFAS — Personal Fall Arrest System (harness + lanyard or SRL + anchor connector).',
      'Qualified Person (QP) — typically a PE; designs and certifies engineered anchorages.',
      'Restraint — a system that keeps the worker from reaching the fall edge; no fall, no arrest forces.',
      'SRL — Self-Retracting Lifeline; a reel-style arrest device with rapid lockup and shorter clearance requirements than a lanyard.',
      'Suspension trauma — the medical syndrome of blood pooling in the legs of a worker hanging in a harness; lethal within 6-15 minutes if untreated.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'strike-training',
    title: 'STRIKE microlearning topics',
    paragraphs: [
      'The STRIKE module ships with a curated set of 60-to-90-second microlearning lessons tied to high-risk tasks. Working at Heights has a dedicated track of STRIKE lessons that an Authorized Person can complete on their phone before donning the harness on the day of the task. These lessons are NOT a replacement for the formal 1910.30 / 1926.503 training — they are task-specific refreshers that the CP can require as part of the permit pre-issue checklist.',
      'STRIKE delivery on this module includes per-lesson completion tracking against the worker\'s record, so a permit issuer can see at a glance whether the worker has reviewed the relevant lessons in the last 30 days. Lessons can also be triggered by the inspection flow: a worker who flagged a concern on a harness pre-use inspection is prompted to complete the "Harness inspection — what to look for" lesson before next use.',
    ],
    bullets: [
      'Harness donning — the four points of contact, dorsal D-ring position, strap snugness, sub-pelvic fit.',
      'Harness pre-use inspection — webbing, stitching, hardware, labels, expiry dates.',
      'Lanyard vs SRL — when to use which, with the clearance calculation worked example.',
      'Snap hook compatibility — gate roll-out, captor / gate sizing, double-action verification.',
      'Anchor selection — engineered vs improvised, the 5,000 lbf rule, the 2:1 engineered alternative.',
      'Three points of contact — the cardinal ladder rule, with grease/glove failure modes.',
      'Ladder type ratings — IAA / IA / I / II / III load capacities and the industrial default.',
      'Suspension trauma and self-rescue — using trauma straps in the harness, signs of orthostatic intolerance.',
      'Rescue plan activation — who calls 911, who deploys equipment, where the rescue cache is staged.',
      'AWP boom vs scissor — when PFAS is required and to what anchor.',
      'Roof skylight awareness — covers, screens, walking-path discipline.',
      'After a fall — the immediate quarantine of equipment, the no-self-medical-check rule.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'related-modules',
    title: 'Related modules',
    paragraphs: [
      'Working at Heights touches almost every other safety surface in the platform. The deepest integrations:',
    ],
    bullets: [
      'JHA — every at-height task should have a Job Hazard Analysis with the fall protection section completed. The JHA wizard auto-populates the height trigger and rescue plan link.',
      'Risk Assessment — fall hazards belong in the risk register with their barriers (training, PPE, rescue) mapped against threats (slip, equipment failure, anchor failure).',
      'Incident Reporting — every fall is a reportable incident; severity drives the OSHA notification window.',
      'BBS Observations — the "Improper fall protection use" category is a leading indicator long before an actual fall.',
      'Toolbox Talks — at-height refresher talks should rotate through the inspection topics in this manual.',
      'STRIKE — task-specific microlearning lessons (see the STRIKE Topics section above). Completion of relevant STRIKE lessons can be a pre-condition for permit issuance.',
      'Training Records — the Authorized / Competent / Qualified Person designations are tracked as training records with expiry dates.',
      'Contractors — vendor prequal gates contractor fall protection programs.',
      'Compliance Bundle — fall protection records package into the auditor-ready PDF.',
    ],
  },
]
