import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial support wiki page.'] },
]

export default function WikiSupportPage() {
  return (
    <WikiPage
      title="Support"
      subtitle="Submit a bug report or feedback. Auto-captures session info that speeds up triage."
      modulePath="/support"
      audience="live"
      category="Workspace"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          The fastest path to a fix when something is broken. The form
          captures a title, severity, and free-text description; under the
          hood it also attaches the page URL you came from, your user agent,
          and your signed-in identity. Submissions are emailed to the
          Soteria team.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How quickly will someone respond?',
            a: <>Same business day for high-severity reports; within 48 hours
              otherwise. The severity dropdown drives routing, so don&apos;t
              undersell.</>,
          },
          {
            q: 'What\'s captured automatically?',
            a: <>Page URL when the form opened, browser user agent, and your
              signed-in email + name. The reporter identity field is
              read-only — that&apos;s the audit trail.</>,
          },
          {
            q: 'Can I attach a screenshot?',
            a: <>Not from the form yet — paste the screenshot into a follow-up
              email when the support team replies. Or include a step-by-step
              reproduction in the description.</>,
          },
          {
            q: 'Where do reports go?',
            a: <>An email to the Soteria triage queue. From there they&apos;re
              prioritized into the next sprint or hotfix.</>,
          },
          {
            q: 'Should I use Support for feature requests?',
            a: <>Yes — pick &quot;feedback&quot; for severity. Feature
              requests land in the same queue and get added to the roadmap
              backlog.</>,
          },
          {
            q: 'I\'m offline — can I still submit?',
            a: <>No — the form requires a network round-trip. Open it once
              you reconnect; the page URL will obviously be the wrong one,
              so include the URL of the broken page in the description.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Open the form from the page where the bug happened so the URL gets captured automatically.',
            'Include exact steps to reproduce — "click X then Y, expected Z, got W".',
            'Use severity honestly. Critical = data loss or compliance gap; high = workflow blocked; moderate = workaround exists.',
            'Mention your tenant id (visible in the header pill) if the report is tenant-specific.',
          ]}
          donts={[
            'Don\'t paste account passwords or tokenized URLs into the description. They land in email.',
            'Don\'t submit the same report multiple times. It clutters the queue and slows everyone down.',
            'Don\'t use Support to ask "how do I do X" — check this wiki first; the answer is probably already here.',
            'Don\'t mark trivial cosmetic issues as critical. The label loses meaning fast.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki',          label: 'Wiki home' },
          { href: '/wiki/welcome',  label: 'Welcome / First Login' },
        ]} />
      </Section>
    </WikiPage>
  )
}
