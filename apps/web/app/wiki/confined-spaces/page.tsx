import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
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

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'What\'s the difference between permit-required and non-permit?',
            a: <>Permit-required spaces have one or more of: hazardous atmosphere
              potential, engulfment risk, internal configuration that could trap
              an entrant, or any other recognized serious hazard. The
              classification badge on each row reflects the
              <code> permit_required</code> column. Switching it requires an
              admin and is logged to <Link href="/admin/audit">/admin/audit</Link>.</>,
          },
          {
            q: 'How do I issue a permit?',
            a: <>Open a space, hit <strong>New permit</strong>, set the planned
              entry window + supervisor + attendant, then send the sign-on
              link to each entrant. The permit walks through pending →
              active → post-watch → complete, with required atmospheric
              readings at each transition.</>,
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
            'Cancel and re-issue the permit if anything material changes (rescue plan, isolation, attendant) rather than editing the active one.',
            'Use the import flow for new facilities — it scales to hundreds of spaces in one CSV.',
          ]}
          donts={[
            'Don\'t advance a permit past a reading flagged red. The whole point of the gate is to make that decision visible.',
            'Don\'t reuse one permit across multiple shifts — issue a fresh permit each shift so the supervisor on duty owns it.',
            'Don\'t classify a permit-required space as non-permit to skip the workflow. The reclassification itself is audited.',
            'Don\'t leave the "fire watch" countdown unattended — set a phone alarm matched to the post-watch period.',
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
