import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial insights wiki page.'] },
]

export default function WikiInsightsPage() {
  return (
    <WikiPage
      title="Risk Intelligence"
      subtitle="Worst spaces, anomalous atmospheric readings, supervisor activity breakdown."
      modulePath="/admin/insights"
      audience="admin"
      category="Reports"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'sections', label: 'The three panels' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Where the Scorecard says &quot;the trend is up,&quot; Risk
          Intelligence answers &quot;which spaces, which readings, which
          supervisors are driving it?&quot; Three drill-down panels over a
          configurable 30d–1y window.
        </p>
      </Section>

      <Section id="sections" title="The three panels">
        <ul>
          <li><strong>Spaces by failure rate.</strong> Confined spaces ranked
            by the proportion of atmospheric tests that came back red. A
            minimum-test floor (<code>MIN_FAIL_RANK_TESTS</code>) prevents
            a single bad reading on a rarely-entered space from topping the
            list.</li>
          <li><strong>Atmospheric anomalies.</strong> Z-scored readings that
            sit outside the normal range for the same space + gas. Useful
            for catching monitor calibration drift before it bites.</li>
          <li><strong>Supervisor activity.</strong> Permits issued, signed,
            and canceled per supervisor. Reads as a workload signal, not a
            performance metric.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Why does a space I know is bad not appear in "worst spaces"?',
            a: <>Either it didn&apos;t cross the minimum-tests floor (rare
              entry) or its failure rate is lower than the top-N cutoff. Open
              the space directly to see the full test history.</>,
          },
          {
            q: 'What\'s a "z-score anomaly"?',
            a: <>For each space + gas, the system computes the rolling mean
              and standard deviation of past readings. A reading more than
              ~2 standard deviations away from that mean shows up as an
              anomaly. Often it&apos;s a real hazard; sometimes it&apos;s a
              monitor that needs calibration.</>,
          },
          {
            q: 'Do supervisor counts include canceled permits?',
            a: <>Yes — both issued and canceled show separately. A
              supervisor with a high cancel rate isn&apos;t necessarily
              wrong; it can mean they&apos;re catching scope changes
              correctly. Use it as a starting point for a conversation,
              not a verdict.</>,
          },
          {
            q: 'Can I change the time window?',
            a: <>Yes — the window selector at the top toggles 30 days, 90
              days, 180 days, 1 year. Longer windows smooth out noise; shorter
              windows surface fresh issues.</>,
          },
          {
            q: 'Why don\'t I see hot-work data here?',
            a: <>Hot-work analytics live alongside hot-work permits at{' '}
              <Link href="/hot-work/status">/hot-work/status</Link>. Risk
              Intelligence is currently confined-space focused; that’s the
              dataset with the volume to make the anomaly math meaningful.</>,
          },
          {
            q: 'Is the data exportable?',
            a: <>Not directly from this page; include the underlying records
              in a <Link href="/admin/compliance-bundle">compliance bundle</Link>{' '}
              if you need a permanent archive.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Use the worst-spaces list to prioritize the next round of engineering controls.',
            'Investigate every atmospheric anomaly within a week — calibration drift compounds quietly.',
            'Pair the supervisor-activity panel with training-record data before drawing conclusions.',
            'Cross-check anomalies against the on-shift weather + production schedule; they often correlate.',
          ]}
          donts={[
            'Don\'t use supervisor-activity counts in performance reviews. The signal is workload, not skill.',
            'Don\'t dismiss anomalies as "monitor problems" without bench-testing the monitor.',
            'Don\'t hide spaces from the worst list by lowering test frequency — the system will surface that pattern too.',
            'Don\'t aggregate across tenants. Each tenant\'s baselines are different.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/scorecard',         label: 'EHS Scorecard' },
          { href: '/wiki/confined-spaces',   label: 'Confined Spaces' },
          { href: '/wiki/training-records',  label: 'Training Records' },
        ]} />
      </Section>
    </WikiPage>
  )
}
