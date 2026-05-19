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

// Working at Heights manual. The content lives in ./_content.ts so the
// AI seed script (apps/web/scripts/seed-working-at-heights-manual.mjs)
// can ingest the exact same prose the operator sees here. Edit the
// content there; this file is only the layout shell.

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.2.0',
    date: '2026-05-19',
    changes: [
      'Six inventory create forms shipped under /admin/working-at-heights/<slug>/new — Authorizations (member + role + validity window, conditional PE license for QP), Fall protection components (10 ANSI Z359 types with serial + service-life tracking), Portable ladders (ANSI A14 type + duty with auto-fill of capacity), Fixed ladders (with the 2036 retrofit-target-date auto-defaulting to Nov 18 2036 when height ≥24 ft and no safety system), Anchors (engineered + improvised with QP cert + recert cycle), Rescue plans (named primary + backup rescuer + drill cadence). The "+ New" CTAs on the inventory lists now resolve.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-05-19',
    changes: [
      'Module now reachable from the drawer, the home dashboard ModulesGrid, and the Cmd-K palette. A worker-facing module home at /working-at-heights surfaces the manual, the calculator placeholder, and the admin tiles (admins only). The manual itself is unchanged in this release; this entry records the navigation wiring that was missing in 1.0.0.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-05-19',
    changes: [
      'Initial Working at Heights manual. Federal OSHA Subpart D + Subpart M, Cal/OSHA Title 8 §3210/§3276/§1670, ANSI Z359 fall protection, the fall-clearance calculation, rescue plan requirements, AWP carve-outs, roof safety and skylights, sub-contractor program, inspection cycles, incident response, and the documentation an OSHA inspector will ask for.',
    ],
  },
]

export default function WikiWorkingAtHeightsPage() {
  return (
    <WikiPage
      title={MANUAL_TITLE}
      subtitle={MANUAL_SUBTITLE}
      modulePath="/working-at-heights"
      audience="coming-soon"
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
            Citations
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

      {/* Fragment keeps the parent JSX clean if a section has nothing
          but paragraphs — no extra wrapper renders. */}
      <Fragment />
    </>
  )
}
