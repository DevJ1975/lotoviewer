import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial inspector-access wiki page.'] },
]

export default function WikiInspectorPage() {
  return (
    <WikiPage
      title="Inspector Access"
      subtitle="Mint signed read-only URLs that show permits in a date range to anyone — no login required."
      modulePath="/admin/inspector"
      audience="admin"
      category="Reports"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'how',      label: 'How the URL works' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          When an inspector or customer auditor lands on-site, you don&apos;t
          have time to provision them an account. Mint a signed URL with a
          date range + expiry, hand it over, and they see a read-only view
          of every confined-space and hot-work permit in that period.
        </p>
      </Section>

      <Section id="how" title="How the URL works">
        <p>
          The URL is a stateless signed token — the date range, label, and
          expiry are encoded in the signature, so revoking one URL doesn&apos;t
          revoke the others. The inspector can&apos;t edit anything; the
          page at <Link href="/inspector">/inspector</Link> verifies the
          signature on every request.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How long should I set the expiry?',
            a: <>Just long enough for the engagement: 1–2 days for an on-site
              walk-through, 7 days for a remote audit. Long expiries are
              harder to track once the URL gets shared.</>,
          },
          {
            q: 'What does the "label" field do?',
            a: <>It&apos;s a free-text identifier (e.g.,
              &quot;OSHA-Q2-2026&quot; or &quot;Customer audit — Acme&quot;)
              that&apos;s embedded in the URL and shown in the audit log so
              you can correlate URLs to engagements after the fact.</>,
          },
          {
            q: 'Can I revoke a URL early?',
            a: <>Not directly — the token is stateless and signed. Workarounds:
              wait it out, or rotate the signing secret in admin
              configuration (which invalidates every outstanding URL at once,
              so use sparingly).</>,
          },
          {
            q: 'What can the inspector do?',
            a: <>Read every permit in the period and download attached PDFs.
              They cannot: see other tenants, see anything outside the date
              range, or modify any record. The inspector page renders without
              a side drawer to prevent accidental over-exposure.</>,
          },
          {
            q: 'Is the inspector\'s activity logged?',
            a: <>The minting of the URL is logged. Page-views by the inspector
              are not — the URL is publicly bearer, and we don&apos;t want to
              imply per-user attribution we can&apos;t prove.</>,
          },
          {
            q: 'How is this different from a Compliance Bundle?',
            a: <>The bundle is a static PDF you hand over. Inspector access
              is a live page that updates as new permits are signed in the
              window — useful when an inspection spans more than a day.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Email the URL directly to the inspector\'s known email address — don\'t paste it into a shared chat.',
            'Use a descriptive label so audit reviewers six months later know what the URL was for.',
            'Pair the URL with a Compliance Bundle for the same window — the bundle is the archival record, the URL is the live view.',
            'Set the expiry to the day after the inspection ends, not "30 days just in case".',
          ]}
          donts={[
            'Don\'t paste the URL into Slack or Teams channels. Anyone with the link can read it.',
            'Don\'t shorten the URL through bit.ly/tinyurl — those services log the destination.',
            'Don\'t use the URL for internal users. They have accounts; account-based access is auditable per-user.',
            'Don\'t set the expiry to longer than the engagement requires.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
          { href: '/wiki/audit',             label: 'Audit Log' },
          { href: '/wiki/configuration',     label: 'Configuration' },
        ]} />
      </Section>
    </WikiPage>
  )
}
