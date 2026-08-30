import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.1.0'
const LAST_UPDATED    = '2026-06-19'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.1.0', date: '2026-06-19', changes: ['Submitting a template in the "hazard_hunt" category now records a Hazard Hunt finding per failed item and drafts a CSP write-up. See the Hazard Hunt module.'] },
  { version: '1.0.0', date: '2026-05-23', changes: ['Initial inspections module page.'] },
]

export default function WikiInspectionsPage() {
  return (
    <WikiPage
      title="Inspections"
      subtitle="Build your own inspection and audit checklists, then run them in the field with automatic scoring."
      modulePath="/inspections"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'building',   label: 'Building templates' },
        { id: 'running',    label: 'Running an inspection' },
        { id: 'scoring',    label: 'Scoring' },
        { id: 'faq',        label: 'FAQ' },
        { id: 'dodonts',    label: 'Do\'s & Don\'ts' },
        { id: 'related',    label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          A configurable inspection engine. Admins build reusable checklist
          templates; field users run them and get an instant pass/fail score.
          It complements — it does not replace — the regulated equipment-readiness
          and hazardous-waste inspection flows.
        </p>
      </Section>

      <Section id="building" title="Building templates">
        <p>
          Under <strong>Admin → Inspections → Inspection templates</strong>, add
          items of several types: pass/fail/N-A, numeric (with tolerance),
          multiple choice, text, photo, and signature. Each scorable item has a
          weight, and any item can be flagged <em>fail → action</em> so a failure
          is surfaced for follow-up.
        </p>
      </Section>

      <Section id="running" title="Running an inspection">
        <p>
          From <strong>Inspections</strong>, pick a template and start a run.
          Answer each item and submit. Submitting locks the inspection and
          records the score; items flagged <em>fail → action</em> are surfaced as
          required corrective actions.
        </p>
      </Section>

      <Section id="scoring" title="Scoring">
        <p>
          Only pass/fail, numeric, and multiple-choice items count toward the
          score. The score is the weighted share of passing answers; N/A and
          unanswered items are excluded. The overall result is <strong>Fail</strong>
          if any scorable item failed, otherwise <strong>Pass</strong>.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Can I edit a template after inspections have used it?',
            a: <>Disabling a template keeps past inspections intact. Editing/
              versioning templates in place is on the roadmap; for now, create a
              new template for substantial changes.</>,
          },
          {
            q: 'What happens to a failed item flagged "fail → action"?',
            a: <>It&apos;s recorded on the submitted inspection and returned as a
              required action. Formal CAPA queue integration is a planned
              follow-up.</>,
          },
          {
            q: 'How is a numeric item scored?',
            a: <>If the item has a min/max tolerance, the value is graded pass/fail
              automatically; otherwise record the reading and grade it manually.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Keep templates focused — one checklist per task or area.',
            'Flag the items that must trigger follow-up with "fail → action".',
            'Use weights to make critical items count more toward the score.',
          ]}
          donts={[
            'Don\'t rebuild the regulated equipment-readiness or hazwaste inspections here — those have their own compliant flows.',
            'Don\'t delete a template mid-program; disable it so history stays intact.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/equipment-readiness', label: 'Equipment Readiness' },
          { href: '/wiki/compliance-calendar', label: 'Compliance Calendar' },
          { href: '/wiki/risk',                label: 'Risk Assessment' },
        ]} />
      </Section>
    </WikiPage>
  )
}
