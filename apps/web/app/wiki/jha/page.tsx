import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial JHA wiki page covering Slice 1–3 (header, breakdown editor, review cadence).'] },
]

export default function WikiJhaPage() {
  return (
    <WikiPage
      title="Job Hazard Analysis (JHA)"
      subtitle="Per-task hazard breakdowns with steps, hazards, controls, and a frequency-driven review cadence (ISO 45001 6.1.2.2 + Cal/OSHA T8 §3203)."
      modulePath="/jha"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'states',   label: 'JHA states' },
        { id: 'cadence',  label: 'Review cadence' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          A JHA breaks a task into steps, lists the hazards in each step,
          and records the controls that bring residual risk to an
          acceptable level. The register at <Link href="/jha">/jha</Link>{' '}
          tracks every JHA in your tenant with its status, frequency, and
          next review date.
        </p>
      </Section>

      <Section id="states" title="JHA states">
        <ul>
          <li><strong>Draft</strong> — being authored; not yet reviewed.</li>
          <li><strong>In review</strong> — submitted for sign-off.</li>
          <li><strong>Approved</strong> — current version of record. Used in the field.</li>
          <li><strong>Superseded</strong> — replaced by a newer version; kept for the audit trail.</li>
        </ul>
      </Section>

      <Section id="cadence" title="Review cadence">
        <p>
          The system computes <code>next_review_date</code> from the JHA&apos;s{' '}
          <strong>frequency</strong> field. Higher-cadence tasks are reviewed
          more often:
        </p>
        <ul>
          <li><strong>Continuous</strong> — review every 90 days (quarterly).</li>
          <li><strong>Daily / Weekly / Monthly</strong> — review every 180 days (semi-annually).</li>
          <li><strong>Quarterly / Annually</strong> — review every 1–2 years.</li>
          <li><strong>As needed</strong> — review every ~2 years.</li>
        </ul>
        <p>
          A nightly cron flags overdue JHAs in the register. See{' '}
          <Link href="/admin/scorecard">/admin/scorecard</Link> for the
          on-time-review trend.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How do I create a new JHA?',
            a: <>Open <Link href="/jha">/jha</Link>, hit{' '}
              <strong>New JHA</strong>, fill in the task name, frequency,
              and reviewer. That creates the header in <em>Draft</em>.
              Open the JHA detail page to add steps, hazards, and controls.
              Admin role required to create.</>,
          },
          {
            q: 'Why doesn\'t the New JHA button show for me?',
            a: <>Creation requires <code>is_admin</code> or
              <code> is_superadmin</code>. Members can read every JHA but
              not author one. Ask your administrator for the role bump if
              you need to author.</>,
          },
          {
            q: 'I edited an approved JHA — what happens?',
            a: <>Editing an approved JHA marks it <em>superseded</em> and
              creates a fresh draft you continue editing. The superseded
              version stays in the register so audit history is intact;
              the new draft moves through review and approval again.</>,
          },
          {
            q: 'How are residual risk scores computed?',
            a: <>Each hazard gets an inherent severity (low / moderate /
              high / extreme). Each control attached to a hazard reduces
              the residual band. The detail page shows both inherent and
              residual side-by-side so an inspector can see what the
              controls bought you.</>,
          },
          {
            q: 'What\'s the difference between JHA and Risk Assessment?',
            a: <>JHA is task-level (step → hazard → control), aimed at the
              crew about to do the work. Risk Assessment is hazard-level
              across the facility (heat-map, register, controls library).
              The two complement each other: JHAs surface hazards that
              should also be tracked in the risk register.</>,
          },
          {
            q: 'Can I attach a JHA to a permit?',
            a: <>Not yet — the cross-link is planned. In the meantime,
              reference the JHA id in the permit&apos;s notes field and the
              clickable link will work via the work-order URL template at{' '}
              <Link href="/admin/configuration">/admin/configuration</Link>.</>,
          },
          {
            q: 'A JHA shows "review overdue" — what do I do?',
            a: <>Open it, review the steps + hazards + controls against
              current conditions, then mark it reviewed. If anything
              material changed, edit it (which supersedes and creates a
              new draft for re-approval).</>,
          },
          {
            q: 'Can I export a JHA as a PDF for a tailgate meeting?',
            a: <>Not yet from the JHA module directly. Include the JHA in
              your next <Link href="/admin/compliance-bundle">compliance bundle</Link>{' '}
              or copy/paste from the detail page into a tailgate template.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Write JHA steps in the order the worker performs them. The order is the document\'s value.',
            'Pick the frequency that matches actual task cadence — it drives the review schedule and shows up on the scorecard.',
            'Author the JHA with someone who actually does the task. Desk-authored JHAs miss real hazards.',
            'Mark a JHA reviewed even if no changes are needed. The review date is itself an audit signal.',
          ]}
          donts={[
            'Don\'t skip the residual score after adding a control. The whole point is to show what the control bought.',
            'Don\'t edit an approved JHA in place hoping no one notices — every edit supersedes and creates a fresh draft.',
            'Don\'t set everything to "as needed" to avoid the review cadence. Inspectors see the cadence-vs-actual gap immediately.',
            'Don\'t delete a superseded JHA. The superseded chain is the document trail.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/risk',              label: 'Risk Assessment' },
          { href: '/wiki/near-miss',         label: 'Near-Miss' },
          { href: '/wiki/training-records',  label: 'Training Records' },
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
        ]} />
      </Section>
    </WikiPage>
  )
}
