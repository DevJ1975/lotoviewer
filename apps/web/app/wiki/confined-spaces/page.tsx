import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.1.0'
const LAST_UPDATED    = '2026-10-20'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.1.0',
    date:    '2026-10-20',
    changes: [
      'Entrants and attendants on Issue Entry Permit are now picked from the roster instead of typed one per line, so their training can be checked. The printed permit still lists everyone by name.',
      '"Edit crew" replaces "Edit roster". It works before signature as well as mid-job, uses the same roster picker, and still refuses to remove anyone who is currently inside the space.',
      'When an admin requires a STRIKE module for confined-space entry, the permit cannot be signed until every entrant, every attendant and the signing entry supervisor holds a current pass. The entry supervisor must be on the roster too, or the signature is refused because their training cannot be verified. The database enforces this, and crew added after signing is checked too. For that permit type it replaces the name-matched §1910.146(g) training-record check and its acknowledgement checkbox.',
      'New Required training panel on the permit: status for each entrant and attendant, a "Train now" QR code so a worker can take the module on their phone on the spot, and an owner/admin emergency override that needs a written reason, is audited, and is emailed to every owner and admin.',
      'Nothing changes until an admin sets a requirement at STRIKE → Training admin → Required for work. Without one, the existing training-record check shows as before.',
    ],
  },
  {
    version: '1.0.0',
    date:    '2026-05-05',
    changes: ['Initial confined-spaces wiki page.'],
  },
]

export default function WikiConfinedSpacesPage() {
  return (
    <WikiPage
      title="Confined Spaces"
      subtitle="OSHA 1910.146 inventory, permits, and atmospheric tests."
      modulePath="/confined-spaces"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'who',      label: 'Who uses it' },
        { id: 'training', label: 'Required training' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          A register of every confined space in your facility, classified as
          permit-required or non-permit, with a permit lifecycle for entry
          jobs and atmospheric-test recording at each step. Replaces the
          paper permit binder and the &quot;was this LEL reading inside the
          tank?&quot; uncertainty an inspector will ask about.
        </p>
      </Section>

      <Section id="who" title="Who uses it">
        <ul>
          <li><strong>Entry supervisors</strong> — issue permits, sign people in/out, log atmospheric readings.</li>
          <li><strong>Attendants &amp; entrants</strong> — sign on via tokenized links from the supervisor.</li>
          <li><strong>EHS</strong> — review the permit history and import space inventories from CSV.</li>
        </ul>
      </Section>

      <Section id="training" title="Required training">
        <p>
          On <strong>Issue Entry Permit</strong>, entrants and attendants are
          picked from the roster instead of typed. A typed name can&apos;t be
          matched to anyone&apos;s training record; a roster pick can. The
          printed permit still lists everyone by name. If someone doesn&apos;t
          come up in the search, add them under People first.
        </p>
        <p>
          When an admin has made a STRIKE module required for confined-space
          entry, the permit cannot be signed until every entrant, every
          attendant and you, the entry supervisor, holds a current pass. The{' '}
          <strong>Required training</strong> panel on the permit shows
          everyone&apos;s status, including yours, and{' '}
          <strong>Sign &amp; activate</strong> stays disabled while anyone is
          missing a module. You must be on the roster yourself (People): if
          your login is not linked to a roster entry, the signature is refused
          because your training cannot be verified. Complete your own module
          in <Link href="/strike">STRIKE</Link> or with Train now before you
          sign. Anyone added through <strong>Edit crew</strong> after the
          permit is signed is checked as well.
        </p>
        <p>
          <strong>Train now</strong> next to a missing module shows a QR code.
          The worker scans it with their phone and takes the module there and
          then, with no login. The link is for that one worker and expires
          after 30 minutes. The panel updates when they pass.
        </p>
        <p>
          If waiting for training is less safe than going ahead, an owner or
          admin can record an <strong>emergency override</strong> from the
          panel: pick the workers and write a reason of at least 20
          characters. The override applies to this permit, cannot be undone, is
          written to the audit log, and is emailed to every owner and admin.
        </p>
        <p>
          Nothing changes until an admin requires a module. With no
          requirement, the permit page shows the existing §1910.146(g)
          training-record check as before. Admins set requirements at{' '}
          <Link href="/strike/admin">STRIKE → Training admin</Link> →{' '}
          <strong>Required for work</strong>, choosing how recent a pass must
          be: any current pass, fresh for each job (within 24 hours), within 90
          days, or within a year.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'What\'s the difference between permit-required and non-permit?',
            a: <>Permit-required spaces have one or more of: hazardous atmosphere
              potential, engulfment risk, internal configuration that could trap
              an entrant, or any other recognized serious hazard. The
              classification badge on each row reflects the
              <code> permit_required</code> column. Switching it requires an
              admin and is logged to <Link href="/admin/evidence/audit">/admin/evidence/audit</Link>.</>,
          },
          {
            q: 'How do I issue a permit?',
            a: <>Open a space, hit <strong>+ Issue permit</strong>, set the
              purpose and expiry, pick the entrants and attendants from the
              roster (you are recorded as the entry supervisor), then send the
              sign-on link to each entrant. The permit walks through pending →
              active → post-watch → complete, with required atmospheric
              readings at each transition.</>,
          },
          {
            q: 'Why can\'t I type entrant names any more?',
            a: <>Because a typed name can&apos;t be checked against anyone&apos;s
              training. Entrants and attendants are picked from the roster so
              the permit knows exactly who they are. The printed permit still
              lists them by name. If a worker isn&apos;t on the roster, add
              them under People first.</>,
          },
          {
            q: 'The permit won\'t sign because training is required. What now?',
            a: <>The <strong>Required training</strong> panel on the permit
              lists who is missing which module. Tap <strong>Train
              now</strong> and have the worker scan the QR code with their
              phone; the panel updates when they pass. If the work genuinely
              cannot wait, an owner or admin can record an emergency override
              for the workers in the panel with a written reason. It is
              audited and emailed to every owner and admin, so it is not a
              shortcut. The panel lists entrants and attendants only, so if it
              shows everyone ready and signing is still refused, read the
              message: it names who is missing, usually you as entry
              supervisor. Complete the module in STRIKE, then sign again.</>,
          },
          {
            q: 'Can I change the crew after the permit is issued?',
            a: <>Yes. <strong>Edit crew</strong> works before signature and
              mid-job. It will not let you remove an entrant who is still
              inside the space; log them out from the Entrant Log first. When a
              training requirement is set, anyone you add to a signed permit
              must already hold a current pass, or the save is refused.</>,
          },
          {
            q: 'What atmospheric thresholds does the app enforce?',
            a: <>The defaults are O₂ between 19.5–23.5%, LEL ≤ 10%, CO ≤ 25 ppm,
              H₂S ≤ 10 ppm. A reading outside the threshold is recorded with a
              red badge and blocks the permit from advancing until the supervisor
              re-tests or cancels. Thresholds can be tuned per tenant — ask an
              admin if your monitor calibrates differently.</>,
          },
          {
            q: 'A reading was wrong — can I edit it?',
            a: <>No — readings are append-only. Re-test and log a new reading;
              both readings stay in the history so an inspector sees the
              correction trail. If a reading was entered against the wrong
              permit, an admin can cancel the permit and start fresh.</>,
          },
          {
            q: 'What happens when a permit expires?',
            a: <>It moves to the <em>expired</em> state and stops accepting
              new readings or sign-ons. Anyone still inside must be checked
              out and the space re-tested before issuing a new permit.</>,
          },
          {
            q: 'Can I bulk-load my space inventory?',
            a: <>Yes — open <Link href="/confined-spaces/import">/confined-spaces/import</Link>{' '}
              and upload a CSV with the documented columns. The importer
              dry-runs first and flags duplicates before committing.</>,
          },
          {
            q: 'Where do permits show up for inspectors?',
            a: <>They land in two places: the live status board at{' '}
              <Link href="/confined-spaces/status">/confined-spaces/status</Link>{' '}
              and any compliance bundle generated for the period (see{' '}
              <Link href="/wiki/compliance-bundle">Compliance Bundle</Link>).</>,
          },
          {
            q: 'Do I need to be online to log a reading?',
            a: <>Yes. Atmospheric readings are written through to Supabase in
              real time so the audit trail can&apos;t drift. If you&apos;re
              offline, write the reading on paper and enter it the moment you
              regain signal — the timestamp on the row is server time.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Bump-test your monitor before every entry and record the calibration reading on the permit.',
            'Sign attendants in via the tokenized link rather than typing their name — the audit captures the device they signed from.',
            'Cancel and re-issue the permit if anything material changes (rescue plan, isolation) rather than editing the active one. Crew swaps go through Edit crew.',
            'Use the import flow for new facilities — it scales to hundreds of spaces in one CSV.',
          ]}
          donts={[
            'Don\'t advance a permit past a reading flagged red. The whole point of the gate is to make that decision visible.',
            'Don\'t reuse one permit across multiple shifts — issue a fresh permit each shift so the supervisor on duty owns it.',
            'Don\'t classify a permit-required space as non-permit to skip the workflow. The reclassification itself is audited.',
            'Don\'t leave the "fire watch" countdown unattended — set a phone alarm matched to the post-watch period.',
            'Don\'t use the emergency training override to save time. It is permanent, audited and emailed to every owner and admin; Train now is the normal way past missing training.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/permit-signon',     label: 'Permit Sign-on' },
          { href: '/wiki/training-records',  label: 'Training Records' },
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
          { href: '/wiki/webhooks',          label: 'Webhooks' },
        ]} />
      </Section>
    </WikiPage>
  )
}
