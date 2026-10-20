import { Fragment } from 'react'
import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, type ChangelogEntry } from '../_components/WikiPage'
import {
  SECTIONS,
  MANUAL_TITLE,
  MANUAL_SUBTITLE,
  type ManualSection,
} from './_content'

// Working at Heights manual. The manual prose lives in ./_content.ts so the
// AI seed script (apps/web/scripts/seed-working-at-heights-manual.mjs)
// can ingest the exact same prose the operator sees here; edit it there.
// The exception is the "Required training" section below: it documents app
// behaviour with in-app links and an FAQ, which the plain-string content
// model cannot express, so it is rendered here and is not ingested.
//
// CURRENT_VERSION versions this whole page, including that section.
// MANUAL_VERSION in ./_content.ts is what the seed script records for the
// ingested prose.

const CURRENT_VERSION = '1.5.0'
const LAST_UPDATED    = '2026-10-20'

// The permit training gate extends the permit section, so it renders
// directly after it. Its id cannot be 'training': ./_content.ts already
// uses that for the OSHA training-requirements section.
const REQUIRED_TRAINING = { id: 'permit-training', label: 'Required training' }
const REQUIRED_TRAINING_FOLLOWS = 'permits'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.5.0',
    date: '2026-10-20',
    changes: [
      'Required training can now block a permit. When an admin requires a STRIKE module for working-at-heights permits, a permit cannot be issued until both the worker and the Competent Person hold a current pass. A working-at-heights permit goes straight to Active when it is saved, so that is when the check runs, and it runs again when a suspended permit is resumed. The database enforces this, so it cannot be clicked past.',
      'New Required training panel on the new-permit form. It appears once a worker or CP is chosen, shows each person\u2019s status, and keeps Save disabled while anyone is missing a module.',
      'Train now: each person missing training gets a QR code that opens the module on their own phone with no login. The link is for that one person, expires after 30 minutes, and the panel updates when they pass.',
      'Emergency override: owners and admins can let a blocked worker or CP onto the permit with a written reason of at least 20 characters. It can be recorded before the permit is saved, because the form reserves the permit\u2019s id up front. It cannot be edited or deleted, is recorded in the audit log, and is emailed to every owner and admin.',
      'Nothing changes until an admin requires a module at STRIKE \u2192 Training admin \u2192 Required for work. The Authorized-Person and Competent-Person designation checks are unchanged and still apply separately.',
    ],
  },
  {
    version: '1.4.1',
    date: '2026-08-28',
    changes: [
      'Fall Clearance Calculator — impossible entries no longer shrink the required clearance. Every field on the calculator is a distance, and a negative one used to subtract from the total: a lanyard length of −6 ft reported 6 ft of required clearance instead of 18 ft, and negatives across the board produced a NEGATIVE requirement, which made the SAFE verdict pass at any available clearance including none. A zero was wrong in the same way for the two distances that cannot be zero — a worker always extends some way below their dorsal D-ring, and a zero-length lanyard also divided by zero in the swing-fall term. Those entries are now treated as a missing measurement and the conservative default is used instead, so the verdict can only ever err long. The number inputs also clamp to the min/max shown beside them, so the value on screen is the value the math used. Zero remains valid where it is a real choice: no safety margin, and an anchor directly overhead with no swing-fall offset.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-05-19',
    changes: [
      'Phase 4 — Working-at-Heights permit issuance + status board shipped. The /admin/working-at-heights/permits surface lists every permit with status badges and an "hours remaining" decoration for active rows. The /new form runs a live seven-point pre-condition checklist (worker holds current Authorized-Person designation; CP holds current Competent-Person designation; anchor in_service + recert not lapsed; components in_service + service-life not expired; rescue plan associated; clearance verdict SAFE; weather check clears) and disables Save until every gate passes. The clearance calculation is computed live and persisted as a JSON snapshot on wah_permits.clearance_calculation so an auditor can see the math at issue time even if defaults shift later. Detail page exposes suspend / resume / close-out / cancel actions with closed_at + closed_by stamped on terminal transitions. The worker-facing status board at /working-at-heights/permits/status mirrors the hot-work board layout — dark theme, big timers, visibility-aware 30-second polling, stale-data banner.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-05-19',
    changes: [
      'Phase 3 — interactive Fall Clearance Calculator shipped at /working-at-heights/calculator. Pick a system (shock lanyard / Class 1 SRL / Class 2 SRL / restraint), enter the available clearance below the anchor, and see the verdict (SAFE / MARGINAL / UNSAFE) update live with the breakdown and a side-view SVG diagram. The math is the same calculateRequiredClearance() the unit tests pin down; the page consumes that helper directly so a regression on either side fails CI.',
    ],
  },
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
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={SECTIONS.flatMap(s => {
        const item = { id: s.id, label: s.title }
        return s.id === REQUIRED_TRAINING_FOLLOWS ? [item, REQUIRED_TRAINING] : [item]
      })}
    >
      {SECTIONS.map(s => (
        <Fragment key={s.id}>
          <Section id={s.id} title={s.title}>
            <SectionBody section={s} />
          </Section>
          {s.id === REQUIRED_TRAINING_FOLLOWS && <RequiredTrainingSection />}
        </Fragment>
      ))}
    </WikiPage>
  )
}

function RequiredTrainingSection() {
  return (
    <Section id={REQUIRED_TRAINING.id} title={REQUIRED_TRAINING.label}>
      <p>
        The worker and the Competent Person on a permit are picked from the
        roster on the <strong>Issue Working-at-Heights Permit</strong> form.
        Because each pick is a roster entry rather than a typed name, the
        permit can check that person&apos;s STRIKE training. If someone is not
        in the list, add them to the roster first.
      </p>
      <p>
        When an admin has required a STRIKE module for working-at-heights
        permits, a permit cannot be issued until both the worker and the CP
        hold a current pass. A working-at-heights permit goes straight to{' '}
        <em>Active</em> when you press <strong>Save</strong>, so that is when
        the check runs. As soon as a worker or CP is chosen, a{' '}
        <strong>Required training</strong> panel on the form shows each
        person&apos;s status, and <strong>Save</strong> stays disabled while
        anyone is missing a module. The database runs the same check when the
        permit is saved, so it cannot be clicked past, and again when a
        suspended permit is resumed.
      </p>
      <ul>
        <li><strong>Train now</strong> &mdash; appears next to each missing
          module. It shows a QR code the person scans with their own phone to
          take the module on the spot, with no login. The link is for that one
          person and expires after 30 minutes. The panel updates when they
          pass.</li>
        <li><strong>Emergency override</strong> &mdash; owners and admins only,
          for when waiting is less safe than going ahead. Choose the blocked
          people and write the reason (at least 20 characters). It can be
          recorded before the permit is saved, because the form reserves the
          permit&apos;s id up front. The override cannot be edited or deleted,
          is recorded in the audit log, and is emailed to every owner and
          admin.</li>
      </ul>
      <p>
        This is separate from the designation checks in the pre-condition
        checklist, which are unchanged: the worker still needs a current
        Authorized-Person designation and the CP a current Competent-Person
        designation. A STRIKE pass does not stand in for either, and a training
        override does not waive them.
      </p>
      <p>
        Nothing changes until an admin requires a module. With no requirement
        for working-at-heights permits, the panel notes that none is required
        and permits issue as before. Admins set requirements at{' '}
        <Link href="/strike/admin">STRIKE &rarr; Training admin</Link> &rarr;{' '}
        <strong>Required for work</strong>, choosing the module and how recent
        the pass must be: any current pass, fresh for each job (within 24
        hours), within the last 90 days, or within the last year.
      </p>

      <Faq items={[
        {
          q: 'Save is disabled and the panel says training is missing. What now?',
          a: <>Use <strong>Train now</strong> next to each missing module and
            have that person scan the QR code with their phone. Once everyone
            has passed, the panel shows <em>Crew ready</em> and Save unlocks as
            long as the rest of the checklist passes. If waiting is less safe
            than going ahead, an owner or admin can record an{' '}
            <strong>Emergency override</strong> with a written reason; it is
            audited and emailed to every owner and admin.</>,
        },
        {
          q: 'Can the override be recorded before the permit exists?',
          a: <>Yes. The form reserves the permit&apos;s id when it opens, so the
            override attaches to the permit you are about to issue. If you leave
            or reload the form without saving, that override authorizes nothing
            (a reloaded form is a new permit), but it stays in the audit
            trail.</>,
        },
        {
          q: 'Why was resuming a suspended permit refused for training?',
          a: <>Resuming puts the permit back into <em>Active</em>, so the check
            runs again, and a pass can stop counting while the permit is
            suspended. A &ldquo;fresh for each job&rdquo; requirement, for
            example, only accepts a pass from the last 24 hours. The message
            names who is missing which module; once they hold a current pass,
            resume again.</>,
        },
      ]} />

      <DoDont
        dos={[
          'Choose the worker and CP early and use Train now for anyone flagged, so training is not what holds the permit up once the rest of the checklist clears.',
        ]}
        donts={[
          'Don\'t use the emergency training override to save time. It is for when waiting is less safe, and every use is audited and emailed to every owner and admin.',
        ]}
      />
    </Section>
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
