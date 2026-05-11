import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial training-records wiki page.'] },
]

export default function WikiTrainingPage() {
  return (
    <WikiPage
      title="Training Records"
      subtitle="§1910.146(g) confined-space training certifications, by role."
      modulePath="/admin/training-records"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'roles',    label: 'Tracked roles' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          A register of confined-space training certifications per OSHA
          §1910.146(g). Filter by role, look up an individual&apos;s status,
          and prove competency at audit time. Records are add/delete only —
          edits create a new row so the timeline stays intact.
        </p>
      </Section>

      <Section id="roles" title="Tracked roles">
        <ul>
          <li><strong>Entrant</strong> — enters the space.</li>
          <li><strong>Attendant</strong> — stands watch outside.</li>
          <li><strong>Entry supervisor</strong> — authorizes the permit.</li>
          <li><strong>Rescuer</strong> — trained to retrieve from the space.</li>
          <li><strong>Other</strong> — non-OSHA roles tracked for completeness.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How do I add a record?',
            a: <>Click <strong>Add record</strong>, pick the user + role +
              completion date + expiration date + the document URL (uploaded
              elsewhere — e.g., your LMS). The record appears immediately in
              filtered views.</>,
          },
          {
            q: 'A cert was entered with the wrong date. How do I fix it?',
            a: <>Delete the bad row and add the correct one. Both actions
              show in <Link href="/admin/audit">/admin/audit</Link> with
              your name and timestamps. There&apos;s no in-place edit by
              design — keeping the trail clean is the whole point.</>,
          },
          {
            q: 'Does the system block a user from being assigned a permit if their cert expired?',
            a: <>Not automatically — the cert expiration is informational
              today. Adding hard blocks is on the roadmap; in the meantime
              the supervisor is responsible for checking before signing.</>,
          },
          {
            q: 'Can the user upload their own cert document?',
            a: <>No — admins enter records on the user&apos;s behalf. The
              source-of-truth document lives in your LMS or document store;
              this register holds the URL pointer + the metadata.</>,
          },
          {
            q: 'Where do I see who\'s about to expire?',
            a: <>Sort by expiration date — the about-to-expire rows surface
              at the top. There&apos;s a 30-day-warning visual that turns
              the row amber.</>,
          },
          {
            q: 'Does this cover hot-work training?',
            a: <>Not currently — the schema is purpose-built for §1910.146.
              Hot-work training records typically live in your LMS; link to
              them in the configuration page if you need them surfaced.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Enter the cert URL pointing to the LMS-of-record copy. The audit value comes from the document, not the row.',
            'Re-enter the cert when it\'s renewed; the previous row stays in the timeline.',
            'Audit the register quarterly against your LMS to catch drift.',
            'Use the role filter when planning a permit — it answers "who\'s qualified to be the attendant tomorrow?" in one click.',
          ]}
          donts={[
            'Don\'t use this as your training source-of-truth. Your LMS owns the document; this is the index.',
            'Don\'t backdate a cert to "fix" a missed renewal. The audit log captures the entry timestamp regardless.',
            'Don\'t add roles outside the documented set without coordination — workflow filters expect them.',
            'Don\'t leave expired rows undated. Either renew or remove with a note.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/confined-spaces',   label: 'Confined Spaces' },
          { href: '/wiki/users',             label: 'Users & Roles' },
          { href: '/wiki/audit',             label: 'Audit Log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
