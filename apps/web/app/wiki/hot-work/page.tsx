import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.3.0'
const LAST_UPDATED    = '2026-10-20'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.3.0',
    date: '2026-10-20',
    changes: [
      'Hot work operators and fire watch personnel are now picked from the roster on the new-permit form instead of typed one per line. A typed name cannot be checked against anyone’s training; a roster entry can. The crew can now be changed on the permit page (Personnel → Edit crew) before signature and while the permit is active.',
      'Required training can now block a permit. When an admin requires a STRIKE module for hot-work permits, the permit cannot be signed until every operator and fire watcher holds a current pass — and the Permit Authorizing Individual recorded on the permit too, who must be on the roster or the signature is refused because their training cannot be verified. The database enforces this, so it cannot be clicked past.',
      'Train now: each worker missing training gets a QR code that opens the module on their own phone with no login. The link is for that one worker, expires after 30 minutes, and the panel updates when they pass.',
      'Emergency override: owners and admins can let blocked workers onto a permit with a written reason of at least 20 characters. It cannot be edited or deleted, is recorded in the audit log, and is emailed to every owner and admin.',
      'Training blocks nothing until an admin requires a module. Without a requirement, permits issue as before, including the older training-records warning and its "I have verified each worker’s training off-app" checkbox. Once hot work has a STRIKE requirement, the STRIKE check replaces that warning and checkbox.',
      'Corrected the overview and Do\'s, which still described a 30-minute fire watch; the minimum has been 60 minutes since 1.2.0.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-08-28',
    changes: [
      'The post-work fire watch is now enforced, not just displayed. NFPA 51B \u00a78.7 sets a 60-minute minimum and the permit form previously accepted as little as 1 minute; the minimum is now 60 (raise it per site if your insurer or AHJ requires longer \u2014 120 is common).',
      'A permit can no longer be closed out as "task complete" until the post-work fire watch has actually run. Mark the work complete to start the watch, then close out once it ends. The close-out button explains how long is left. Hot work leaves smouldering ignition that develops after the torch stops, which is the whole reason the watch exists.',
      'Cancelling for cause is deliberately NOT gated. "Fire observed", "unsafe condition", "expired" and "other" stay available at any moment \u2014 those are what you reach for when something is going wrong, and waiting on a timer to record one would be backwards.',
      'ACTION REQUIRED: permits issued before this change may carry a watch shorter than 60 minutes. Those records are left as they are, because they describe what actually happened and an inspector may read them \u2014 they are worth reviewing.',
    ],
  },
  { version: '1.1.0', date: '2026-05-24', changes: ['Area-condition photos: attach pre-work and post-work fire-watch photos directly to a permit (OSHA 1910.252 / NFPA 51B evidence).'] },
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
        { id: 'training', label: 'Required training' },
        { id: 'photos',   label: 'Area-condition photos' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Issue, sign, and close hot-work permits without paper. Live
          countdown timers track the active work window and the post-work
          fire-watch period (at least 60 minutes after grinding/welding
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

      <Section id="training" title="Required training">
        <p>
          Hot work operators and fire watch personnel are picked from the
          roster — on the <strong>New permit</strong> form, and under{' '}
          <strong>Personnel → Edit crew</strong> on the permit page while it
          is pending signature or active. Names are no longer typed, because
          a typed name cannot be checked against anyone&apos;s training; a
          roster entry can. If someone is missing from the search, add them
          under People first.
        </p>
        <p>
          When an admin has required a STRIKE module for hot-work permits,
          the <strong>Required training</strong> panel under Personnel shows
          each crew member&apos;s status, and the permit cannot be signed
          until everyone has a current pass. The check runs in the database
          at the moment of signing, so it cannot be clicked past. It also
          checks the Permit Authorizing Individual listed under Personnel
          (normally whoever created the permit, not whoever presses Sign). The
          panel shows the PAI&apos;s status alongside the crew, so they can use
          Train now too. The PAI must be on the roster (People): if their login
          is not linked to a roster entry, signing is refused because their
          training cannot be verified. Anyone added to
          the crew after the permit is signed must already hold a current
          pass, or the save is refused.
        </p>
        <ul>
          <li><strong>Train now</strong> — appears next to each missing
            module. It shows a QR code the worker scans with their own phone
            to take the module on the spot, with no login. The link is for
            that one worker and expires after 30 minutes. The panel updates
            when they pass.</li>
          <li><strong>Emergency override</strong> — owners and admins only,
            for when waiting is less safe than going ahead. Choose the blocked
            workers and write the reason (at least 20 characters). The
            override is permanent, recorded in the audit log, and emailed to
            every owner and admin.</li>
        </ul>
        <p>
          Training blocks nothing until an admin requires a module. With no
          requirement for hot work, permits issue as before and the older
          training-records warning, with its &ldquo;I have verified each
          worker&apos;s training off-app&rdquo; checkbox, still applies. Once a
          requirement exists, the STRIKE check replaces that warning and
          checkbox. Admins set requirements at{' '}
          <Link href="/strike/admin">STRIKE → Training admin</Link> →{' '}
          <strong>Required for work</strong>, choosing the module and how
          recent the pass must be: any current pass, fresh for each job
          (within 24 hours), within the last 90 days, or within the last year.
        </p>
      </Section>

      <Section id="photos" title="Area-condition photos">
        <p>
          Attach photos of the work area directly to a permit as
          §1910.252(a)(2) / NFPA 51B evidence — combustibles cleared to 35 ft,
          an extinguisher staged, the fire blanket or shield in place. Open a
          permit, scroll to <strong>Area condition photos</strong>, and tap{' '}
          <strong>Add photo</strong> (camera or library; HEIC is handled
          automatically). Each photo is tagged by lifecycle phase:
        </p>
        <ul>
          <li><strong>Pre-work</strong> — captured before the permit is marked
            work-complete; documents how the area was prepared.</li>
          <li><strong>Post-work</strong> — captured after work-complete;
            documents the fire-watch area while the post-watch countdown runs.</li>
        </ul>
        <p>
          Photos stay with the permit for the OSHA audit trail. Once a permit
          is closed the gallery is read-only.
        </p>
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
              audit log at <Link href="/admin/evidence/audit">/admin/evidence/audit</Link>{' '}
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
            q: 'Why can\'t I type an operator\'s or fire watcher\'s name any more?',
            a: <>Because a typed name cannot be checked against training
              records. Pick each person from the roster instead. If they are
              not on it, add them under People first, then pick them.</>,
          },
          {
            q: 'Signing is refused because required training is missing. What now?',
            a: <>Open <strong>Personnel</strong> on the permit and use{' '}
              <strong>Train now</strong> for each worker listed. Once
              everyone has passed, the panel shows <em>Crew ready</em> and you
              can sign. If waiting is less safe than going ahead, an owner or
              admin can record an <strong>Emergency override</strong> with a
              written reason; it is audited and emailed to every owner and
              admin.</>,
          },
          {
            q: 'Can I add someone to the crew after the permit is signed?',
            a: <>Yes, with <strong>Edit crew</strong> while the permit is
              active, but if hot work requires training they must already
              hold a current pass. Otherwise the save is refused.</>,
          },
          {
            q: 'Can I disable webhook notifications for one permit?',
            a: <>No — webhooks are tenant-wide and event-typed. If you
              don&apos;t want a downstream system pinged on every permit,
              remove the subscription at{' '}
              <Link href="/admin/platform/webhooks">/admin/platform/webhooks</Link>.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Set the post-watch duration based on the actual hazard, not the minimum (NFPA 51B sets a 60-minute minimum, which the form enforces; raise it if your insurer or AHJ requires longer).',
            'Attach a pre-work photo of the area (Area condition photos → Add photo) so the post-watch attendant knows what to monitor.',
            'Cancel and re-issue if the scope expands materially — the original permit was scoped to the smaller job.',
            'Use Fire observed even for a near-miss spark; the audit trail value comes from honest reporting.',
            'Pick the crew from the roster early and use Train now for anyone flagged, so the permit is ready when the PAI signs.',
          ]}
          donts={[
            'Don\'t pre-sign permits at the start of the day. The signature is what triggers the active-window countdown.',
            'Don\'t close a permit while the post-watch countdown is still running. The system blocks this for a reason.',
            'Don\'t hand off a permit between supervisors mid-job. Cancel and re-issue under the new supervisor.',
            'Don\'t use hot-work permits for routine shop welding inside a designated welding bay — that\'s outside the regulatory scope.',
            'Don\'t use the emergency training override to save time. It is for when waiting is less safe, and every use is audited and emailed to every owner and admin.',
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
