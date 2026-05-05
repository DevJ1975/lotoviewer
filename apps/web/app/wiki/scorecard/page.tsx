import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial scorecard wiki page.'] },
]

export default function WikiScorecardPage() {
  return (
    <WikiPage
      title="EHS Scorecard"
      subtitle="Strategic KPI dashboard with selectable time windows."
      modulePath="/admin/scorecard"
      audience="admin"
      category="Reports"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'metrics',  label: 'What it measures' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          The home dashboard answers &quot;what&apos;s happening right now?&quot;
          The scorecard answers &quot;how are we trending?&quot; — chartable
          KPIs over a selectable 7d / 30d / 90d window, intended for the
          weekly EHS director&apos;s review and monthly leadership reports.
        </p>
      </Section>

      <Section id="metrics" title="What it measures">
        <ul>
          <li>Confined-space permits issued, completed, expired, canceled</li>
          <li>Hot-work permits by outcome (clean / fire-observed / canceled)</li>
          <li>Atmospheric-test failures and the spaces that drove them</li>
          <li>Near-miss volume + severity mix</li>
          <li>Open vs. closed risks, residual-score distribution</li>
          <li>LOTO photo-completion percentage trend</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Why is this admin-only?',
            a: <>The scorecard rolls up tenant-wide data the typical
              technician shouldn&apos;t need (and shouldn&apos;t be measured
              against publicly). Admins and the EHS director get the
              strategic view; the operational data is on the home dashboard.</>,
          },
          {
            q: 'How fresh is the data?',
            a: <>The chart pulls live from Postgres on each render — there&apos;s
              no caching layer. If you don&apos;t see a permit you just signed,
              refresh the page.</>,
          },
          {
            q: 'Can I export the underlying numbers?',
            a: <>Not yet — the scorecard is read-only. Use the{' '}
              <Link href="/admin/compliance-bundle">compliance bundle</Link>{' '}
              for a permanent dated export, or pull straight from the Supabase
              dashboard if you need raw rows.</>,
          },
          {
            q: 'Why does the trend shift when I change the window?',
            a: <>The bars are sized to the selected window&apos;s peak so the
              shape is readable at any scale. Switch back to 30d if you&apos;re
              comparing trends across reviews.</>,
          },
          {
            q: 'Can I see one department only?',
            a: <>Not from the scorecard — it&apos;s a tenant-wide view by
              design. Use the per-module filters
              (<Link href="/risk/list">/risk/list</Link>,{' '}
              <Link href="/near-miss">/near-miss</Link>) for departmental
              cuts.</>,
          },
          {
            q: 'My tenant doesn\'t use one of the modules — does it still show?',
            a: <>The tile collapses to a &quot;no data&quot; placeholder so you
              don&apos;t mistake an empty module for zero activity.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Walk through the scorecard at the same cadence each week so trend reads stay comparable.',
            'Pair scorecard trends with the Risk Intelligence module to find the drivers behind the numbers.',
            'Screenshot the 30d view at month-end for the leadership pack — it\'s the cleanest comparison view.',
            'Check the scorecard before issuing tenant-wide changes; you\'ll spot regressions sooner.',
          ]}
          donts={[
            'Don\'t use scorecard numbers in incentive plans — gaming them undermines the data.',
            'Don\'t compare two tenants on this page; switch tenants to compare side-by-side.',
            'Don\'t take a single week\'s spike at face value — open the underlying module to confirm before raising it.',
            'Don\'t treat "zero permits" as healthy. Zero usually means under-reporting, not perfect safety.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/insights',          label: 'Risk Intelligence' },
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
          { href: '/wiki/audit',             label: 'Audit Log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
