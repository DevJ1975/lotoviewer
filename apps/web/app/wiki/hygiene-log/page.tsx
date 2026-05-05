import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial hygiene-log wiki page.'] },
]

export default function WikiHygienePage() {
  return (
    <WikiPage
      title="Data Hygiene Log"
      subtitle="High-level log of data-cleanup operations — one row per business decision."
      modulePath="/admin/hygiene-log"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'kinds',    label: 'What gets logged' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          One step up from the audit log: instead of every row mutation, the
          hygiene log records the business decisions that drove a sequence
          of mutations — bulk decommissions, department renames, FK repairs,
          orphan cleanups, snapshots, error recoveries. The audit log shows
          the rows; this log shows the why.
        </p>
      </Section>

      <Section id="kinds" title="What gets logged">
        <ul>
          <li><strong>decommission</strong> — bulk equipment retirement.</li>
          <li><strong>rename</strong> — department or other label changes.</li>
          <li><strong>fk-repair</strong> — fixing a foreign-key inconsistency.</li>
          <li><strong>orphan</strong> — removing rows whose parents are gone.</li>
          <li><strong>snapshot</strong> — taking a point-in-time data export.</li>
          <li><strong>error</strong> — corrective action taken in response to a bug.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Why isn\'t this in /admin/audit?',
            a: <>Because one decision (&quot;rename Maintenance to Maintenance &amp; Reliability&quot;)
              can produce hundreds of audit rows. The hygiene log gives the
              one-liner; the audit log gives the row-by-row.</>,
          },
          {
            q: 'Who can write to this log?',
            a: <>Admins write rows when they perform documented one-off
              operations. Migration scripts (run by superadmins) auto-write
              their action so the trail isn&apos;t broken.</>,
          },
          {
            q: 'Can a row be edited?',
            a: <>No. If you got the description wrong, add a follow-up row
              referencing the original.</>,
          },
          {
            q: 'How is this filterable?',
            a: <>By action kind and by date range. The default view is the
              last 90 days.</>,
          },
          {
            q: 'Do hygiene-log entries show up in compliance bundles?',
            a: <>The hygiene log itself isn&apos;t included by default,
              since it&apos;s an internal-operations record. If an inspector
              specifically asks &quot;what data corrections did you make?&quot;,
              export this view directly.</>,
          },
          {
            q: 'Should I log routine work here?',
            a: <>No — routine module use shouldn&apos;t generate hygiene-log
              entries. Reserve it for &quot;I had to do something out of the
              normal flow&quot;.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Write the hygiene-log entry before performing the cleanup so the audit trail starts with intent.',
            'Use clear action descriptions a peer can read in 12 months without context.',
            'Reference ticket numbers, PR numbers, or incident ids that motivated the operation.',
            'Pair every "error" entry with the root-cause analysis link.',
          ]}
          donts={[
            'Don\'t use this log for normal user activity. The audit log is for that.',
            'Don\'t paper over a bug by deleting affected rows without an "error" hygiene entry — the omission becomes the evidence.',
            'Don\'t lump multiple operations into one log entry. One decision per row keeps the timeline searchable.',
            'Don\'t skip logging because "no one will look". The reason this exists is that someone, eventually, looks.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/audit',             label: 'Audit Log' },
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
        ]} />
      </Section>
    </WikiPage>
  )
}
