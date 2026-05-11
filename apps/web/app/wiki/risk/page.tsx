import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial risk-assessment wiki page.'] },
]

export default function WikiRiskPage() {
  return (
    <WikiPage
      title="Risk Assessment"
      subtitle="5×5 heat-map, risk register, and a controls library."
      modulePath="/risk"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'scoring', label: 'How risks are scored' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          A live risk register with a 5×5 heat-map landing page. Click any
          cell to drill into risks at that severity × likelihood pair, manage
          mitigating controls from the controls library, and export to the
          compliance bundle.
        </p>
      </Section>

      <Section id="scoring" title="How risks are scored">
        <p>
          Each risk has a <strong>severity</strong> (1–5: negligible →
          catastrophic) and a <strong>likelihood</strong> (1–5: rare →
          almost certain). Their product is the risk score, color-coded on
          the heat-map. Adding controls can lower either dimension; the
          residual score is what shows up on the heat-map by default.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How does the heat-map decide what color a cell gets?',
            a: <>It maps to risk score: green (low, score 1–4), yellow
              (moderate, 5–9), orange (high, 10–15), red (extreme, 16–25).
              The colors mirror the standard EHS heat-map convention so an
              auditor recognizes it instantly.</>,
          },
          {
            q: 'Why don\'t I see a real-time update when a colleague adds a risk?',
            a: <>The heat-map polls when the tab regains visibility instead of
              opening a WebSocket — the savings on connection count matter at
              scale and the polling latency is &lt;1s when you switch tabs back.</>,
          },
          {
            q: 'How do controls reduce a risk score?',
            a: <>Each control attached to a risk declares the severity and
              likelihood reduction it provides. The system computes the
              residual score automatically. The original (inherent) score is
              preserved so an auditor can see what controls were credited.</>,
          },
          {
            q: 'Can I export the register to a spreadsheet?',
            a: <>Yes — open <Link href="/risk/export">/risk/export</Link>{' '}
              for CSV, or include the register in the next compliance bundle
              from <Link href="/admin/compliance-bundle">/admin/compliance-bundle</Link>.</>,
          },
          {
            q: 'Where do near-miss escalations end up?',
            a: <>A near-miss flagged for escalation creates a draft risk in
              the register. The draft is editable until you mark it accepted
              — at which point the link from the original near-miss becomes
              read-only.</>,
          },
          {
            q: 'Can I bulk-edit risks?',
            a: <>No — edits are per-risk so the audit trail captures the
              &quot;why&quot; for each change. For one-time bulk migrations contact a
              superadmin who can run a migration script and log it under{' '}
              <Link href="/admin/hygiene-log">/admin/hygiene-log</Link>.</>,
          },
          {
            q: 'How do I see only risks in my department?',
            a: <>Use the filter pills above the register. The filter is
              persisted in the URL, so the filtered view is shareable.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Score severity based on the worst credible outcome, not the worst conceivable outcome — keeps the heat-map signal high.',
            'Attach controls before discussing risk acceptance; the residual score is what management actually owns.',
            'Review the top 5 weekly during the EHS standup — the panel exists for exactly this conversation.',
            'Link risks to the near-miss or audit finding that surfaced them so the lineage stays intact.',
          ]}
          donts={[
            'Don\'t set every risk to severity=5 to get attention. The heat-map loses meaning and reviewers stop trusting it.',
            'Don\'t delete a risk because the hazard was eliminated — mark it closed with the control that retired it.',
            'Don\'t edit the inherent score after a control is added. Add the control and let the residual score update.',
            'Don\'t treat the heat-map as a compliance deliverable on its own. Pair it with the controls list and a quarterly review.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/near-miss',         label: 'Near-Miss' },
          { href: '/wiki/insights',          label: 'Risk Intelligence' },
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
          { href: '/wiki/audit',             label: 'Audit Log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
