// How-to guides. Each one feeds the same four surfaces: the in-page help panel,
// the wiki, the assistant's guidance tool and the knowledge base. Written for a
// plant environmental lead, not a lawyer: what to do, in what order, and what a
// good record looks like. They state what the rule asks; the permit in force is
// always the authority.
//
// STATUS: DRAFT, like the packs. Claims that are specific to a rule carry a
// citation, and the verify notes live on those citations.

import type { GuideDef } from '../content'
import { cite } from './helpers'

const MSGP = cite('EPA 2021 MSGP', 'The 2021 MSGP expired 2026-02-28; confirm which permit is in effect.')
const IGP = cite('IGP Order 2014-0057-DWQ', 'Confirm against the permit as amended by Orders 2015-0122-DWQ and 2018-0028-DWQ.')
const TXR = cite('TPDES MSGP TXR050000', 'Confirm which TXR050000 issuance is in effect.')

export const overviewGuide: GuideDef = {
  id: 'guide-overview', program: 'overview', title: 'How the environmental compliance suite works',
  pageKeys: ['home'],
  quickSteps: [
    'Pick your site at the top. Every record belongs to one site.',
    'Set the site\'s state. It decides which rules are shown: federal first, then the state\'s own.',
    'Fill in the site profile: stormwater coverage, air permit, wastewater, SPCC and Tier II. Anything left as "not evaluated" is shown as needing a decision, never assumed to be fine.',
    'Choose "Apply the library to this site". Review what it would add, then confirm. It only adds; it never overwrites your edits.',
    'Give each deadline an owner on the Calendar, then run the checklists as they come due.',
    'Read each legal requirement once and mark whether it applies and whether you meet it.',
  ],
  sections: [
    {
      id: 'what-it-is', title: 'What this is and is not',
      paragraphs: [
        'The suite turns the environmental requirements that apply to a site into a calendar, checklists and a register you can show an auditor. It is a working tool and a starting point, not legal advice.',
        'The content is a draft until a Certified Safety Professional has confirmed it against current regulatory text. Items marked "verify" are specific claims that still need that check. Always confirm against your own permits.',
      ],
    },
    {
      id: 'multi-site', title: 'More than one site, more than one state',
      paragraphs: [
        'A company with plants in different states sees each plant\'s own rules. If a state has no content yet you get the federal baseline with a banner saying so: that baseline is a reference, not that state\'s rule.',
      ],
    },
  ],
}

export const stormwaterGuide: GuideDef = {
  id: 'guide-stormwater', program: 'stormwater', title: 'Industrial stormwater (EPA baseline)',
  pageKeys: ['checklists', 'checklist-run', 'permits'],
  quickSteps: [
    'Confirm you need coverage. Facilities in certain industries need permit coverage, or a No Exposure Certification if nothing is exposed to rain.',
    'Keep a stormwater pollution prevention plan (SWPPP) and update it when the site changes.',
    'Walk the site every quarter and record it on the routine inspection checklist.',
    'Once a quarter, collect a discharge sample from each outfall and record what you see. This is looking at it, not lab testing.',
    'Fix what you find and record who fixed it and when. A finding with no follow-up is the most common audit problem.',
    'Submit the annual report on time.',
  ],
  sections: [
    {
      id: 'coverage', title: 'Do you need coverage?',
      paragraphs: [
        'Industrial activities listed in the stormwater rule need coverage under a permit. Many light-industry sites, including a lot of food manufacturing, need it only if materials or activities are exposed to rain. If nothing is exposed you can certify "no exposure" instead, and recertify on schedule.',
        'Decide this once, write down why, and set the answer on the site profile. The checklists and deadlines follow from it.',
      ],
      citations: [cite('40 CFR 122.26', 'Confirm the sector and exposure treatment for the facility\'s SIC code.')],
    },
    {
      id: 'inspections', title: 'Routine inspections',
      paragraphs: [
        'Inspect the areas where materials, waste or activity can meet rain: loading docks, storage, waste areas, fueling and vehicle areas. Look at the stormwater controls too: inlet protection, containment, sweepers.',
        'A good record names who inspected, what they saw, what needs fixing, who owns each fix and by when.',
      ],
      bullets: [
        'Do it on a day you can see conditions, not just on a quiet day.',
        'A "pass" with no notes is fine when true. A skipped question is not a pass.',
        'Attach a photo of anything you flag.',
      ],
      citations: [cite('EPA 2021 MSGP Part 3.1', 'Confirm the part number and frequency in the permit in effect.')],
    },
    {
      id: 'visual', title: 'The quarterly visual assessment',
      paragraphs: [
        'Collect a sample of discharge during a storm that produces runoff, soon after the discharge starts, and look at it in a clear jar: color, odor, clarity, floating or settled solids, foam and oil sheen. Note the date and the last storm before it.',
        'If no qualifying storm happened in the quarter, record that and why. Do not leave a gap with no explanation.',
      ],
      citations: [cite('EPA 2021 MSGP Part 3.2', 'Confirm the collection window and the interval between storm events.')],
    },
    {
      id: 'findings', title: 'When you find a problem',
      paragraphs: [
        'A failed question raises a finding in the nonconformity register with a due date and an owner. Fix the cause, not just the symptom, and close the finding with what you did.',
        'Dry-weather flow from an outfall is the one to chase immediately: it may be an unauthorized discharge.',
      ],
      citations: [MSGP],
    },
  ],
}

export const caStormwaterGuide: GuideDef = {
  id: 'guide-stormwater', program: 'stormwater', title: 'Industrial stormwater in California (Industrial General Permit)',
  pageKeys: ['checklists', 'checklist-run', 'permits'],
  quickSteps: [
    'Confirm your facility is covered by the Industrial General Permit (IGP) and keep your SWPPP and monitoring plan current in SMARTS.',
    'Do a visual observation of each drainage area once every calendar month and record it.',
    'Sample four qualifying storm events a year: two in July to December and two in January to June.',
    'Upload the lab results to SMARTS within 30 days of getting them.',
    'Do the annual comprehensive evaluation before the reporting year ends on June 30.',
    'Submit the annual report in SMARTS by July 15.',
    'If a result exceeds a numeric action level, start the exceedance response steps right away.',
  ],
  sections: [
    {
      id: 'ca-what', title: 'What is different in California',
      paragraphs: [
        'California runs its own industrial stormwater permit. The EPA permit does not apply here, so the quarterly visual assessment and NeT annual report in the federal baseline are replaced by monthly visual observations, sampling at qualifying storm events and an annual report in SMARTS.',
      ],
      citations: [IGP],
    },
    {
      id: 'ca-monthly', title: 'Monthly visual observations',
      paragraphs: [
        'Once every calendar month, on a day with scheduled operations and during daylight, look at each drainage area for unauthorized non-stormwater discharges, pollutant sources and the condition of your best management practices. Record what you saw and fix what needs fixing.',
        'An unauthorized non-stormwater discharge has to be eliminated or authorized, with the cause on record. If a month had no day that met the conditions, record that.',
      ],
      citations: [cite('IGP §XI.A.1', 'Confirm the section and timing conditions.')],
    },
    {
      id: 'ca-sampling', title: 'Storm event sampling',
      paragraphs: [
        'A qualifying storm event is one that produces a discharge after at least 48 hours without one. Collect samples from each drainage area within four hours of the start of discharge (or of operations), have an accredited laboratory analyze them, and upload the results.',
        'You cannot schedule a storm. Keep sample bottles, a chain-of-custody form and a courier on standby from October.',
      ],
      citations: [cite('IGP §XI.B', 'Confirm the qualifying-event definition, timing and required parameters.')],
    },
    {
      id: 'ca-era', title: 'If a result is over a numeric action level',
      paragraphs: [
        'Exceeding a numeric action level puts the facility in Level 1 status: evaluate your controls, then submit the evaluation and any changes on the permit\'s schedule. A continuing exceedance moves you to Level 2, which needs a qualified industrial stormwater practitioner. Treat the first exceedance as the time to act.',
      ],
      citations: [cite('IGP §XII', 'Confirm the Level 1 and Level 2 deadlines and the action levels.')],
    },
  ],
}

export const txStormwaterGuide: GuideDef = {
  id: 'guide-stormwater', program: 'stormwater', title: 'Industrial stormwater in Texas (TPDES MSGP)',
  pageKeys: ['checklists', 'checklist-run', 'permits'],
  quickSteps: [
    'Confirm coverage under TXR050000 and keep a stormwater pollution prevention plan (SWP3) at the site.',
    'Inspect the facility on the schedule your SWP3 sets (at least quarterly) and record it.',
    'Once a quarter, do the visual monitoring of each outfall and record what you see.',
    'Do the benchmark monitoring your sector requires and keep the results.',
    'File notices and changes through TCEQ\'s STEERS system.',
    'Fix what you find and record who fixed it and when.',
  ],
  sections: [
    {
      id: 'tx-what', title: 'What is different in Texas',
      paragraphs: [
        'Texas runs its own industrial stormwater permit, so the EPA permit does not apply here. The structure is similar (a plan, inspections, quarterly visual monitoring, some benchmark monitoring) but the plan is called an SWP3 and notices go through STEERS.',
        'The general permit is reissued periodically. Confirm which issuance is in effect and that the dates and numbers here still match it.',
      ],
      citations: [TXR],
    },
    {
      id: 'tx-visual', title: 'Quarterly visual monitoring',
      paragraphs: [
        'Collect a sample of stormwater discharge from each outfall during a storm that produces runoff, and look at it: color, odor, clarity, solids, foam and sheen. Record the date, the conditions and anything unusual.',
      ],
      citations: [cite('TPDES MSGP TXR050000 Part III', 'Confirm the monitoring requirements for the facility\'s sector.')],
    },
  ],
}

export const outfallGuide: GuideDef = {
  id: 'guide-outfalls', program: 'outfall', title: 'Outfall inspections',
  pageKeys: ['outfalls', 'checklist-run'],
  quickSteps: [
    'List every outfall once: a code that matches your site map, where it discharges, and where it goes.',
    'Mark outfalls that are sampling points, and note any that are substantially identical to another.',
    'Walk each outfall on schedule. Check the structure, then look for flow, stain, sheen or odor.',
    'Photograph every outfall each time. A dated photo is the best evidence you looked.',
    'If anything is flowing when it has not rained for 72 hours or more, treat it as a possible unauthorized discharge and trace the source before assuming it is allowed.',
  ],
  sections: [
    {
      id: 'of-dry-weather', title: 'Dry-weather flow',
      paragraphs: [
        'Stormwater outfalls should be dry between rains. Flow when it has not rained usually means something is draining that should not: wash water, a leak, a cross-connection. Some non-stormwater discharges are allowed if the permit lists them and controls are in place, so record what it was and where it came from before deciding.',
      ],
      citations: [cite('Clean Water Act §402; 40 CFR 122.26', 'Confirm the list of allowable non-stormwater discharges in your permit.')],
    },
  ],
}

export const legalRegisterGuide: GuideDef = {
  id: 'guide-legal-register', program: 'overview', title: 'The legal register',
  pageKeys: ['legal'],
  quickSteps: [
    'Open each requirement once and read the summary and the citation.',
    'Mark whether it applies to this site. "Not applicable" needs no rating.',
    'If it applies, rate your compliance. Attention or non-compliant needs a note saying what is wrong.',
    'Add anything the library missed with "Add a requirement".',
    'Review everything at least once a year. Overdue reviews show on the home page.',
  ],
  sections: [
    {
      id: 'lr-why', title: 'Why keep one',
      paragraphs: [
        'ISO 14001 asks you to know which environmental requirements apply to you and to check that you meet them. The register is that record: what the requirement is, whether it applies, how you stand and when you last looked.',
        'The library suggests entries from your site profile. Treat them as a starting point: a person decides what applies.',
      ],
      citations: [cite('ISO 14001:2015 §6.1.3 and §9.1.2')],
    },
  ],
}

export const calendarGuide: GuideDef = {
  id: 'guide-calendar', program: 'overview', title: 'The compliance calendar',
  pageKeys: ['calendar'],
  quickSteps: [
    'Give every deadline an owner. A deadline with no owner is a deadline nobody remembers.',
    'Complete an item from its row. If it has a checklist, "Start checklist" opens it and completing the checklist completes the deadline.',
    'Reminders arrive before each deadline and weekly while it is overdue.',
    'Add your own deadlines, such as permit renewals and contract dates.',
  ],
  sections: [
    {
      id: 'cal-period', title: 'Period-end deadlines',
      paragraphs: [
        'Monthly, quarterly and half-year duties fall on the last day of the period. They stay on period ends from one cycle to the next, so a deadline of March 31 becomes June 30, then September 30.',
      ],
    },
  ],
}

export const permitsGuide: GuideDef = {
  id: 'guide-permits', program: 'overview', title: 'Permits',
  pageKeys: ['permits'],
  quickSteps: [
    'Record each permit with its number, agency, effective date and expiration date.',
    'Set the renewal lead time. Many permits need an application well before they expire.',
    'The calendar gets a renewal deadline automatically for a permit in force.',
    'Attach the permit document so it can be found in an audit.',
  ],
  sections: [
    {
      id: 'permits-lead', title: 'How early to renew',
      paragraphs: [
        'The lead time is your own safety margin, not a rule. Check the permit itself for the date its agency requires an application, and set the lead time to cover it with room to spare.',
      ],
    },
  ],
}

export const federalGuides: GuideDef[] = [
  overviewGuide, stormwaterGuide, outfallGuide, legalRegisterGuide, calendarGuide, permitsGuide,
]
