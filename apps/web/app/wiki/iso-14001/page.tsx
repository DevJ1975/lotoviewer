import { Fragment } from 'react'
import WikiPage, { Section, DoDont, type ChangelogEntry } from '../_components/WikiPage'
import {
  SECTIONS,
  MANUAL_TITLE,
  MANUAL_SUBTITLE,
  MANUAL_VERSION,
  MANUAL_LAST_UPDATED,
  type ManualSection,
} from './_content'

// ISO 14001 implementation guide. The content lives in ./_content.ts;
// this file is only the layout shell. The prose is original — it
// explains the standard, it does not reproduce ISO's copyrighted text.

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.4.0',
    date: '2026-10-02',
    changes: [
      'Updated "How Soteria supports an EMS" for permits and management of change. Added a permit vault under 6.1.3: renewal countdowns that escalate at 180, 90 and 30 days (the platform\'s own intervals, not a regulatory lead time), a holder-of-record check against the EMS scope, conditions that are linked obligations marked done with evidence, and export-controlled documents. Added management of change under 6.1.4 and 8.1, including the three-step permit transfer that a change of owner or legal name opens for every active permit.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-02',
    changes: [
      'The report card now marks 7.2 competence, 7.3 awareness, 7.4 communication, 8.1 operational control and 8.2 emergency preparedness as "not assessed" instead of grading them from safety records, and will not call the system ready while any clause is unassessed. 7.5 documented information and 9.2 internal audit, which have no register in the platform yet, read "not assessed" too instead of blocking every tenant\'s card. Added clause 5.3 to the card. Updated "How Soteria supports an EMS" for: the process map with an owner for each process and the two clause 5.3 roles (4.4, 5.3); the scope\'s control-and-influence statement and exclusions (4.3); recorded policy communications, and the policy and scope as one PDF for interested parties (5.2); and whether each aspect is one the organization controls or can only influence (6.1.2). The clause map page no longer claims the platform satisfies each clause: it shows where evidence can be held, for a person to pin.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-02',
    changes: [
      'Updated "How Soteria supports an EMS" for the new registers: context, interested parties, scope and policy (4.1-4.3, 5.2); aspects scored per operating condition with a rationale and a stored method (6.1.2); and the compliance obligations register with scheduled, evidence-backed evaluations (6.1.3 / 9.1.2), where a missing evaluation frequency is flagged and an undetermined result does not count. Added the red/amber/green register health and how evidence integrity is kept. Corrected the note on the 2015 revision: it adopted Annex SL\'s high-level structure.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-08-19',
    changes: [
      'Rewrote "How Soteria supports an EMS" — it claimed no ISO 14001 clause-evidence map shipped, which stopped being true when the aspects, objectives, management-review, and nonconformity registers landed. Now describes the live Environmental module, the clause map, and the audit-readiness report card, and is explicit that two clauses (7.5 documented information, 9.2 internal audit) still have no register in the platform.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-05-24',
    changes: [
      'Initial ISO 14001:2015 implementation guide. An original, plain-language manual covering the Plan-Do-Check-Act structure and every auditable clause (4 Context, 5 Leadership, 6 Planning — environmental aspects, life-cycle perspective, compliance obligations and objectives, 7 Support, 8 Operation, 9 Performance evaluation, 10 Improvement), the documented-information checklist, the certification/audit journey, the glossary, and a map of which Soteria modules support an EMS. Written in our own words; it points back to the licensed standard for the authoritative requirement text rather than copying it.',
    ],
  },
]

export default function WikiIso14001Page() {
  return (
    <WikiPage
      title={MANUAL_TITLE}
      subtitle={MANUAL_SUBTITLE}
      modulePath="/environmental"
      audience="admin"
      category="Safety"
      version={MANUAL_VERSION}
      lastUpdated={MANUAL_LAST_UPDATED}
      changelog={CHANGELOG}
      toc={SECTIONS.map(s => ({ id: s.id, label: s.title }))}
    >
      {SECTIONS.map(s => (
        <Section key={s.id} id={s.id} title={s.title}>
          <SectionBody section={s} />
        </Section>
      ))}
    </WikiPage>
  )
}

function SectionBody({ section }: { section: ManualSection }) {
  return (
    <>
      {section.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}

      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {section.bullets.map((b, i) => (
            <li key={i} className="leading-relaxed">{b}</li>
          ))}
        </ul>
      )}

      {section.dodonts && (
        <div className="mt-4">
          <DoDont dos={section.dodonts.dos} donts={section.dodonts.donts} />
        </div>
      )}

      {section.citations && section.citations.length > 0 && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            References
          </p>
          <ul className="mt-1 space-y-1">
            {section.citations.map((c, i) => (
              <li key={i} className="text-sm">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-navy underline hover:no-underline dark:text-brand-yellow"
                >
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Fragment />
    </>
  )
}
