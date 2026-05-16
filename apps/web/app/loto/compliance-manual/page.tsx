import Link from 'next/link'
import { ArrowLeft, BookOpen } from 'lucide-react'
import type { ReactNode } from 'react'

// /loto/compliance-manual — user manual for the LOTO Compliance module.
//
// The base LOTO module's manual lives at /loto/manual. This page covers
// the §147 compliance surface that landed in Module 1: structured
// procedure phases, periodic inspections, walkdown checklists,
// competency exams, group permits, contractor companies, and
// retraining triggers.
//
// Update protocol when behavior changes:
//   1. Edit the relevant section below.
//   2. Bump CURRENT_VERSION + add a CHANGELOG row (top is newest).
//   3. Mirror the change in /wiki/loto-compliance.
//   4. The wiki-sync check (scripts/check-wiki-sync.mjs) treats this
//      file as a source for the loto-compliance wiki entry.

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-15'

interface ChangelogEntry {
  version: string
  date:    string
  changes: string[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-05-15',
    changes: [
      'Initial publication for the LOTO Compliance module.',
      'Covers §147(c)(4)(ii) procedure phases, §147(c)(6) periodic ' +
      'inspections + walkdown checklists, §147(c)(7) competency exams, ' +
      '§147(f)(2) contractor companies, §147(f)(3)/(f)(4) group LOTO ' +
      'with shift-change handoff, and §147(g)(2) authorized-employee ' +
      'retraining triggers.',
    ],
  },
]

export default function LotoComplianceManualPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-8 text-slate-800 dark:text-slate-100">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/periodic-inspections"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to LOTO Compliance
        </Link>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          v{CURRENT_VERSION} · updated {LAST_UPDATED}
        </span>
      </div>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow text-xs font-semibold">
          <BookOpen className="h-3.5 w-3.5" /> User manual
        </div>
        <h1 className="text-3xl font-bold tracking-tight">LOTO Compliance module</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Day-to-day operating guide for the 29 CFR 1910.147 obligations:
          structured procedure phases, annual periodic inspection,
          walkdown checklist, competency exams, group LOTO, contractor
          coordination, and retraining triggers. Each section maps to a
          screen reachable from the admin nav.
        </p>
      </header>

      <nav className="text-xs text-slate-500 dark:text-slate-400 space-y-1 border border-slate-200 dark:border-slate-800 rounded-md p-3">
        <p className="font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Contents</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li><a className="underline" href="#overview">What this module is for</a></li>
          <li><a className="underline" href="#phases">§(c)(4)(ii) Procedure phases</a></li>
          <li><a className="underline" href="#periodic">§(c)(6) Annual periodic inspection</a></li>
          <li><a className="underline" href="#walkdown">§(c)(6) Walkdown checklist</a></li>
          <li><a className="underline" href="#competency">§(c)(7) Competency exams</a></li>
          <li><a className="underline" href="#group">§(f)(3)/(f)(4) Group LOTO</a></li>
          <li><a className="underline" href="#contractors">§(f)(2) Contractor companies</a></li>
          <li><a className="underline" href="#retraining">§(g)(2) Retraining triggers</a></li>
          <li><a className="underline" href="#audit">Where this lands for an inspector</a></li>
          <li><a className="underline" href="#changelog">Changelog</a></li>
        </ol>
      </nav>

      <Section id="overview" title="What this module is for">
        <p>
          The base LOTO module captures the static asset — equipment,
          photos, energy source, placard. The Compliance module is what
          turns that catalog into a defensible §1910.147 program. Each
          obligation in the standard has a screen, a record, and an
          audit trail.
        </p>
        <p>
          Everything here is admin-only (and tenant-scoped). Workers
          appear as observed subjects in inspections, members in group
          permits, exam takers, and contractor employees — they do not
          need accounts to be tracked.
        </p>
      </Section>

      <Section id="phases" title="§(c)(4)(ii) — Structured procedure phases">
        <p>
          OSHA requires the documented procedure to spell out:
          shutdown, isolation, release of stored energy, lockout, and
          verification of de-energization (the &quot;tryout&quot;). Each
          energy step on each piece of equipment now carries a phase
          tag (<code>step_type</code>) and a sequence order.
        </p>
        <p>
          <strong>How to use it.</strong> Open any{' '}
          <Link href="/loto">equipment</Link>, click <em>Edit steps</em>,
          then for each step pick a phase from the dropdown. The placard
          generator groups the steps by phase. If you remove the
          verify-zero-energy step, the placard generator refuses with a
          banner — this is intentional, because the missing tryout is
          the leading citation in §147.
        </p>
        <p>
          <strong>Shutdown is optional.</strong> Some equipment is shut
          down by the previous production step, so the validator requires
          isolate / release-stored-energy / lockout / verify-zero-energy
          but not shutdown.
        </p>
      </Section>

      <Section id="periodic" title="§(c)(6) — Annual periodic inspection">
        <p>
          The standard requires each energy-control procedure to be
          inspected at least annually by an authorized employee
          <em> other than</em> one using the procedure. The inspection
          must observe at least one authorized employee using the
          procedure, identify any deviations, document corrective
          actions, and be certified (signature + date) by the
          inspector.
        </p>
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/periodic-inspections">/admin/periodic-inspections</Link>
          {' '}lists every piece of equipment grouped by status —{' '}
          <em>overdue</em>, <em>due within 30 days</em>,{' '}
          <em>never inspected</em>, <em>current</em>. Click into a row to
          record a new inspection or view history.
        </p>
        <p>
          <strong>How to record one.</strong> The form captures inspector
          name, the authorized employees observed using the procedure
          (multi-select from the worker roster), per-step deviations,
          corrective actions, and an e-signature. Saving without signing
          keeps the row as a draft; signing freezes it and sets{' '}
          <code>next_due_at = inspected_at + 365 days</code> on both the
          inspection row and the parent equipment.
        </p>
        <p>
          <strong>Dashboard widget.</strong> The overdue count surfaces
          on <Link href="/loto">/loto</Link> and{' '}
          <Link href="/status">/status</Link> as a yellow banner with a
          link to the admin list. The widget hides itself when the
          count is zero.
        </p>
      </Section>

      <Section id="walkdown" title="§(c)(6) — Walkdown checklist">
        <p>
          The periodic inspection is paired with a structured walkdown
          checklist that captures field observations alongside the
          certification. Defaults to six items required by the standard:
        </p>
        <ul>
          <li>Procedure available at point of use</li>
          <li>Energy sources match procedure</li>
          <li>Lock points accessible</li>
          <li>Try-out step verified</li>
          <li>Authorized employees can demonstrate</li>
          <li>Tags legible</li>
        </ul>
        <p>
          <strong>Where to find it.</strong> Open any{' '}
          <Link href="/loto">equipment</Link>, then navigate to its
          walkdown page (Equipment detail → <em>Walkdown checklist</em>).
        </p>
        <p>
          <strong>How to record one.</strong> Each item gets a status
          (Pass / Fail / N/A / Not yet inspected), free-text notes, and
          an optional photo. Fail items require notes — the signoff
          button is disabled until every fail has a note. N/A counts
          as documentation on its own (the operator&apos;s
          &quot;doesn&apos;t apply&quot; is the record).
        </p>
      </Section>

      <Section id="competency" title="§(c)(7) — Competency exams">
        <p>
          Training records prove that an employee was instructed.
          Competency exams prove that an authorized employee can apply
          the procedure correctly. The proctored workflow records the
          worker, the proctor (an admin), and the answer set.
        </p>
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/competency-exams">/admin/competency-exams</Link>.
        </p>
        <p>
          <strong>Authoring an exam.</strong> Click <em>New exam</em>,
          set the role (operator / supervisor / energy isolation /
          rescue), passing score, then add questions. Each question
          is multiple-choice with 2–5 distinct choices and a
          0-indexed answer. The editor refuses to save: empty
          prompts, fewer than two choices, more than five choices,
          duplicate choices (whitespace + case insensitive), or an
          answer index outside the choice range.
        </p>
        <p>
          <strong>Proctoring an attempt.</strong> From{' '}
          <Link href="/admin/workers">/admin/workers</Link>, open a
          worker and click <em>Take exam</em>. The system records the
          proctor (you) and the worker, presents the questions, and
          on submit returns score + pass/fail. A pass with the
          &quot;auto-create training record&quot; toggle enabled
          creates a fresh row in <code>loto_training_records</code>
          linked back to the attempt.
        </p>
        <p>
          <strong>Failures are records.</strong> A failed attempt is
          not deleted — it remains in the audit log. Re-take the exam;
          the new attempt becomes the operative one. Both stay in
          history.
        </p>
      </Section>

      <Section id="group" title="§(f)(3) / (f)(4) — Group LOTO with shift change">
        <p>
          Group lockout covers the case where multiple crew members
          work on a single energy isolation. The standard requires
          a primary authorized employee to be accountable for the
          group, each crew member to attach a personal lock, and the
          continuity of protection to be maintained across shift
          changes.
        </p>
        <p>
          <strong>Creating a group permit.</strong>{' '}
          <Link href="/loto/group-permits/new">/loto/group-permits/new</Link>{' '}
          opens the create form. Set the work description, primary
          authorized employee (a user, not a worker — the primary
          signs in-app), and the affected equipment IDs. Equipment IDs
          are free-text — bays and circuits that aren&apos;t in the
          equipment catalog work fine here.
        </p>
        <p>
          <strong>Adding members.</strong> From the permit detail page,
          attach members with their personal lock serials. Members can
          be either workers (shop-floor identity from{' '}
          <Link href="/admin/workers">/admin/workers</Link>) or app
          users — the schema enforces exactly one of the two per row.
          You cannot add members until the primary is set, and you
          cannot add members to a closed permit.
        </p>
        <p>
          <strong>Shift handoff.</strong> Click <em>Hand off to new
          primary</em>, pick a different user, optionally add notes.
          The audit row captures the from / to / occurred_at; the
          permit status flips to <code>shift_handed_off</code>. You
          cannot hand off to yourself or hand off a closed permit.
        </p>
        <p>
          <strong>Closing.</strong> Every member&apos;s personal lock
          must be removed (set <em>left_at</em> on the member row)
          before the close button enables. The database enforces this
          even if you bypass the UI: the{' '}
          <code>close_loto_group_permit</code> RPC raises an exception
          when active members remain.
        </p>
      </Section>

      <Section id="contractors" title="§(f)(2) — Contractor companies">
        <p>
          Multi-employer worksites require host / contractor LOTO
          coordination. The host informs the contractor of its
          energy-control procedures; the contractor informs the host
          of theirs. The register captures the contractor company,
          contact, insurance expiry, and the host-procedure
          acknowledgement.
        </p>
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/contractors">/admin/contractors</Link>.
        </p>
        <p>
          <strong>Workflow.</strong> Add a contractor company (name,
          contact, insurance expiry). Click <em>Acknowledge host
          procedures</em> to stamp the host-procedure
          acknowledgement timestamp + the user who acknowledged.
          Tag any worker on the host roster to a contractor company
          from the worker page; tagged workers show their employer on
          training records and group permits.
        </p>
        <p>
          <strong>Insurance windows.</strong> A contractor with no
          expiry on file shows as <em>missing</em>. Within 30 days
          of expiry: <em>expiring</em>. Past expiry: <em>expired</em>
          {' '}— shown for 7 days, then dropped from the digest.
        </p>
      </Section>

      <Section id="retraining" title="§(g)(2) — Authorized-employee retraining">
        <p>
          The standard requires retraining whenever there&apos;s a
          change to machinery / processes / procedures, when new
          hazards are introduced, or when a periodic inspection
          reveals an authorized employee&apos;s knowledge is
          inadequate. The system creates triggers automatically:
        </p>
        <ul>
          <li>
            A periodic inspection signed with a non-empty{' '}
            <code>deviations</code> field creates a{' '}
            <code>deviation_observed</code> trigger for every
            observed authorized employee.
          </li>
          <li>
            Any insert / update / delete on{' '}
            <code>loto_energy_steps</code> creates a{' '}
            <code>procedure_change</code> trigger for every
            currently-trained worker on that procedure.
          </li>
          <li>
            Admins can open a trigger manually for any reason the
            standard names.
          </li>
        </ul>
        <p>
          <strong>Where to find them.</strong>{' '}
          <Link href="/admin/training-records">/admin/training-records</Link>{' '}
          surfaces open triggers in a retraining-attention panel above
          the records table.
        </p>
        <p>
          <strong>Resolving a trigger.</strong> Two paths:
        </p>
        <ul>
          <li>
            <em>Resolve with new training record</em> — opens the
            training record form pre-filled for the worker; on save,
            the new <code>loto_training_records</code> row is
            inserted and the trigger&apos;s <code>resolved_at</code>
            timestamp is set.
          </li>
          <li>
            <em>Mark resolved without retraining</em> — requires a
            note explaining why retraining isn&apos;t needed (e.g.
            &quot;wording fix only, no procedural change&quot;).
            The note is preserved in the audit log.
          </li>
        </ul>
      </Section>

      <Section id="audit" title="Where this lands for an OSHA inspector">
        <p>
          Three places to hand a CSHO:
        </p>
        <ul>
          <li>
            <strong>The signed inspector URL.</strong>{' '}
            <Link href="/admin/inspector">/admin/inspector</Link>
            {' '}generates a tokenized read-only snapshot covering a
            date range. The inspector sees inspections, group
            permits, training records, walkdowns — without logging in
            to the tenant.
          </li>
          <li>
            <strong>The compliance bundle.</strong>{' '}
            <Link href="/admin/compliance-bundle">/admin/compliance-bundle</Link>
            {' '}generates a date-range PDF including the per-permit
            SHA-256 hashes (sealed artifact support is the focus of
            Module 2&apos;s integrity work).
          </li>
          <li>
            <strong>The audit log.</strong>{' '}
            <Link href="/admin/audit">/admin/audit</Link> filtered by
            table (<code>loto_periodic_inspections</code>,{' '}
            <code>loto_group_permits</code>,{' '}
            <code>loto_competency_exam_attempts</code>,{' '}
            <code>loto_walkdown_checklists</code>) shows every
            insert / update / delete with actor and timestamp.
          </li>
        </ul>
      </Section>

      <Section id="changelog" title="Changelog">
        <ul>
          {CHANGELOG.map(entry => (
            <li key={entry.version}>
              <strong>v{entry.version}</strong>{' '}
              <span className="text-slate-500 dark:text-slate-400">({entry.date})</span>
              <ul className="ml-5 list-disc">
                {entry.changes.map((change, i) => <li key={i}>{change}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 space-y-2">
      <h2 className="text-xl font-semibold border-b border-slate-200 dark:border-slate-800 pb-1">
        {title}
      </h2>
      <div className="prose prose-slate dark:prose-invert text-sm leading-6 [&>p]:my-2 [&>ul]:my-2 [&>ul]:ml-5 [&>ul]:list-disc [&_a]:underline">
        {children}
      </div>
    </section>
  )
}
