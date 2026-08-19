// Source of truth for the ISO 14001 wiki manual.
//
// This is an ORIGINAL implementation guide written in our own words. It
// is NOT a reproduction of ISO 14001:2015. ISO standards are copyright
// of the International Organization for Standardization; buying a copy
// licenses internal use, not republication. Clause numbers and short
// clause titles are factual references — the surrounding explanation,
// checklists, and platform mapping are ours.
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

export const MANUAL_TITLE        = 'ISO 14001 — Environmental Management'
export const MANUAL_SUBTITLE     = 'A plain-language implementation guide to the environmental management-system standard — clause by clause, with the records an auditor will ask for and where Soteria produces them.'
export const MANUAL_VERSION      = '1.1.0'
export const MANUAL_LAST_UPDATED = '2026-08-19'

export const SECTIONS: ManualSection[] = [
  // ────────────────────────────────────────────────────────────────
  {
    id:    'about-this-manual',
    title: 'About this manual (read first)',
    paragraphs: [
      'This is an original, plain-language guide to building and running an environmental management system (EMS) that conforms to ISO 14001:2015. It teaches the intent of each requirement and shows you what to do and what evidence to keep. It is not a copy of the standard.',
      'ISO 14001:2015 is a copyrighted document published by the International Organization for Standardization (ISO). Your company purchased the official text, which licenses you to use it internally — it does not permit republishing the full clause text in a wiki. When you need the exact, legally authoritative wording, open the licensed PDF your company bought. Every clause section below tells you which clause number to look up.',
      'ISO 14001 shares its top-level structure with ISO 45001 and ISO 9001, so if you have read the ISO 45001 manual the shape will be familiar — the same Clauses 4 to 10, the same Plan-Do-Check-Act loop. The content differs: where 45001 manages risk to workers, 14001 manages your interaction with the environment.',
    ],
    citations: [
      { label: 'ISO — ISO 14001 environmental management (official overview)', url: 'https://www.iso.org/iso-14001-environmental-management.html' },
      { label: 'ISO Store — buy the official standard', url: 'https://www.iso.org/store.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'what-it-is',
    title: 'What ISO 14001 is and who needs it',
    paragraphs: [
      'ISO 14001 is the international standard for environmental management systems. It gives an organization a framework to manage its environmental responsibilities systematically — to control its impact on air, water, land, and resources, to meet its compliance obligations, and to improve environmental performance over time. It is the most widely used environmental management standard in the world.',
      'Like ISO 45001, it applies to any organization regardless of size, sector, or country, and it never prescribes specific performance levels (it does not tell you a maximum emissions figure). Instead it requires you to identify how your activities, products, and services interact with the environment, decide which interactions are significant, control them, and demonstrate improvement. The "what counts as significant" and the "how you control it" are yours to define; the discipline and the evidence are the auditor\'s concern.',
      'It is voluntary, but it is frequently required in supply chains and public procurement, and a certified EMS is strong evidence of environmental due diligence to regulators, investors, and insurers. The 2015 revision aligned it with the Harmonized Structure, strengthened the role of leadership, and introduced two ideas first-time implementers most often miss: the life-cycle perspective and the requirement to protect the environment proactively (not merely prevent pollution).',
    ],
    bullets: [
      'Certification is granted by an accredited third-party certification body after a two-stage audit and maintained by annual surveillance audits, with full recertification every three years.',
      'The 2015 revision broadened the environmental commitment from "prevention of pollution" to "protection of the environment", which can include sustainable resource use, climate-change mitigation and adaptation, and protection of biodiversity where relevant to your context.',
      'Two threads run through every clause: the environmental aspects/impacts analysis (the 14001 analogue of hazard identification) and compliance obligations (legal plus voluntary requirements you subscribe to).',
    ],
    citations: [
      { label: 'ISO — ISO 14001 official overview', url: 'https://www.iso.org/iso-14001-environmental-management.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'structure-pdca',
    title: 'Structure & the Plan-Do-Check-Act cycle',
    paragraphs: [
      'ISO 14001 is organized around Plan-Do-Check-Act (PDCA), the same continual-improvement loop as ISO 45001. Clauses 1 to 3 are introductory (scope, references, terms) and contain no auditable requirements. The requirements live in Clauses 4 to 10, and every "shall" in the official text marks a mandatory line item you must be able to evidence.',
      'Because the structure is shared with ISO 45001 and ISO 9001, many organizations run a single integrated management system: one context analysis, one internal-audit program, one management review covering safety, environment, and quality together. The clause numbers line up, so an integrated system is far less work than three parallel ones.',
    ],
    bullets: [
      'PLAN — Clause 4 (Context), Clause 5 (Leadership), Clause 6 (Planning — environmental aspects, compliance obligations, objectives), Clause 7 (Support).',
      'DO — Clause 8 (Operation — operational control with a life-cycle perspective, and emergency preparedness).',
      'CHECK — Clause 9 (Performance evaluation — monitoring, compliance evaluation, internal audit, management review).',
      'ACT — Clause 10 (Improvement — nonconformity, corrective action, continual improvement).',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-4',
    title: 'Clause 4 — Context of the organization',
    paragraphs: [
      'Clause 4 defines the boundary and inputs of the EMS. You determine external and internal issues relevant to your environmental purpose, including the environmental conditions you affect or are affected by (4.1); the interested parties and which of their needs become your compliance obligations (4.2); the documented scope of the EMS (4.3); and then establish the system itself (4.4).',
      'A distinctive 14001 point in 4.1 is that "environmental conditions" cut both ways: you consider the conditions your organization can affect (your discharges, your waste) and the conditions that can affect you (water scarcity, flood risk, a contaminated site you inherited). This two-way view feeds the aspects analysis in Clause 6.',
      'The scope statement (4.3) must be documented and must be available to interested parties. As in 45001, it is the first thing the auditor reads and the thing everything else is judged against; an honest scope that includes your material environmental activities is non-negotiable.',
    ],
    bullets: [
      '4.1 — Determine external/internal issues, including environmental conditions you affect and that affect you.',
      '4.2 — Determine interested parties and which of their needs/expectations become compliance obligations.',
      '4.3 — Document the EMS scope; make it available to interested parties.',
      '4.4 — Establish, implement, maintain and continually improve the EMS and its processes.',
    ],
    dodonts: {
      dos: [
        'Capture environmental conditions in both directions — your effect on the environment and its effect on you.',
        'Write a scope statement that a regulator could read and recognise as covering your real footprint.',
        'Refresh the context register at each management review; environmental context (regulation, climate, community concern) moves quickly.',
      ],
      donts: [
        'Don\'t narrow the scope to exclude a material environmental aspect to ease certification.',
        'Don\'t treat interested parties as box-ticking — community and regulator expectations frequently become compliance obligations.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-5',
    title: 'Clause 5 — Leadership',
    paragraphs: [
      'Top management must demonstrate leadership and commitment to the EMS (5.1) by taking accountability for its effectiveness, ensuring the policy and objectives are set and compatible with the strategic direction, integrating EMS requirements into business processes, and ensuring resources. As in 45001, leadership is something leaders do visibly — it is not delegated to an environmental manager.',
      'The environmental policy (5.2) must include three commitments: protection of the environment (which can extend beyond prevention of pollution to context-specific commitments like sustainable resource use or climate-change mitigation), fulfilment of compliance obligations, and continual improvement of the EMS to enhance environmental performance. It must be documented, communicated within the organization, and available to interested parties.',
      'Roles, responsibilities and authorities (5.3) must be assigned and communicated, with accountability for EMS effectiveness retained by top management. Note that ISO 14001 has no separate "worker participation" clause equivalent to ISO 45001\'s 5.4 — worker involvement is encouraged through awareness (7.3) and communication (7.4) rather than mandated as its own clause.',
    ],
    bullets: [
      '5.1 — Top management takes accountability, sets direction, integrates the EMS into the business, and provides resources.',
      '5.2 — A documented environmental policy with three commitments: protect the environment, fulfil compliance obligations, continually improve. Communicated and available.',
      '5.3 — Assigned and communicated roles, responsibilities, and authorities; EMS-effectiveness accountability stays with top management.',
    ],
    dodonts: {
      dos: [
        'Make the environmental policy specific to your context — a quarry, a data centre, and a hospital should not have the same policy.',
        'Have top management own the management review and speak to environmental performance during the audit.',
      ],
      donts: [
        'Don\'t reduce the environmental commitment to "prevent pollution" only; 2015 expects "protect the environment", scaled to your context.',
        'Don\'t treat the policy as a website footer — it must be communicated internally and genuinely understood.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-6',
    title: 'Clause 6 — Planning (aspects, obligations, objectives)',
    paragraphs: [
      'Clause 6 is the engine room of an EMS. 6.1.1 requires you to plan actions to address risks and opportunities, considering the context and interested parties. 6.1.2 (environmental aspects) is the heart of 14001: you determine the environmental aspects of your activities, products, and services that you can control or influence, and their associated environmental impacts — considering a life-cycle perspective — then apply defined criteria to determine which aspects are significant. 6.1.3 (compliance obligations) requires you to determine and have access to your legal and other requirements and how they apply. 6.1.4 requires you to plan actions to address the significant aspects, compliance obligations, and risks/opportunities, and to integrate them into the EMS.',
      'Two 2015 concepts trip people up. First, the life-cycle perspective: when determining aspects you must consider the stages you can control or influence — raw materials, transport, use, end-of-life — not just what happens inside your fence line. It is a perspective, not a full life-cycle assessment, but ignoring it entirely is a finding. Second, "aspects vs impacts": an aspect is what your activity does (e.g. discharging cooling water); the impact is the resulting environmental change (e.g. thermal effect on the receiving stream). You assess significance at the aspect level.',
      '6.2 requires environmental objectives that are consistent with the policy, measurable (if practicable), monitored, communicated, and updated — plus a plan for each (what, resources, who, when, how evaluated, and how results integrate into business processes). "Reduce energy use" is a slogan; "cut grid electricity per unit of output 8% by year-end, owner Facilities, tracked monthly" is an objective.',
    ],
    bullets: [
      '6.1.1 — Plan actions to address risks and opportunities arising from context and interested parties.',
      '6.1.2 — Determine environmental aspects and impacts with a life-cycle perspective; apply criteria to identify the significant ones.',
      '6.1.3 — Determine and have access to compliance obligations (legal + other) and how they apply.',
      '6.1.4 — Plan actions to address significant aspects, obligations, and risks/opportunities; integrate them.',
      '6.2 — Set measurable environmental objectives and concrete action plans tied to owners and metrics.',
    ],
    dodonts: {
      dos: [
        'Maintain an aspects/impacts register with documented significance criteria so the same activity scores the same way every time.',
        'Consider the life-cycle stages you can influence (procurement, use, disposal), and record that you did.',
        'Keep the compliance-obligations register current — a missed permit renewal or regulatory change is the classic environmental nonconformity.',
      ],
      donts: [
        'Don\'t confuse aspects with impacts when scoring significance — assess at the aspect level.',
        'Don\'t restrict aspects to on-site activities; the life-cycle perspective requires looking up and down the chain.',
      ],
    },
    citations: [
      { label: 'ISO — ISO 14001 official overview', url: 'https://www.iso.org/iso-14001-environmental-management.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-7',
    title: 'Clause 7 — Support (resources, competence, communication, records)',
    paragraphs: [
      'Clause 7 covers the enabling infrastructure, and it mirrors ISO 45001 almost exactly. 7.1 requires the resources for the EMS. 7.2 (competence) requires you to determine and ensure the competence of people whose work affects environmental performance and compliance obligations, and to retain evidence. 7.3 (awareness) requires people to be aware of the environmental policy, the significant aspects and impacts relevant to them, their contribution to the EMS, and the implications of not conforming — including not meeting compliance obligations.',
      '7.4 (communication) is more developed in 14001 than in 45001: it explicitly splits into internal communication (7.4.2) across all levels and external communication (7.4.3) as established by your communication process and required by your compliance obligations. You decide what, when, with whom, and how you communicate, and you ensure the information is consistent and reliable. 7.5 (documented information) sets the rules for creating, updating, and controlling the documents and records the EMS relies on.',
      'A useful test for Clause 7 is whether someone outside the environmental team can find the current waste-management procedure, knows why their job matters environmentally, and can show you a record proving they were trained. If all three are true, the clause is healthy.',
    ],
    bullets: [
      '7.1 — Provide the resources for the EMS.',
      '7.2 — Define and ensure competence for work affecting environmental performance/compliance; keep evidence.',
      '7.3 — Ensure awareness of the policy, relevant significant aspects, each person\'s contribution, and the consequences of nonconformity.',
      '7.4 — A communication process covering internal (7.4.2) and external (7.4.3) communication; consistent and reliable information.',
      '7.5 — Create, update, and control documented information (version control, access, protection, retention).',
    ],
    dodonts: {
      dos: [
        'Document a communication process that names what is communicated externally and to whom (regulators, community, supply chain).',
        'Tie competence requirements to the roles that touch significant aspects, and keep certificates current.',
      ],
      donts: [
        'Don\'t neglect external communication — 14001 calls it out specifically, and compliance obligations often mandate it.',
        'Don\'t let documented procedures drift out of version control; the current revision must be unambiguous.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-8',
    title: 'Clause 8 — Operation (controls, life cycle, emergencies)',
    paragraphs: [
      'Clause 8 is where the plan meets the work. 8.1 (operational planning and control) requires you to establish, implement, control, and maintain the processes needed to meet EMS requirements and to implement the actions from Clause 6 — by setting operating criteria and controlling the processes to them. Consistent with 6.1.2, you must control or influence outsourced processes and, taking a life-cycle perspective, establish controls for procurement and for the design, delivery, use, and end-of-life treatment of your products and services as appropriate.',
      'The life-cycle perspective reappears here as concrete controls, not just analysis: for example, communicating environmental requirements to suppliers and contractors, or providing information about end-of-life handling for a product you sell. The depth expected scales with how much control or influence you actually have.',
      '8.2 (emergency preparedness and response) requires you to establish processes to prepare for and respond to potential environmental emergencies (a spill, an uncontrolled release, a fire with environmental consequence): plan the response, periodically test it where practicable, review and revise it after tests and after actual emergencies, and provide relevant information and training to interested parties including workers.',
    ],
    bullets: [
      '8.1 — Set operating criteria and control the processes; control/influence outsourced processes and life-cycle stages you can affect.',
      '8.1 (life cycle) — Communicate environmental requirements to suppliers/contractors and provide end-of-life information where appropriate.',
      '8.2 — Prepare for and respond to environmental emergencies; test, review, and revise the response; train relevant parties.',
    ],
    dodonts: {
      dos: [
        'Put environmental requirements into purchasing specs and contractor agreements, then verify on site.',
        'Run spill/release drills and capture the lessons in the response plan.',
      ],
      donts: [
        'Don\'t treat outsourced or supplier processes as out of scope — 14001 requires you to control or influence them to the extent you can.',
        'Don\'t keep an untested emergency-response plan; an undrilled spill plan is treated as no plan.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-9',
    title: 'Clause 9 — Performance evaluation (monitor, audit, review)',
    paragraphs: [
      'Clause 9 is the "Check" of PDCA. 9.1.1 requires you to determine what needs monitoring and measuring (including the parameters tied to your significant aspects), the methods, the criteria, and when — using calibrated or verified equipment where applicable — then evaluate environmental performance and the effectiveness of the EMS and keep the evidence. 9.1.2 (evaluation of compliance) requires a process to evaluate fulfilment of your compliance obligations at planned frequencies, take action if needed, and maintain knowledge and understanding of your compliance status.',
      '9.2 (internal audit) requires a planned, impartial internal-audit program at planned intervals to confirm the EMS conforms to both your own requirements and the standard and is effectively implemented; results go to relevant management and nonconformities are addressed. 9.3 (management review) requires top management to review the EMS at planned intervals against defined inputs — status of prior actions, changes in context and in compliance obligations, significant aspects, the extent objectives were met, performance and compliance trends, audit results, interested-party communications, and improvement opportunities — and to record decisions about continual improvement, changes to the EMS, and resources.',
      'The compliance-evaluation requirement (9.1.2) deserves emphasis: for an EMS, "do we currently comply with our permits and regulations, and how do we know?" is a question you must be able to answer with records, not assertions. A missed permit limit that surfaces in an audit because there was no evaluation process is among the most common major nonconformities.',
    ],
    bullets: [
      '9.1.1 — Monitor and measure the parameters tied to significant aspects; evaluate performance and EMS effectiveness; keep evidence.',
      '9.1.2 — Evaluate compliance with obligations at planned frequencies; act on gaps; know your status.',
      '9.2 — Run a planned, impartial internal-audit program; report results and address findings.',
      '9.3 — Top management reviews the EMS against the defined inputs and records decisions and actions.',
    ],
    dodonts: {
      dos: [
        'Tie monitoring directly to your significant aspects and compliance limits, and calibrate the instruments that matter.',
        'Make the compliance evaluation a scheduled, recorded process, not a year-end assumption.',
        'Minute the management review with explicit decisions, owners, and due dates.',
      ],
      donts: [
        'Don\'t rely on "no complaints" as evidence of compliance — evaluate against the actual obligations.',
        'Don\'t let internal auditors review their own areas; impartiality is required.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'clause-10',
    title: 'Clause 10 — Improvement (nonconformity, CAPA, continual improvement)',
    paragraphs: [
      'Clause 10 is the "Act" of PDCA. 10.1 sets the requirement to determine improvement opportunities and implement actions to achieve the intended outcomes of the EMS. 10.2 (nonconformity and corrective action) requires that when a nonconformity occurs — including one arising from a complaint — you react to control and correct it and deal with the consequences (including mitigating adverse environmental impacts), evaluate the need to eliminate the root cause so it does not recur (reviewing the nonconformity, determining causes, and checking whether similar ones exist), implement the action, review its effectiveness, and make changes to the EMS if necessary, retaining records of the nonconformity and the actions taken.',
      'As in 45001, the discipline that matters is root-cause analysis with later effectiveness verification, plus the "does this happen elsewhere?" check. A spill that is cleaned up (correction) but whose cause is never addressed (no corrective action) is a half-closed loop; an auditor will reopen it.',
      '10.3 (continual improvement) requires you to continually improve the suitability, adequacy, and effectiveness of the EMS to enhance environmental performance. The certificate attests not that you have zero environmental impact, but that you run a system that measurably reduces it over time.',
    ],
    bullets: [
      '10.1 — Determine and act on improvement opportunities to meet the EMS\'s intended outcomes.',
      '10.2 — Control and correct nonconformities (and mitigate impacts), address root cause, verify effectiveness, update the EMS, and keep records.',
      '10.3 — Continually improve the EMS to enhance environmental performance.',
    ],
    dodonts: {
      dos: [
        'Run and record root-cause analysis; close a corrective action only after a later effectiveness check.',
        'Mitigate the environmental consequence of the nonconformity, not just the paperwork.',
        'Feed verified actions and performance trends back into the aspects register and the management review.',
      ],
      donts: [
        'Don\'t close a corrective action on the day it is raised — effectiveness needs time to demonstrate.',
        'Don\'t stop at "clean it up"; correction without corrective action invites recurrence.',
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'documented-information',
    title: 'The documented information checklist',
    paragraphs: [
      'ISO 14001 distinguishes documents you must maintain from records you must retain, and an auditor will ask for both. The list below is the minimum set most auditors expect; your EMS may need more depending on your aspects and obligations.',
    ],
    bullets: [
      'The documented scope of the EMS (4.3).',
      'The environmental policy (5.2).',
      'The environmental aspects, the criteria for significance, and the significant aspects determined (6.1.2).',
      'The compliance obligations register, kept current (6.1.3).',
      'Environmental objectives and the plans to achieve them (6.2).',
      'Evidence of competence (7.2).',
      'Documented information required by the standard and determined as necessary, under version control (7.5).',
      'Evidence that operational controls were carried out as planned (8.1).',
      'Records related to emergency preparedness and response, including tests (8.2).',
      'Monitoring/measurement results and equipment calibration/verification records (9.1.1).',
      'Compliance-evaluation results and knowledge of compliance status (9.1.2).',
      'The internal-audit program and its results (9.2).',
      'Management-review inputs and recorded outputs/decisions (9.3).',
      'Records of nonconformities and the corrective actions taken with effectiveness checks (10.2).',
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'certification-journey',
    title: 'The certification & audit journey',
    paragraphs: [
      'Certification follows the same path as ISO 45001. After running the EMS long enough to generate real records, an accredited certification body performs a two-stage initial audit: Stage 1 reviews your documentation and readiness (scope, policy, aspects register, compliance obligations, monitoring), and Stage 2 is the on-site assessment where the auditor samples records, interviews people, and tests whether the EMS operates as documented.',
      'Pass Stage 2 — minor nonconformities are normal and close with an action plan; a major must be cleared first — and you receive a three-year certificate, maintained by annual surveillance audits and renewed by recertification at the end of the cycle.',
      'For an EMS specifically, auditors lean hard on compliance evaluation and on the aspects register: be ready to show your current permit/regulatory status with records, and be ready to defend why your significant aspects are the right ones. Run at least one management review and one internal-audit round, and close a couple of real nonconformities, before you invite the auditor.',
    ],
    bullets: [
      'Stage 1 — documentation/readiness review.',
      'Stage 2 — full on-site assessment with interviews and record sampling.',
      'Surveillance — annual lighter audits in years 1 and 2.',
      'Recertification — fuller reassessment every 3 years.',
    ],
    citations: [
      { label: 'ISO — certification explained', url: 'https://www.iso.org/certification.html' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'platform-mapping',
    title: 'How Soteria supports an EMS',
    paragraphs: [
      'Soteria ships a dedicated Environmental module for ISO 14001. It holds the four registers the standard turns on — environmental aspects & impacts (6.1.2), objectives and their monitoring readings (6.2 / 9.1.1), management review (9.3), and nonconformities with corrective actions (10.2) — plus a clause-by-clause evidence map and an audit-readiness report card that grades every clause from those registers. The shared management-system clauses (context, leadership, support, audit, management review, corrective action) are satisfied by the same Soteria features regardless of which standard you certify against.',
      'The report card is deliberately named for readiness, not conformity. It reports evidence coverage — whether the records exist and are current in the platform — and treats blocking findings as decisive: one open major nonconformity, or no evidence at all on a core clause, reads as "not ready" however high the percentage climbs. Only an accredited certification body determines conformity. Two clauses still report structural gaps today: 7.5 documented information and 9.2 internal audit have no register in the platform yet, so keep that evidence in your own controlled-document repository and reference it from the management review until those ship.',
    ],
    bullets: [
      'Clause 6.1.2 (aspects & impacts) — the Environmental module\'s aspects register scores significance as severity × likelihood on a 1-5 scale, significant at 12 or higher, so the criterion an auditor asks for is documented and repeatable.',
      'Clause 6.2 / 9.1.1 (objectives & monitoring) — measurable objectives with a baseline, target, target date, and periodic readings; progress is evaluated in the improvement direction you set.',
      'Clause 6.1.3 / 9.1.2 (compliance obligations & evaluation) — the Compliance Calendar tracks recurring regulatory and permit obligations with overdue/due-soon status, and each completion is a recorded evaluation.',
      'Clause 8.1 (operational control for chemicals & waste) — the Chemicals, Prop 65, and hazardous-waste features capture substance inventories, exposure assessments, and disposal records.',
      'Clause 9.3 (management review) — reviews carry the standard §9.3.2 input agenda and §9.3.3 output slots; a review with no recorded conclusions or decisions is flagged rather than counted.',
      'Clause 10.2 (nonconformity & corrective action) — findings from any source, with corrective actions whose effectiveness check must be signed by someone other than the person who completed the work. Separation of duty is enforced in the database, not just the UI.',
      'Clause 7.5 (documented information) — partially covered: signed/sealed PDF artifacts carry chain-of-custody hashes (see the Integrity & Compliance wiki page), but a controlled-document register with revision and approval control is not shipped yet.',
      'Clause 9.2 (internal audit) — partially covered: the Inspections module runs scored audit checklists, but an audit programme with clause coverage and auditor independence is not shipped yet.',
    ],
    citations: [
      { label: 'Soteria — Environmental / ISO 14001 (live module)', url: '/environmental' },
      { label: 'Soteria — Audit readiness report card', url: '/environmental/report-card' },
      { label: 'Soteria — Compliance Calendar (live module)', url: '/admin/compliance/calendar' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  {
    id:    'glossary',
    title: 'Glossary of the terms auditors use',
    paragraphs: [
      'These are the recurring terms in an ISO 14001 audit, in plain language. The official definitions are in Clause 3 of the licensed standard — look there when precision matters.',
    ],
    bullets: [
      'Environment — the surroundings in which an organization operates: air, water, land, natural resources, flora, fauna, humans, and their interrelationships.',
      'Environmental aspect — an element of your activities, products, or services that interacts or can interact with the environment. A significant aspect is one your criteria flag as having (or potentially having) a significant impact.',
      'Environmental impact — the change to the environment, adverse or beneficial, that results from an aspect.',
      'Life-cycle perspective — consideration of the consecutive and interlinked stages of a product/service from raw-material acquisition through end-of-life, to the extent you can control or influence them. It is a perspective, not a full life-cycle assessment.',
      'Compliance obligations — legal requirements you must meet plus other requirements you choose to subscribe to (customer, community, voluntary codes).',
      'Prevention of pollution / protection of the environment — avoiding, reducing, or controlling the creation, emission, or discharge of pollutants; the 2015 standard frames the broader commitment as protection of the environment.',
      'Nonconformity — a failure to meet a requirement. Corrective action — action to eliminate the cause so it does not recur (distinct from correction, the immediate fix).',
      'Continual improvement — recurring activity to enhance environmental performance; the intended end-state of the EMS.',
    ],
    citations: [
      { label: 'ISO — Online Browsing Platform (free term lookups)', url: 'https://www.iso.org/obp/ui/' },
    ],
  },
]
