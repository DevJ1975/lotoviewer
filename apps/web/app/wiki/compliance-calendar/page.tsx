import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-23'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-23', changes: ['Initial compliance calendar page.'] },
]

export default function WikiComplianceCalendarPage() {
  return (
    <WikiPage
      title="Compliance Calendar"
      subtitle="One place for every recurring compliance obligation — regulatory and tenant-defined."
      modulePath="/admin/compliance/calendar"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'seeding',  label: 'Regulatory seeding' },
        { id: 'completing', label: 'Completing obligations' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          The compliance calendar tracks recurring obligations — OSHA postings,
          Tier II filings, audits, reviews — each with an owner, a due date,
          and a completion history. Open items are grouped into{' '}
          <strong>Overdue</strong>, <strong>Due soon</strong>, and{' '}
          <strong>Upcoming</strong> so nothing slips.
        </p>
      </Section>

      <Section id="seeding" title="Regulatory seeding">
        <p>
          When you open the calendar, well-known regulatory deadlines are
          seeded automatically for the modules your tenant has enabled — for
          example, OSHA 300A posting and the ITA electronic submission appear
          once the Incidents module is on, and EPCRA Tier II appears with the
          Chemicals module. Seeded items are marked <em>Regulatory</em> and use
          the correct annual due date.
        </p>
      </Section>

      <Section id="completing" title="Completing obligations">
        <p>
          <strong>Mark done</strong> records a completion (who and when) and
          rolls the obligation forward to its next due date based on its
          cadence (annual, quarterly, etc.). One-time obligations are closed
          instead of recurring. Tenant-defined obligations can be added with
          the <strong>Add obligation</strong> button and deleted when no longer
          relevant.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Where do the pre-filled regulatory items come from?',
            a: <>They&apos;re seeded from a built-in catalog of federal deadlines,
              gated by the modules you have enabled. They only appear once, and
              re-opening the page won&apos;t duplicate them.</>,
          },
          {
            q: 'What does "Mark done" do to the due date?',
            a: <>It logs a completion event and advances the next due date by the
              obligation&apos;s cadence. A quarterly item jumps three months; an
              annual item jumps a year. One-time items are closed.</>,
          },
          {
            q: 'Can I attach proof?',
            a: <>Completion events carry an optional evidence reference and note.
              Richer evidence bundling is planned.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Assign an owner to every obligation so accountability is clear.',
            'Mark items done when the work is actually filed/posted — the history is your audit trail.',
            'Add site-specific obligations your facility carries beyond the federal defaults.',
          ]}
          donts={[
            'Don\'t delete a regulatory obligation to silence it — complete it or adjust its due date instead.',
            'Don\'t treat the seeded dates as legal advice; confirm deadlines against your jurisdiction.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundles' },
          { href: '/wiki/scorecard',         label: 'EHS Scorecard' },
          { href: '/wiki/notifications',     label: 'Notifications' },
        ]} />
      </Section>
    </WikiPage>
  )
}
