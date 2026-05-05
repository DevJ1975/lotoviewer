import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial audit-log wiki page.'] },
]

export default function WikiAuditPage() {
  return (
    <WikiPage
      title="Audit Log"
      subtitle="Per-row change history with actor, timestamp, and old/new values."
      modulePath="/admin/audit"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'rows',     label: 'What a row contains' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          The system-of-record for &quot;who changed what, when?&quot;
          Captures every INSERT / UPDATE / DELETE on tenant-scoped tables
          with the actor, the operation, and the old + new values. This is
          the page an OSHA inspector will ask for first.
        </p>
      </Section>

      <Section id="rows" title="What a row contains">
        <ul>
          <li><strong>When</strong> — server timestamp at the moment of the change.</li>
          <li><strong>Who</strong> — the signed-in user, resolved to email + name.</li>
          <li><strong>Where</strong> — the table and the row id.</li>
          <li><strong>What</strong> — operation badge (INSERT green / UPDATE blue / DELETE red).</li>
          <li><strong>Diff</strong> — expandable JSON of the old and new values.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How far back does the log go?',
            a: <>Forever, as long as the row hasn&apos;t been pruned by a
              superadmin migration. Standard practice is to keep at least 7
              years for OSHA, longer for some industries.</>,
          },
          {
            q: 'Can I edit or delete an audit row?',
            a: <>No — the table is append-only and protected by RLS. Even
              superadmins can&apos;t delete rows from the UI. If a true
              correction is needed (e.g., GDPR), it requires a documented
              migration and shows up in <Link href="/admin/hygiene-log">/admin/hygiene-log</Link>.</>,
          },
          {
            q: 'Why is the log paginated to 100 rows?',
            a: <>Performance and readability. Use the table + operation
              filters to narrow the view; a wide-open scroll across millions
              of rows isn&apos;t a useful audit task anyway.</>,
          },
          {
            q: 'What\'s in the JSON diff?',
            a: <>The old row, the new row, and the keys that changed. The
              UI highlights changed keys; the raw JSON is also available
              for export.</>,
          },
          {
            q: 'I see DELETE rows but the data still appears in the app. Why?',
            a: <>Most modules use soft-delete (decommission, cancel, revoke)
              rather than physical DELETE. A DELETE in the audit log is rare
              and worth investigating; usually it&apos;s a development-only
              table or a superadmin migration.</>,
          },
          {
            q: 'Can I export the log?',
            a: <>Filter to the rows you need, then use the per-page export.
              For period-bound exports, include audit data in a{' '}
              <Link href="/admin/compliance-bundle">compliance bundle</Link>.</>,
          },
          {
            q: 'Does the log capture file uploads (photos, signatures)?',
            a: <>The audit log captures the row mutation that points at the
              uploaded file. The file itself lives in Supabase Storage with
              its own access log; the two are correlated by URL.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Filter by the table you care about first, then by user — much faster than scrolling.',
            'Bookmark a filtered URL for recurring audits (the filter state lives in the URL).',
            'Use the audit log when investigating "what changed?" before reaching for git or Slack.',
            'Reference audit row ids in incident reports and customer communications.',
          ]}
          donts={[
            'Don\'t share screenshots of audit rows externally without redacting personal data.',
            'Don\'t use the log as a metrics source — Risk Intelligence and Scorecard are designed for that.',
            'Don\'t expect to find auth events here (logins, password resets); those live in Supabase Auth\'s own log.',
            'Don\'t try to bulk-delete old rows. The whole point is the unbroken chain.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/hygiene-log',       label: 'Hygiene Log' },
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
          { href: '/wiki/users',             label: 'Users & Roles' },
        ]} />
      </Section>
    </WikiPage>
  )
}
