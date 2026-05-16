import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-15'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-05-15',
    changes: [
      'Initial publication for the LOTO compliance module: §147(c)(4)(ii) ' +
      'structured procedure phases, §147(c)(6) annual periodic inspection + ' +
      'walkdown checklists, §147(c)(7) competency exams, §147(f)(2) contractor ' +
      'companies, §147(f)(3)/(f)(4) group permits with shift-change handoff, and ' +
      '§147(g)(2) authorized-employee retraining triggers.',
    ],
  },
]

export default function WikiLotoCompliancePage() {
  return (
    <WikiPage
      title="LOTO Compliance"
      subtitle="29 CFR 1910.147 — periodic inspections, group permits, contractors, competency, retraining."
      modulePath="/admin/periodic-inspections"
      audience="admin"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',  label: 'What it\'s for' },
        { id: 'phases',    label: '§(c)(4)(ii) — procedure phases' },
        { id: 'periodic',  label: '§(c)(6) — annual inspection' },
        { id: 'walkdown',  label: '§(c)(6) — walkdown checklist' },
        { id: 'competency',label: '§(c)(7) — competency exams' },
        { id: 'group',     label: '§(f)(3)/(f)(4) — group LOTO' },
        { id: 'contractors',label:'§(f)(2) — contractors' },
        { id: 'retraining',label: '§(g)(2) — retraining' },
        { id: 'faq',       label: 'FAQ' },
        { id: 'dodonts',   label: 'Do\'s & Don\'ts' },
        { id: 'related',   label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          The base LOTO module captures equipment, photos, and placards.
          The Compliance module turns that catalog into an OSHA-defensible
          management system by adding the seven §1910.147 obligations that
          a plant manager will be asked for during an inspection: documented
          procedure phases, annual periodic review, group lockout, contractor
          coordination, competency verification, walkdown observations, and
          retraining triggers tied to procedure changes and observed deviations.
        </p>
        <p>
          Every record is tenant-scoped, audit-logged, and surfaces on the{' '}
          <Link href="/admin/compliance-bundle">compliance bundle</Link> for
          a date-range export.
        </p>
      </Section>

      <Section id="phases" title="§(c)(4)(ii) — Structured procedure phases">
        <p>
          The standard requires a documented sequence: shutdown, isolate,
          release stored energy, lockout, verify zero energy (the
          &quot;tryout&quot;). Every energy step on every equipment now
          carries a phase tag and an explicit sequence order. The placard
          generator refuses to publish a placard that's missing a required
          phase — the most common citation in §147 is a procedure with no
          verify-zero-energy step.
        </p>
        <p>
          Edit phases inline from the equipment detail page; the placard
          regenerates in real time and groups steps by phase on the
          printable PDF.
        </p>
      </Section>

      <Section id="periodic" title="§(c)(6) — Annual periodic inspection">
        <p>
          Every energy-control procedure must be inspected at least
          annually by an authorized employee <em>other than</em> one
          using it. The inspection records the inspector, the authorized
          employees observed using the procedure, any deviations
          discovered, and corrective actions taken — then it&apos;s signed
          and frozen.
        </p>
        <p>
          The list at <Link href="/admin/periodic-inspections">
          /admin/periodic-inspections</Link> groups equipment into four
          cohorts (<strong>overdue</strong>, <strong>due within 30 days</strong>,
          <strong> never inspected</strong>, <strong>current</strong>) so a
          compliance lead can target the right pieces first. The dashboard
          widget surfaces the overdue count on <Link href="/loto">/loto</Link>
          {' '}and <Link href="/status">/status</Link>.
        </p>
      </Section>

      <Section id="walkdown" title="§(c)(6) — Walkdown checklist">
        <p>
          The annual periodic inspection is paired with a structured
          walkdown checklist that captures field-level observations
          alongside the certification: procedure available at point of
          use, energy sources match the procedure, lock points accessible,
          try-out step verified, authorized employees can demonstrate the
          procedure, and tags legible. Each item supports a status
          (pass / fail / N/A), inspector notes, and an optional photo
          stored in the loto-photos bucket.
        </p>
        <p>
          The signoff button is gated: a fail without notes blocks the
          signature. The N/A status itself counts as documentation —
          &quot;this item doesn&apos;t apply to this equipment&quot; is a
          valid record.
        </p>
      </Section>

      <Section id="competency" title="§(c)(7) — Competency exams">
        <p>
          Training records establish that an employee was instructed.
          Competency exams establish that an authorized employee actually
          knows the procedure. The proctored exam workflow at{' '}
          <Link href="/admin/competency-exams">/admin/competency-exams</Link>
          lets admins build multiple-choice exams scoped by role
          (operator, supervisor, energy isolation, rescue), proctor an
          attempt with the worker, and — on a pass — auto-create the
          training record so a separate data-entry step isn&apos;t needed.
        </p>
        <p>
          Question validation catches the common authoring errors
          (empty prompt, fewer than two choices, duplicate choices,
          out-of-bounds answer index) at save time, not at proctoring
          time.
        </p>
      </Section>

      <Section id="group" title="§(f)(3) / (f)(4) — Group LOTO + shift change">
        <p>
          The most-requested LOTO workflow we shipped in this release.
          A group permit names a primary authorized employee, attaches
          one or more equipment IDs (free-text — works for bays and
          circuits too, not just cataloged equipment), and lets each
          crew member attach their personal lock with its own serial.
          The system refuses to close the permit while any member still
          has a lock attached.
        </p>
        <p>
          Shift handoff is a first-class action: the outgoing primary
          hands off to a named incoming primary, the audit row captures
          the transition, and the permit status flips to{' '}
          <code>shift_handed_off</code>. You cannot hand off to yourself,
          and you cannot hand off a closed permit.
        </p>
      </Section>

      <Section id="contractors" title="§(f)(2) — Contractor companies">
        <p>
          Multi-employer worksites carry the obligation to inform outside
          contractors of the host&apos;s energy-control procedures and to
          receive their procedures in return. The contractor register at{' '}
          <Link href="/admin/contractors">/admin/contractors</Link>
          captures the company, primary contact, insurance expiry, and
          the host-procedure acknowledgement (who acknowledged on the
          host side, and when). Workers on the host roster can be tagged
          to a contractor company so their training and PPE checks roll
          up by employer.
        </p>
        <p>
          Insurance expiry is bucketed (current / expiring / expired)
          with a 30-day warning window and a 7-day post-expiry grace
          window. A renewal-reminder digest is wired into the helper
          surface; a cron job to actually send the email is on the
          Module 3 roadmap.
        </p>
      </Section>

      <Section id="retraining" title="§(g)(2) — Authorized-employee retraining">
        <p>
          The standard requires retraining when there&apos;s a change to
          machinery / processes / procedures, when a new hazard is
          introduced, or whenever a periodic inspection reveals that an
          authorized employee&apos;s knowledge is inadequate. The system
          creates a retraining trigger automatically in three cases:
        </p>
        <ul>
          <li>A periodic inspection signed with a non-empty
              <code>deviations</code> field creates a{' '}
              <code>deviation_observed</code> trigger for every
              authorized employee observed using the procedure.</li>
          <li>Any insert / update / delete on{' '}
              <code>loto_energy_steps</code> creates a{' '}
              <code>procedure_change</code> trigger for every currently-
              trained worker on that equipment.</li>
          <li>Admins can manually open a trigger for any of the
              standard&apos;s named reasons.</li>
        </ul>
        <p>
          Open triggers surface on{' '}
          <Link href="/admin/training-records">/admin/training-records</Link>
          in a retraining-attention panel. Resolve a trigger by linking a
          new training record (the system creates it) or by marking the
          trigger resolved without retraining (requires a note).
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Who can perform a §(c)(6) periodic inspection?',
            a: <>An authorized employee <em>other than</em> the one using
              the procedure. The system records the inspector by user ID
              and stores a snapshot of which authorized employees they
              observed. The training-records gate is the source of truth
              for &quot;is this user authorized&quot;; the inspection form
              does not re-litigate it.</>,
          },
          {
            q: 'My placard generator refused — what does that mean?',
            a: <>The procedure is missing at least one of the four
              required phases (isolate, release stored energy, lockout,
              verify zero energy). Open the equipment detail page, click
              <strong> Edit steps</strong>, add the missing phase, save,
              and regenerate. The shutdown phase is optional — the
              standard documents it but doesn&apos;t require it on every
              procedure.</>,
          },
          {
            q: 'Can a group permit cover equipment in multiple departments?',
            a: <>Yes. The <code>equipment_ids</code> field is a free-text
              array; the UI suggests catalog matches but doesn&apos;t
              require them. A turnaround that pulls four pumps from
              three departments is a single group permit.</>,
          },
          {
            q: 'A contractor\'s insurance expired today. What happens?',
            a: <>The contractor is bucketed as <em>expiring</em> through
              today and flips to <em>expired</em> tomorrow. They remain
              in the digest for 7 calendar days after expiry, then drop
              out — re-activating the contractor requires updating the
              expiry date in the admin form.</>,
          },
          {
            q: 'I edited an energy step — why did 12 retraining triggers appear?',
            a: <>Because 12 workers are currently trained on that equipment.
              §(g)(2) requires retraining whenever the procedure changes.
              The triggers are advisory: review them, decide whether the
              edit was material enough to warrant retraining, and resolve
              each trigger explicitly. Trivial edits (a typo in a step
              label) can be marked resolved-without-retraining with a note
              like &quot;wording fix only, no procedure change&quot;.</>,
          },
          {
            q: 'Can a competency exam attempt be deleted if the worker fails?',
            a: <>No. Attempts are immutable once submitted; a failure is a
              real record. Re-take the exam — the new attempt becomes the
              authoritative one. The audit log preserves both.</>,
          },
          {
            q: 'Does this module enforce anything client-side that the DB doesn\'t?',
            a: <>The TypeScript helpers in <code>packages/core</code>
              {' '}duplicate the DB-side invariants (cannot close a group
              permit with active members, cannot add a member without a
              primary, cannot sign a walkdown with unaddressed fails).
              The point is to disable buttons before the user clicks them;
              the DB is still the source of truth and will reject the
              same operations if a client misbehaves.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Schedule the §(c)(6) inspection at the same cadence as your existing PM walkdowns — the data needed for both overlaps significantly.',
            'Use the walkdown photo evidence: a photo of the lockable disconnect with the lock on it is the most defensible record possible for "lock points accessible".',
            'Tag every contractor worker to a contractor company at intake — the host-procedure acknowledgement is a per-company event, not a per-worker one.',
            'Use group permits for any multi-craft job — the §(f)(3) workflow is what the standard expects, not "everyone applies a personal lock to the disconnect".',
            'Run the competency exam adjacent to the initial training session, not weeks later — the proctored format is most defensible when the connection between training and verification is fresh.',
          ]}
          donts={[
            'Don\'t treat the §(c)(6) periodic inspection as a paperwork task. The standard requires observation of an authorized employee actually using the procedure — record their names in the form.',
            'Don\'t close a group permit while members are still attached — the DB will reject it, but more importantly, an open group lock with no documentation of who removed the last personal lock is the worst-case audit finding.',
            'Don\'t reuse a single periodic inspection for a family of equipment. Each procedure gets its own row. The denormalized next-due date on loto_equipment is per-equipment.',
            'Don\'t bypass the retraining-trigger panel. If you suppress triggers without resolution, the §(g)(2) audit trail rots and the system can\'t defend you under inspection.',
            'Don\'t let a contractor work without an active host-procedure acknowledgement on file. The admin/contractors page is the gate; treat it like a vendor onboarding control.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/loto',              label: 'LOTO (base module)' },
          { href: '/wiki/training-records',  label: 'Training records' },
          { href: '/wiki/loto-devices',      label: 'Lock + tag devices' },
          { href: '/wiki/audit',             label: 'Audit log' },
          { href: '/wiki/compliance-bundle', label: 'Compliance bundle' },
          { href: '/wiki/review-portal',     label: 'Client review portal' },
        ]} />
      </Section>
    </WikiPage>
  )
}
