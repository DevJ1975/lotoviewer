import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-05-05',
    changes: [
      'Initial wiki page for the LOTO module. Long-form usage docs live ' +
      'at /loto/manual; this page is the FAQ + Do\'s & Don\'ts companion.',
    ],
  },
]

export default function WikiLotoPage() {
  return (
    <WikiPage
      title="Lockout / Tagout (LOTO)"
      subtitle="Equipment, photos, placards, decommission, and device tracking."
      modulePath="/loto"
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
          LOTO is the equipment-and-placard module. Every piece of equipment
          that needs lockout/tagout has a record with two photos (the
          equipment + the isolation point), an energy-source tag, optional
          ISO callouts, and a printable placard. Maintenance and EHS open it
          daily to capture photos in the field and re-print placards.
        </p>
        <p>
          The long-form usage guide is at{' '}
          <Link href="/loto/manual">/loto/manual</Link>. This page is the
          quick-reference FAQ.
        </p>
      </Section>

      <Section id="who" title="Who uses it">
        <ul>
          <li><strong>Maintenance techs</strong> — capture photos, mark verification, re-print placards.</li>
          <li><strong>EHS director</strong> — review status, batch-print updated placards, send for client review.</li>
          <li><strong>Admins</strong> — manage the device inventory at <Link href="/admin/loto-devices">/admin/loto-devices</Link>.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Why don\'t I see the LOTO module in the side drawer?',
            a: <>The LOTO module is toggled per-tenant. If your tenant has it
              switched off, the row disappears entirely. Ask your administrator
              or a superadmin to enable it from
              {' '}<Link href="/superadmin">/superadmin</Link>.</>,
          },
          {
            q: 'How do I add a new piece of equipment?',
            a: <>Open <Link href="/loto">/loto</Link>, click <strong>Add equipment</strong> in
              the left toolbar, fill in the equipment id + description + department, then
              capture both photos from the equipment detail screen. For more
              than ~20 items at a time, use{' '}
              <Link href="/import">CSV import</Link>.</>,
          },
          {
            q: 'My photo upload says it failed — what now?',
            a: <>Photo uploads retry up to four times with exponential backoff.
              If they all fail you&apos;ll see an error toast — usually a network
              issue. The photo is queued in the browser; reload the page once
              you&apos;re back online and tap the equipment again to retry.
              HEIC photos from iPhone are converted to JPEG automatically.</>,
          },
          {
            q: 'What does the AI photo validator do?',
            a: <>When you upload an isolation photo, Claude Haiku checks that
              the image actually shows an electrical/hydraulic isolation point
              (not a selfie or the wrong piece of equipment). If it can&apos;t
              find one you&apos;ll see a warning, but the upload still goes
              through — the human is the final reviewer.</>,
          },
          {
            q: 'How do I print all placards for a department in one PDF?',
            a: <>Open <Link href="/print">/print</Link>, switch to{' '}
              <em>Group by department</em>, expand the department, and hit{' '}
              <strong>Download merged PDF</strong>. The PDF is built in your
              browser via <code>pdf-lib</code>, so a slow network won&apos;t
              hold it up.</>,
          },
          {
            q: 'I retired a piece of equipment. Where did it go?',
            a: <>Decommissioned items disappear from <Link href="/loto">/loto</Link>{' '}
              and the print queue but stay in the database with their full audit
              trail. Find them on <Link href="/decommission">/decommission</Link>{' '}
              and use <strong>Restore</strong> to bring one back.</>,
          },
          {
            q: 'Can a customer review my placards without a Soteria login?',
            a: <>Yes — open the department detail page, click{' '}
              <strong>Send for client review</strong>, enter the reviewer&apos;s
              name + email, and submit. They get an emailed tokenized link. See
              the <Link href="/wiki/review-portal">review-portal wiki</Link> for
              the full workflow.</>,
          },
          {
            q: 'What does the photo-status pill mean?',
            a: <>It&apos;s computed live from the actual storage URLs (not a
              cached boolean), so it never lies. <em>Complete</em> = both
              photos uploaded; <em>Partial</em> = one photo; <em>Missing</em> = none.</>,
          },
          {
            q: 'Does signing a placard create an audit record?',
            a: <>Yes — the typed name, drawn signature, and timestamp are
              written to <code>loto_reviews</code> and the signed PDF is
              stored in Supabase Storage. View the full chain at{' '}
              <Link href="/admin/audit">/admin/audit</Link>.</>,
          },
          {
            q: 'Can I work offline?',
            a: <>Yes, partially — the dashboard caches your last view in
              localStorage so it&apos;s readable offline, and equipment edits
              + decommission actions are queued and replay when you reconnect.
              Photo capture works offline; uploads queue until a connection
              returns. Placard PDFs <em>cannot</em> be regenerated offline.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Take the isolation photo straight-on so the lock point is unambiguous to a tech who has never been on this machine before.',
            'Annotate the ISO photo with arrows pointing at the exact lock point — the placard renders the annotations on top.',
            'Re-print the placard whenever the energy source or isolation point changes; the QR code on the placard links back to the equipment record.',
            'Verify (sign off) placards in pairs — the second-person verification is what holds up in front of an inspector.',
          ]}
          donts={[
            'Don\'t reuse equipment ids across tenants by hand — the system already scopes ids per tenant, but human-typed duplicates inside one tenant cause CSV import conflicts.',
            'Don\'t delete equipment records to "clean up" — use Decommission. Hard deletes break the audit trail.',
            'Don\'t mark verification on someone else\'s behalf — the audit log records the signed-in user.',
            'Don\'t take the equipment photo with a person in the frame; placards are public-facing on the shop floor.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/loto-devices',     label: 'LOTO Devices' },
          { href: '/wiki/review-portal',    label: 'Client Review Portal' },
          { href: '/wiki/audit',            label: 'Audit Log' },
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
        ]} />
      </Section>
    </WikiPage>
  )
}
