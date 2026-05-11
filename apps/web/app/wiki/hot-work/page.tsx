import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial hot-work wiki page.'] },
]

export default function WikiHotWorkPage() {
  return (
    <WikiPage
      title="Hot Work Permits"
      subtitle="Permit lifecycle for welding, cutting, grinding — with countdown timers and post-work fire watch."
      modulePath="/hot-work"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'states',   label: 'Permit states' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Issue, sign, and close hot-work permits without paper. Live
          countdown timers track the active work window and the post-work
          fire-watch period (typically 30+ minutes after grinding/welding
          stops). The full state machine is auditable end-to-end.
        </p>
      </Section>

      <Section id="states" title="Permit states">
        <ul>
          <li><strong>Pending</strong> — created, awaiting supervisor signature.</li>
          <li><strong>Active</strong> — work is happening; the active-window countdown ticks every second.</li>
          <li><strong>Post-watch</strong> — work complete, fire watch in progress; second countdown ticks.</li>
          <li><strong>Complete</strong> — fire watch ended, permit closed cleanly.</li>
          <li><strong>Expired</strong> — the active window ran out before the supervisor signed work-complete.</li>
          <li><strong>Canceled</strong> — supervisor or admin terminated the permit early.</li>
          <li><strong>Fire observed</strong> — emergency cancel; flagged in red on the status board.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How do I issue a new hot-work permit?',
            a: <>Open <Link href="/hot-work">/hot-work</Link>, click{' '}
              <strong>New permit</strong>, fill in the location, work
              description, planned start + duration, and the fire-watch
              duration. The supervisor signs and the permit moves to{' '}
              <em>Active</em>.</>,
          },
          {
            q: 'What does the live countdown represent?',
            a: <>While <em>Active</em>, it counts down to the planned end of
              hot work. While <em>Post-watch</em>, it counts down to the end
              of the fire-watch period. Both tick every second so a supervisor
              walking past a tablet can see at a glance how much time is left.</>,
          },
          {
            q: 'A spark caught — how do I trigger an emergency stop?',
            a: <>On the active permit, hit <strong>Fire observed</strong>.
              The permit moves to a flagged <em>fire observed</em> state, a
              webhook fires (if configured), and the post-watch can be
              extended manually. The original timestamps stay in the
              audit trail.</>,
          },
          {
            q: 'My permit expired — can I reopen it?',
            a: <>No. Issue a fresh permit; the expired one stays in the
              history. This is intentional: a missed sign-off is a real
              compliance event and the audit log shows it.</>,
          },
          {
            q: 'Can the same permit cover multiple shifts?',
            a: <>No — issue a per-shift permit so the supervisor on duty
              owns it. The status board groups them by date so this
              doesn&apos;t clutter the view.</>,
          },
          {
            q: 'Where do these permits show up for an auditor?',
            a: <>Three places: the live status board at{' '}
              <Link href="/hot-work/status">/hot-work/status</Link>, the
              audit log at <Link href="/admin/audit">/admin/audit</Link>{' '}
              (filter by <code>hot_work_permits</code>), and any compliance
              bundle generated for the period.</>,
          },
          {
            q: 'Does signing happen on the device or via a link?',
            a: <>Both work. Sign on-device from the permit page, or send a
              tokenized sign-on link to the assignee — see the{' '}
              <Link href="/wiki/permit-signon">Permit Sign-on</Link> wiki.</>,
          },
          {
            q: 'Can I disable webhook notifications for one permit?',
            a: <>No — webhooks are tenant-wide and event-typed. If you
              don&apos;t want a downstream system pinged on every permit,
              remove the subscription at{' '}
              <Link href="/admin/webhooks">/admin/webhooks</Link>.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Set the post-watch duration based on the actual hazard, not the minimum (NFPA 51B suggests 30+ minutes; some jobs need 60+).',
            'Take a "before" photo of the work area attached to the permit so the post-watch attendant knows what to monitor.',
            'Cancel and re-issue if the scope expands materially — the original permit was scoped to the smaller job.',
            'Use Fire observed even for a near-miss spark; the audit trail value comes from honest reporting.',
          ]}
          donts={[
            'Don\'t pre-sign permits at the start of the day. The signature is what triggers the active-window countdown.',
            'Don\'t close a permit while the post-watch countdown is still running. The system blocks this for a reason.',
            'Don\'t hand off a permit between supervisors mid-job. Cancel and re-issue under the new supervisor.',
            'Don\'t use hot-work permits for routine shop welding inside a designated welding bay — that\'s outside the regulatory scope.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/permit-signon',     label: 'Permit Sign-on' },
          { href: '/wiki/webhooks',          label: 'Webhooks' },
          { href: '/wiki/audit',             label: 'Audit Log' },
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
        ]} />
      </Section>
    </WikiPage>
  )
}
