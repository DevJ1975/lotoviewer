import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-06-23'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-06-23',
    changes: [
      'Initial Training & Competency Matrix wiki page (shipped v1.13.0): ' +
      'org-wide member × course grid, course catalog, per-position ' +
      'requirements, and the member-keyed completion store.',
    ],
  },
]

export default function WikiTrainingCompetencyMatrixPage() {
  return (
    <WikiPage
      title="Training & Competency Matrix"
      subtitle="One org-wide grid of required training by worker and course — with live expiry status, a course catalog, and per-position requirements."
      modulePath="/admin/people/training-competency-matrix"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',    label: 'What it\'s for' },
        { id: 'tabs',        label: 'The three tabs' },
        { id: 'status',      label: 'How status is computed' },
        { id: 'recording',   label: 'Recording a completion' },
        { id: 'finding',     label: 'Where to find it' },
        { id: 'vs-records',  label: 'Matrix vs. Training records' },
        { id: 'faq',         label: 'FAQ' },
        { id: 'dodonts',     label: 'Do\'s & Don\'ts' },
        { id: 'related',     label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          The Training &amp; Competency Matrix answers one question at a glance:
          <em> who is current on the training their job requires, and who has gaps?</em>{' '}
          It pivots every active worker against every course they are required
          to hold, and colors each cell by readiness — current, due soon,
          overdue, or missing. Completions are stored against the worker&apos;s
          member record (not a free-text name), so the same completion shows up
          here, in the worker&apos;s readiness view, and in audit exports
          without re-keying.
        </p>
      </Section>

      <Section id="tabs" title="The three tabs">
        <ul>
          <li>
            <strong>Matrix</strong> — the grid. One row per active member, one
            column per required course, one status per cell. This is the
            at-a-glance compliance picture and the place you record completions.
          </li>
          <li>
            <strong>Course catalog</strong> — the list of trainings the
            organization recognizes. Each course has a code, title, category,
            an optional <strong>validity window</strong> (in months — how long a
            completion stays current), and a <strong>required-for-all</strong>{' '}
            flag for org-wide trainings everyone must hold.
          </li>
          <li>
            <strong>Requirements</strong> — which courses each{' '}
            <strong>position</strong> must hold. This is what makes the matrix
            role-aware: a welder&apos;s required columns differ from a
            supervisor&apos;s.
          </li>
        </ul>
      </Section>

      <Section id="status" title="How status is computed">
        <p>
          A worker is required to hold a course when it is{' '}
          <strong>required for all</strong> <em>or</em> required by their
          current <strong>position</strong>. For each required course the matrix
          finds the worker&apos;s most recent completion and derives a status:
        </p>
        <ul>
          <li><strong>Current</strong> — completed, and not expiring within 30 days.</li>
          <li><strong>Due soon</strong> — expires within the next 30 days.</li>
          <li><strong>Overdue</strong> — the expiry date is in the past.</li>
          <li><strong>Missing</strong> — no completion on record.</li>
        </ul>
        <p>
          Expiry is derived from the course&apos;s validity window: a completion
          on a course with a 12-month validity expires 12 months later. Courses
          with no validity window never expire (one-time trainings).
        </p>
      </Section>

      <Section id="recording" title="Recording a completion">
        <p>
          Click a cell in the <strong>Matrix</strong> tab to record that
          worker&apos;s completion of that course. Enter the completion date; the
          expiry date is computed automatically from the course&apos;s validity
          window, and the cell flips to its new status immediately. Because the
          completion is keyed to the member, it also updates the worker&apos;s{' '}
          <Link href="/my-safety-readiness">My Safety Readiness</Link> view.
        </p>
      </Section>

      <Section id="finding" title="Where to find it">
        <p>
          The matrix lives under <strong>Administration</strong> with its own
          grid icon (distinct from Training records). You can reach it from:
        </p>
        <ul>
          <li>The left navigation drawer&apos;s <strong>Administration</strong> group, and the command palette (⌘/Ctrl-K).</li>
          <li><Link href="/admin">Admin</Link> → <strong>People &amp; Access</strong> tile.</li>
          <li>A banner link at the top of <Link href="/admin/loto/training-records">Training records</Link>.</li>
          <li>An admin card on the home dashboard.</li>
          <li>The admin links on a worker&apos;s <Link href="/my-safety-readiness">My Safety Readiness</Link> page.</li>
        </ul>
      </Section>

      <Section id="vs-records" title="Matrix vs. Training records">
        <p>
          Both read from the same store, but answer different questions.{' '}
          <Link href="/admin/loto/training-records">Training records</Link> is
          the §1910.146(g) confined-space certification register — entrant,
          attendant, entry supervisor, rescuer — recorded per worker. The{' '}
          <strong>matrix</strong> is the org-wide, course-driven, role-aware view
          of <em>all</em> required training, showing gaps across the whole
          roster. Use Training records to log and prove a specific confined-space
          cert; use the matrix to see who&apos;s short on anything their position
          requires.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'A worker has completions but doesn\'t show any cells. Why?',
            a: <>The matrix is requirement-driven: a worker only gets columns
              for courses they&apos;re required to hold. If they have no
              position (or their position has no requirements) and there are no
              required-for-all courses, they have nothing required — so no
              cells. Assign a position on the <Link href="/admin/people/training-competency-matrix">Requirements</Link> tab,
              or mark the course required-for-all.</>,
          },
          {
            q: 'How do I make one course mandatory for everyone?',
            a: <>On the <strong>Course catalog</strong> tab, set the course&apos;s{' '}
              <strong>required-for-all</strong> flag. Every active worker then
              gets that column, regardless of position.</>,
          },
          {
            q: 'A completion expired but the worker re-trained — how do I refresh it?',
            a: <>Record the new completion on the cell. The matrix always uses
              the most recent completion, so the latest date wins and the cell
              returns to <em>current</em>.</>,
          },
          {
            q: 'Why does a cert show "due soon" when it doesn\'t expire for weeks?',
            a: <>The due-soon window is the next 30 days. It&apos;s an early
              warning so you can schedule the refresher before it lapses, not
              after.</>,
          },
          {
            q: 'What if a worker isn\'t in the matrix at all?',
            a: <>The matrix only lists <em>active</em> members. Confirm the
              worker has an active member record; archived or merged workers are
              excluded by design.</>,
          },
          {
            q: 'Do older name-only training records show up here?',
            a: <>Yes — legacy records were reconciled to member records, so a
              completion entered before the matrix existed still appears against
              the right worker as long as it&apos;s linked to a member and the
              course is one they&apos;re required to hold.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Build the course catalog first (with realistic validity windows), then map requirements to positions — the matrix is only as complete as those two lists.',
            'Use required-for-all for genuinely universal training (e.g., site orientation) and positions for role-specific training.',
            'Work the "due soon" column proactively — it exists to prevent lapses, not just report them.',
            'Keep position assignments current; the matrix shows a worker\'s required columns based on their current position.',
          ]}
          donts={[
            'Don\'t expect a completion to appear as a cell unless the worker is required to hold that course — recording one against a non-required course won\'t surface it.',
            'Don\'t set a validity window of "never" on a cert that legally must be refreshed — it will read current forever.',
            'Don\'t treat the matrix as the document store; like Training records, it holds the status, not the certificate file.',
            'Don\'t use it to track ad-hoc microlearning — STRIKE is the place for non-certificate training.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/training-records', label: 'Training Records' },
          { href: '/wiki/loto-compliance',  label: 'LOTO Compliance' },
          { href: '/wiki/users',            label: 'Users & Roles' },
        ]} />
      </Section>
    </WikiPage>
  )
}
