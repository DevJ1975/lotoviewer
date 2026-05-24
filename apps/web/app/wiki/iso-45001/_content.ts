// Source of truth for the ISO 45001 wiki manual.
//
// This is an ORIGINAL implementation guide written in our own words. It
// is NOT a reproduction of ISO 45001:2018. ISO standards are copyright
// of the International Organization for Standardization; buying a copy
// licenses internal use, not republication. Clause numbers and short
// clause titles are factual references (the same ones the platform's
// clause map in packages/core/src/iso45001.ts already uses) — the
// surrounding explanation, checklists, and platform mapping are ours.
//
// To read the authoritative requirement text, staff should open the
// licensed PDF the company purchased from ISO/ANSI. Every clause here
// points back to it.
//
// The wiki page (./page.tsx) imports SECTIONS and renders each one via
// the shared WikiPage component. Editing protocol: change a paragraph
// here, bump MANUAL_VERSION in this file, add a CHANGELOG row in
// page.tsx, and update MANUAL_LAST_UPDATED.

export interface ManualSection {
  id:    string
  title: string
  /** Paragraphs of prose. Each renders as a `<p>` in the wiki. */
  paragraphs: string[]
  /** Optional bullet list after the paragraphs. */
  bullets?: string[]
  /** Optional references (label + canonical URL). */
  citations?: Array<{ label: string; url: string }>
  /** Optional do/don't pair shown after the bullets. */
  dodonts?: { dos: string[]; donts: string[] }
}

export const MANUAL_TITLE        = 'ISO 45001 — Occupational Health & Safety'
export const MANUAL_SUBTITLE     = 'A plain-language implementation guide to the OH&S management-system standard — clause by clause, with the records an auditor will ask for and where Soteria produces them.'
export const MANUAL_VERSION      = '1.0.0'
export const MANUAL_LAST_UPDATED = '2026-05-24'

export const SECTIONS: ManualSection[] = [
  // ────────────────────────────────────────────────────────────────
  {
    id:    'about-this-manual',
    title: 'About this manual (read first)',
    paragraphs: [
      'This is an original, plain-language guide to building and running an occupational health & safety (OH&S) management system that conforms to ISO 45001:2018. It is written to teach the intent of each requirement and to show you exactly what to do and what evidence to keep. It is not a copy of the standard.',
      'ISO 45001:2018 is a copyrighted document published by the International Organization for Standardization (ISO). Your company purchased the official text, which licenses you to use it internally — it does not permit republishing the full clause text in a wiki. When you need the exact, legally authoritative wording of a requirement, open the licensed PDF your company bought. Every clause section below tells you which clause number to look up.',
      'How to use it: read the "Structure & PDCA" section once to understand the shape of the whole standard, then work through Clauses 4 to 10 in order. Clauses 1 to 3 (scope, normative references, terms) are introductory and contain no auditable requirements. The auditable requirements begin at Clause 4.',
    ],
    citations: [
      { label: 'ISO — ISO 45001 occupational health & safety (official overview)', url: 'https://www.iso.org/iso-45001-occupational-health-and-safety.html' },
      { label: 'ISO Store — buy the official standard', url: 'https://www.iso.org/store.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'what-it-is',
    title: 'What ISO 45001 is and who needs it',
    paragraphs: [
      'ISO 45001 is the international standard for occupational health & safety management systems. It gives an organization a framework to manage the risks that can hurt or kill workers, to improve safety performance over time, and to demonstrate that improvement to regulators, clients, and insurers. It replaced the older OHSAS 18001 specification; certification to OHSAS 18001 ended in 2021.',
      'It applies to any organization regardless of size, sector, or country — a 12-person fabrication shop and a 50,000-person utility both certify against the same clauses. The standard never tells you which controls to deploy; it tells you to identify your hazards, decide on controls using the hierarchy of controls, and prove the system works. The "how" is yours; the "did you, and can you show it" is the auditor\'s.',
      'It is a voluntary standard, not a law. But clients increasingly require certification to bid on contracts, and a certified, well-run system is strong evidence of due diligence if a regulator (OSHA in the US, the HSE in the UK, etc.) ever investigates an incident. ISO 45001 and your local OSH law are complementary: the law sets the floor, the standard sets the management discipline that keeps you above it.',
    ],
    bullets: [
      'Certification is granted by an accredited third-party certification body after a two-stage audit, and is maintained by annual surveillance audits with a full recertification every three years.',
      'ISO 45001 shares its top-level structure (the "Harmonized Structure", formerly Annex SL) with ISO 14001 and ISO 9001, so a single integrated management system can satisfy all three with one set of processes.',
      'The standard is risk-based and worker-centred: two threads — risk thinking and genuine worker participation — run through every clause and are the two things first-time implementers most often under-do.',
    ],
    citations: [
      { label: 'ISO — ISO 45001 official overview', url: 'https://www.iso.org/iso-45001-occupational-health-and-safety.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'structure-pdca',
    title: 'Structure & the Plan-Do-Check-Act cycle',
    paragraphs: [
      'The standard is organized around Plan-Do-Check-Act (PDCA), a continual-improvement loop. Once you see which clauses belong to which phase, the whole document stops feeling like a list and starts feeling like a cycle you turn once a year.',
      'Clauses 1 to 3 are introductory (scope, references, definitions) and contain no requirements you are audited against. The management-system requirements live in Clauses 4 to 10, and they map cleanly onto PDCA. Every clause uses the auxiliary verb "shall" to mark a mandatory requirement — when you read the official text, treat every "shall" as a line item you must be able to evidence.',
    ],
    bullets: [
      'PLAN — Clause 4 (Context), Clause 5 (Leadership & worker participation), Clause 6 (Planning), Clause 7 (Support): understand your situation, set direction, identify hazards and legal duties, and resource the system.',
      'DO — Clause 8 (Operation): run the controls, manage change, control contractors and procurement, and prepare for emergencies.',
      'CHECK — Clause 9 (Performance evaluation): monitor and measure, evaluate legal compliance, run internal audits, and hold a management review.',
      'ACT — Clause 10 (Improvement): respond to incidents and nonconformities with corrective action, and drive continual improvement.',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-4',
    title: 'Clause 4 — Context of the organization',
    paragraphs: [
      'Clause 4 asks you to define the boundary and the inputs of your management system before you build it. You determine the external and internal issues that affect OH&S (4.1), the needs and expectations of workers and other interested parties (4.2), the documented scope of the system (4.3), and then establish the management system itself (4.4).',
      'The practical output of 4.1 and 4.2 is usually a short "context register" and an "interested-parties register": a list of the things that shape your safety risk (the work you do, the equipment, the regulatory regime, the climate, the workforce demographics) and a list of who has a stake (workers and their reps, contractors, regulators, neighbours, clients) with what each of them needs from you. These two registers feed directly into the risk and legal-requirements work in Clause 6, so keep them honest rather than aspirational.',
      'The scope statement (4.3) is a documented declaration of what the system covers — which sites, which activities, which workforce. Auditors read it first, because everything else is judged against it. A scope that quietly excludes a hazardous activity to make certification easier is a red flag and, if discovered, undermines the certificate.',
    ],
    bullets: [
      '4.1 — Determine external and internal issues relevant to OH&S and to the system\'s intended outcomes.',
      '4.2 — Determine the relevant interested parties (workers first) and which of their needs and expectations become your requirements.',
      '4.3 — Document the scope: the boundaries and applicability of the OH&S management system. This must be available as documented information.',
      '4.4 — Establish, implement, maintain and continually improve the system, including the processes and their interactions.',
    ],
    dodonts: {
      dos: [
        'Write the scope statement so a stranger could read it and know exactly which sites and activities are covered.',
        'Treat workers as the primary interested party — the standard singles them out — and capture what they actually need (safe access, training, a voice), not what is convenient to provide.',
        'Revisit the context and interested-parties registers at each management review; context drifts.',
      ],
      donts: [
        'Don\'t carve a known hazard out of the scope to pass the audit — auditors look for this and it voids the credibility of the certificate.',
        'Don\'t let the context register become a one-time box-tick; a stale register produces a stale risk assessment downstream.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-5',
    title: 'Clause 5 — Leadership & worker participation',
    paragraphs: [
      'Clause 5 is where ISO 45001 differs most sharply from a paperwork exercise. Top management must demonstrate leadership and commitment (5.1) by taking accountability themselves — not delegating it to a safety officer — and by integrating OH&S into the way the business is run. The OH&S policy (5.2) is the public commitment: it must include a commitment to provide safe and healthy working conditions, to satisfy legal and other requirements, to eliminate hazards and reduce risk, to continual improvement, and to consultation and participation of workers.',
      'Roles, responsibilities and authorities (5.3) must be assigned and communicated so everyone knows who owns what. Crucially, accountability for the effectiveness of the system itself stays with top management; it cannot be pushed entirely onto a management representative.',
      'Consultation and participation of workers (5.4) is the clause auditors probe hardest, because it is the easiest to fake. Workers (and, where they exist, their representatives) must be consulted on things like policy and hazard identification, and must actively participate in things like incident investigation and the determination of controls. The standard expects you to remove barriers to participation (language, time, fear of reprisal) — not just to "make a suggestion box available".',
    ],
    bullets: [
      '5.1 — Top management takes accountability, sets the policy and objectives, ensures resources, and directs and supports people. Leadership is visible, not delegated.',
      '5.2 — A documented OH&S policy with the five commitments (safe conditions; eliminate hazards & reduce risk; legal compliance; continual improvement; consultation & participation), communicated and available to interested parties.',
      '5.3 — Assigned, communicated, and understood roles, responsibilities, and authorities.',
      '5.4 — Real consultation and participation of workers at all levels, with barriers removed and the methods documented.',
    ],
    dodonts: {
      dos: [
        'Have top management run the management review and speak to it personally during the audit — auditors interview leaders to test 5.1.',
        'Keep records of how workers were consulted: meeting minutes, committee membership, who raised which hazard, how their input changed a control.',
        'Make the policy a real document people can find, not a framed poster nobody reads.',
      ],
      donts: [
        'Don\'t appoint a single "management representative" and assume that satisfies the leadership clause — the 2018 standard deliberately removed that role as a way to offload accountability.',
        'Don\'t confuse "informing" workers with "consulting" them; consultation means seeking their views before deciding.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-6',
    title: 'Clause 6 — Planning (hazards, risk, legal, objectives)',
    paragraphs: [
      'Clause 6 is the engine room. 6.1.1 sets the requirement to plan actions to address risks and opportunities. 6.1.2 is hazard identification and the assessment of OH&S risks and opportunities — an ongoing, proactive process that covers routine and non-routine activities, human factors, emergency situations, and changes. 6.1.3 requires you to determine and have access to the legal requirements and other requirements that apply. 6.1.4 requires you to plan actions to address all of the above and to integrate them into the management system.',
      'A core expectation woven through this clause is the hierarchy of controls: when you decide how to manage a risk you must work down the hierarchy — eliminate the hazard first, then substitute, then engineering controls, then administrative controls, and only then personal protective equipment (PPE). PPE-first thinking is the most common audit finding. Document why a higher control was not reasonably practicable before you settle on a lower one.',
      '6.2 requires OH&S objectives that are measurable (where practicable), monitored, communicated and updated — and a plan for each: what will be done, with what resources, by whom, by when, and how results will be evaluated. "Reduce recordable injuries" is an aspiration; "reduce the recordable incident rate from 3.1 to 2.5 by Q4, owner J. Doe, tracked monthly on the scorecard" is an objective.',
    ],
    bullets: [
      '6.1.2.1 — Proactive, ongoing hazard identification covering routine/non-routine work, human factors, emergencies, past incidents, and changes.',
      '6.1.2.2 — Assess OH&S risks from the identified hazards using a defined, repeatable methodology.',
      '6.1.2.3 — Identify OH&S opportunities (e.g. to improve the system or eliminate a hazard at design time), not just threats.',
      '6.1.3 — Determine, have access to, and keep current the applicable legal and other requirements.',
      '6.1.4 — Plan the actions and integrate them; choose controls using the hierarchy of controls.',
      '6.2 — Set measurable OH&S objectives and a concrete action plan (what / resources / who / when / how evaluated).',
    ],
    dodonts: {
      dos: [
        'Apply the hierarchy of controls in order and record the reasoning when you stop short of elimination.',
        'Treat hazard identification as continuous — every new task, new chemical, and change to the workplace re-triggers it.',
        'Make objectives SMART and tie each to an owner and a tracked metric.',
      ],
      donts: [
        'Don\'t default to "issue PPE and train" as the control for every hazard; that is the bottom of the hierarchy.',
        'Don\'t let the legal register go stale — a missed regulatory change becomes a compliance nonconformity at the next surveillance audit.',
      ],
    },
    citations: [
      { label: 'ISO — ISO 45001 official overview', url: 'https://www.iso.org/iso-45001-occupational-health-and-safety.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-7',
    title: 'Clause 7 — Support (resources, competence, communication, records)',
    paragraphs: [
      'Clause 7 covers the enabling infrastructure. 7.1 requires you to provide the resources needed for the system. 7.2 (competence) requires you to determine the competence needed for work that affects OH&S, ensure people are competent on the basis of education, training or experience, take action to acquire any missing competence, and retain documented evidence. 7.3 (awareness) requires workers to be aware of the policy, the hazards and risks relevant to them, their contribution to the system, and the consequences of not conforming — including their right to remove themselves from danger.',
      '7.4 (communication) requires you to decide what you will communicate, when, with whom, and how — covering internal communication across all levels and external communication as required by your legal and other requirements. 7.5 (documented information) sets the rules for the documents and records the system relies on: they must be created and updated with proper identification and format, and controlled so they are available where needed and adequately protected.',
      'In practice the strongest evidence for Clause 7 is a competence/training matrix that maps roles to required training and shows current certification status, plus a controlled document repository where the current version of each procedure is obvious and superseded versions are retained but clearly marked.',
    ],
    bullets: [
      '7.1 — Determine and provide the resources for the system.',
      '7.2 — Define required competence per role; close gaps; keep evidence (certificates, exam results, sign-offs).',
      '7.3 — Ensure workers are aware of the policy, their risks, their role, and their right to stop/remove from danger.',
      '7.4 — A planned communication process: what, when, to whom, how — internal and external.',
      '7.5 — Create, update, and control documented information (version control, access, protection, retention).',
    ],
    dodonts: {
      dos: [
        'Keep a live competence matrix with expiry dates so lapses surface before the auditor finds them.',
        'Make the current version of every procedure the one people actually reach for; archive superseded versions with a clear status.',
        'Tell workers, in writing and in onboarding, that they may remove themselves from imminent danger without penalty.',
      ],
      donts: [
        'Don\'t treat "documented information" as "more paperwork" — keep only what the system needs and control it well.',
        'Don\'t let training certificates expire silently; an out-of-date cert on a high-risk task is a finding.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-8',
    title: 'Clause 8 — Operation (controls, change, contractors, emergencies)',
    paragraphs: [
      'Clause 8 is where the plan meets the work. 8.1.1 (operational planning and control) requires you to plan, implement, control and maintain the processes needed to meet the requirements — by establishing criteria, controlling the processes against those criteria, and adapting work to workers. 8.1.2 requires controls that eliminate hazards and reduce OH&S risks using the hierarchy of controls. 8.1.3 (management of change) requires you to control planned changes — new processes, new equipment, new legal requirements, changes in knowledge — and to review the consequences of unintended changes, mitigating adverse effects.',
      '8.1.4 (procurement) requires you to control the procurement of products and services to ensure conformity, and specifically to coordinate the OH&S management of contractors and to control outsourced functions and processes. Contractor control is a frequent weak point: the standard expects you to manage the risks that arise from contractors\' activities on your site and from your activities on theirs.',
      '8.2 (emergency preparedness and response) requires you to identify potential emergencies, plan the response, test it periodically (drills), communicate it to workers and relevant interested parties, and revise it after tests and after actual events. Permit-to-work programs (lockout/tagout, confined space, hot work) are the operational controls that most directly evidence Clause 8.',
    ],
    bullets: [
      '8.1.1 — Establish operating criteria and control the work to them; adapt work to workers.',
      '8.1.2 — Implement controls using the hierarchy of controls.',
      '8.1.3 — Manage planned change and review unintended change; mitigate adverse effects.',
      '8.1.4 — Control procurement, coordinate with contractors, and govern outsourced processes.',
      '8.2 — Identify emergencies, plan and resource the response, drill it, and revise after tests and incidents.',
    ],
    dodonts: {
      dos: [
        'Run a management-of-change review before new equipment, processes, or substances go live — not after.',
        'Put contractor OH&S expectations in the contract and verify them on site, not just at prequalification.',
        'Schedule and record emergency drills, then feed the lessons back into the plan.',
      ],
      donts: [
        'Don\'t treat contractors as outside the system — their on-site activities are your operational risk.',
        'Don\'t let an emergency plan sit untested; an undrilled plan is treated by auditors as no plan.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-9',
    title: 'Clause 9 — Performance evaluation (monitor, audit, review)',
    paragraphs: [
      'Clause 9 is the "Check" of PDCA. 9.1.1 requires you to determine what needs to be monitored and measured, the methods, the criteria against which you evaluate performance, and when monitoring and analysis happen — then to evaluate OH&S performance and the effectiveness of the system and keep the evidence. 9.1.2 (evaluation of compliance) requires you to establish a process to periodically evaluate compliance with your legal and other requirements and to retain the results — knowing your compliance status is itself a requirement.',
      '9.2 (internal audit) requires a planned internal-audit program at planned intervals, conducted by objective and impartial auditors, with results reported to relevant management, and nonconformities corrected. Internal audits are how you find your own problems before the certification body does. 9.3 (management review) requires top management to review the system at planned intervals against a defined set of inputs (audit results, incidents, the status of objectives, changes in context and risk, communications from interested parties, continual-improvement opportunities) and to record decisions and actions about improvement, resource needs, and any need to change the system.',
      'A common failure here is leading vs lagging indicators. Counting injuries (a lagging indicator) is necessary but not sufficient; auditors want to see leading indicators too — inspections completed, near-misses reported, training currency, corrective actions closed on time — that predict and drive performance rather than just record it.',
    ],
    bullets: [
      '9.1.1 — Define what/how/when to monitor and measure; evaluate performance and system effectiveness; keep the evidence.',
      '9.1.2 — Periodically evaluate compliance with legal and other requirements; retain results and know your status.',
      '9.2 — Run a planned, impartial internal-audit program; report results and fix findings.',
      '9.3 — Top management reviews the system against the defined inputs and records decisions and actions.',
    ],
    dodonts: {
      dos: [
        'Track leading indicators (inspections done, near-misses reported, actions closed on time), not only injury counts.',
        'Keep internal audits genuinely independent — an auditor should not audit their own work.',
        'Minute the management review with explicit decisions, owners, and due dates.',
      ],
      donts: [
        'Don\'t hold the management review only to "discuss safety" — it must cover the defined inputs and produce recorded outputs.',
        'Don\'t skip the periodic compliance evaluation; "we assume we comply" is not evidence.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-10',
    title: 'Clause 10 — Improvement (incidents, CAPA, continual improvement)',
    paragraphs: [
      'Clause 10 is the "Act" of PDCA. 10.1 sets the requirement to determine and act on opportunities for improvement. 10.2 (incident, nonconformity and corrective action) is the operational heart of it: when an incident or nonconformity occurs you must react to control and correct it, evaluate the need to eliminate the root cause so it does not recur (including reviewing the incident, determining causes, and determining whether similar nonconformities exist elsewhere), implement the action, review its effectiveness, and update risks and the system if needed — retaining evidence of the nature of the event and the actions taken.',
      'The discipline 10.2 is really demanding is root-cause analysis with effectiveness verification. It is not enough to "retrain the operator" and close the action; you must show you found the underlying cause, acted on it, and later verified the action actually worked. A corrective action that is closed but never verified is an incomplete loop, and auditors will reopen it.',
      '10.3 (continual improvement) requires you to continually improve the suitability, adequacy and effectiveness of the system — enhancing performance, promoting worker participation, and communicating results. Continual improvement is the point of the whole standard: the certificate says not "you are perfectly safe" but "you have a working system that gets safer over time".',
    ],
    bullets: [
      '10.1 — Determine and act on improvement opportunities to meet the intended outcomes.',
      '10.2 — Investigate incidents/nonconformities, find and act on root cause, verify effectiveness, update risks, and keep records.',
      '10.3 — Continually improve the suitability, adequacy and effectiveness of the system.',
    ],
    dodonts: {
      dos: [
        'Run root-cause analysis (5 Whys, fishbone) and record it; close the corrective action only after a later effectiveness check.',
        'Ask "where else could this happen?" for every nonconformity and act across the organization, not just at the one site.',
        'Feed verified corrective actions and trends back into the risk assessment and the management review.',
      ],
      donts: [
        'Don\'t close a corrective action the day you raise it — effectiveness can only be judged after time has passed.',
        'Don\'t treat "retrain the worker" as a root cause; it is almost always a symptom-level fix.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'documented-information',
    title: 'The documented information checklist',
    paragraphs: [
      'ISO 45001 distinguishes documents you must maintain (procedures, the policy, the scope) from records you must retain (evidence that things happened). You will be asked for both during the audit. The list below is the minimum set most auditors expect to see; your system may need more depending on your risks.',
    ],
    bullets: [
      'The documented scope of the OH&S management system (4.3).',
      'The OH&S policy (5.2) and assigned roles/responsibilities (5.3).',
      'The methodology and criteria for assessing OH&S risks (6.1.2.2).',
      'The legal and other requirements register, kept current (6.1.3).',
      'OH&S objectives and the plans to achieve them (6.2).',
      'Evidence of competence — training records, certificates, exam results (7.2).',
      'Documented information required by the standard and determined as necessary, under version control (7.5).',
      'Evidence the operational controls were carried out to plan (8.1).',
      'Emergency response plans and records of drills (8.2).',
      'Monitoring/measurement results and calibration of any measuring equipment (9.1.1).',
      'Compliance-evaluation results (9.1.2).',
      'The internal-audit program and its results (9.2).',
      'Management-review inputs and the recorded outputs/decisions (9.3).',
      'Records of incidents, nonconformities, and the corrective actions taken with effectiveness checks (10.2).',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'certification-journey',
    title: 'The certification & audit journey',
    paragraphs: [
      'Certification is a third-party process, not a self-declaration. After you build and run the system for long enough to generate real records (typically three to six months minimum), an accredited certification body performs a two-stage initial audit. Stage 1 is a documentation and readiness review — the auditor checks your scope, policy, risk methodology, and whether you are ready. Stage 2 is the on-site assessment, where they sample records, interview workers and leaders, and test whether the system actually operates as documented.',
      'If you pass Stage 2 (minor nonconformities are common and are fine to close with an action plan; a major nonconformity must be cleared before the certificate issues), you receive a certificate valid for three years. During those three years the body returns for annual surveillance audits — lighter than the initial audit but enough to confirm the system is still alive — and at the end of the cycle you recertify with a fuller assessment.',
      'The most reliable way to pass is to run the system honestly for a few cycles before you invite the auditor: hold at least one management review, complete one internal-audit round, and close out a few real corrective actions. An auditor can tell within an hour whether a system is lived-in or assembled the week before.',
    ],
    bullets: [
      'Stage 1 — documentation/readiness review (often remote or a short site visit).',
      'Stage 2 — full on-site assessment with worker and leadership interviews and record sampling.',
      'Surveillance — annual lighter audits in years 1 and 2 of the cycle.',
      'Recertification — a fuller reassessment every 3 years.',
    ],
    citations: [
      { label: 'ISO — certification explained', url: 'https://www.iso.org/certification.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'platform-mapping',
    title: 'How Soteria maps to the clauses',
    paragraphs: [
      'Soteria does not certify you — only an accredited body does — but it produces and retains a large share of the documented information an auditor samples, and it pins that evidence to the clause it satisfies. The ISO 45001 clause-evidence map lives at /admin/evidence/iso45001 and is backed by the canonical clause table in packages/core/src/iso45001.ts. The mapping below shows which modules carry which clauses; see the Integrity & Compliance wiki page for the evidence-sealing and retention detail.',
    ],
    bullets: [
      'Clause 6.1.2 (hazard ID & risk) — the Risk Assessment, JHA, and Near-Miss modules; the 5×5 register and controls library.',
      'Clause 6.1.3 / 9.1.2 (legal requirements & compliance evaluation) — the Compliance Calendar and Prop 65 reviews.',
      'Clause 7.2 / 7.3 (competence & awareness) — Training Records and LOTO competency exams.',
      'Clause 7.5 (documented information) — signed/sealed PDF artifacts with chain-of-custody hashes.',
      'Clause 8.1 / 8.2 (operational control & emergencies) — LOTO, Confined Spaces, Hot Work, and Working-at-Heights permits.',
      'Clause 9.1 / 9.2 (monitoring & internal audit) — the EHS Scorecard, periodic inspections, and walkdown checklists.',
      'Clause 10.1 / 10.2 (improvement & corrective action) — Incidents and the CAPA loop with the §10.2 verifier gate.',
    ],
    citations: [
      { label: 'Soteria — ISO 45001 evidence map (live module)', url: '/admin/evidence/iso45001' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'glossary',
    title: 'Glossary of the terms auditors use',
    paragraphs: [
      'These are the recurring terms in an ISO 45001 audit, in plain language. The official definitions are in Clause 3 of the licensed standard — look there when precision matters.',
    ],
    bullets: [
      'OH&S — occupational health & safety: the conditions and factors that affect the health and safety of workers and others.',
      'Hazard — a source with the potential to cause injury or ill health. Risk — the combination of the likelihood and severity of harm from that hazard.',
      'Hierarchy of controls — the ordered preference for controls: eliminate, substitute, engineering, administrative, PPE.',
      'Interested party — anyone who can affect, be affected by, or perceive themselves to be affected by your OH&S performance; workers come first.',
      'Worker — anyone performing work under your control, including employees, contractors, and agency staff.',
      'Nonconformity — a failure to meet a requirement. Corrective action — action to eliminate the cause so it does not recur (distinct from correction, which just fixes the immediate problem).',
      'Documented information — the standard\'s umbrella term for both controlled documents and retained records.',
      'Continual improvement — recurring activity to enhance performance; the intended end-state of the whole system.',
    ],
    citations: [
      { label: 'ISO — Online Browsing Platform (free term lookups)', url: 'https://www.iso.org/obp/ui/' },
    ],
  },
]
