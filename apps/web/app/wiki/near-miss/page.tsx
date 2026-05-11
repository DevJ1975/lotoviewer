import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial near-miss wiki page.'] },
]

export default function WikiNearMissPage() {
  return (
    <WikiPage
      title="Near-Miss Reporting"
      subtitle="Triage incident reports and escalate them to the risk register."
      modulePath="/near-miss"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'lifecycle', label: 'Report lifecycle' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Capture the &quot;almost happened&quot; moments that don&apos;t
          rise to a recordable injury but absolutely should be reviewed.
          Reports are filterable by severity and routable to the risk
          register when they uncover a systemic hazard.
        </p>
      </Section>

      <Section id="lifecycle" title="Report lifecycle">
        <ul>
          <li><strong>New</strong> — just submitted, awaiting triage.</li>
          <li><strong>Triaged</strong> — severity confirmed, routed to an owner.</li>
          <li><strong>Investigating</strong> — root cause analysis in progress.</li>
          <li><strong>Closed</strong> — corrective actions complete.</li>
          <li><strong>Escalated</strong> — promoted to a risk in the{' '}
            <Link href="/risk">risk register</Link>.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Should I report something that didn\'t hurt anyone?',
            a: <>Yes — that&apos;s exactly the point of near-miss reporting.
              The patterns across many small reports are what catch the
              underlying conditions before they cause injury.</>,
          },
          {
            q: 'How is severity assigned?',
            a: <>The reporter picks an initial severity (low / moderate /
              high / extreme) based on the worst credible outcome of the
              event. The triager can adjust it; the change is logged.</>,
          },
          {
            q: 'What happens when I escalate to risk?',
            a: <>A draft risk is created in the register linked back to this
              near-miss. The draft is editable until accepted; once accepted,
              the near-miss row shows the linked risk id.</>,
          },
          {
            q: 'Can I report anonymously?',
            a: <>Reports are tied to your signed-in account so the audit
              trail is complete, but the report body is visible only to the
              triagers and admins. If you need true anonymity, talk to your
              EHS lead about a separate channel.</>,
          },
          {
            q: 'How do I find old reports?',
            a: <>The list defaults to active (not-yet-closed) reports.
              Toggle the &quot;Show closed&quot; filter at the top of the
              list to see historical reports.</>,
          },
          {
            q: 'Why can\'t I edit a closed report?',
            a: <>Closed reports are immutable so the corrective-action
              record holds up to audit. To add new information, open a
              follow-up report and reference the original.</>,
          },
          {
            q: 'Are near-miss reports surfaced in any KPIs?',
            a: <>Yes — the EHS Scorecard tracks count + severity-mix over
              time, and the Risk Intelligence module highlights spikes.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Report within 24 hours while the details are fresh and the witnesses are still on shift.',
            'Describe the conditions, not just the event ("oily floor in aisle 3" tells the next investigator what to look for).',
            'Escalate to the risk register the moment you see the same near-miss for the second time.',
            'Close reports promptly with the corrective action — open reports lose meaning.',
          ]}
          donts={[
            'Don\'t use near-miss to assign blame. The point is the system, not the person.',
            'Don\'t downgrade severity to make a backlog look better. Triagers can see the original severity.',
            'Don\'t open multiple reports for the same event. If a peer already filed it, comment on theirs.',
            'Don\'t skip the "what could have happened" field. That\'s the field a regulator will read first.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/risk',     label: 'Risk Assessment' },
          { href: '/wiki/scorecard', label: 'EHS Scorecard' },
          { href: '/wiki/insights',  label: 'Risk Intelligence' },
        ]} />
      </Section>
    </WikiPage>
  )
}
