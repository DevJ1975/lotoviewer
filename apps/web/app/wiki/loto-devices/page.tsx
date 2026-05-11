import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial loto-devices wiki page.'] },
]

export default function WikiLotoDevicesPage() {
  return (
    <WikiPage
      title="LOTO Devices"
      subtitle="Inventory of physical lock + tag hardware, with checkout tracking and stale-checkout alerts."
      modulePath="/admin/loto-devices"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'states',   label: 'Device states' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          A register of every physical LOTO device in the facility (locks,
          tags, hasps, kits) with serial numbers, location, and current
          checkout. The page ticks every minute so a held-time display
          stays accurate; devices held longer than the stale threshold get
          a red banner — the &quot;lock left on a panel after shift
          change&quot; pattern.
        </p>
      </Section>

      <Section id="states" title="Device states">
        <ul>
          <li><strong>Available</strong> — sitting in the cabinet, ready to be checked out.</li>
          <li><strong>Checked out</strong> — assigned to a person, with checkout time and (optional) work order.</li>
          <li><strong>Maintenance</strong> — pulled out of service for inspection or repair.</li>
          <li><strong>Lost</strong> — declared missing; stays in inventory for the audit trail.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How do I add a new device?',
            a: <>Click <strong>Add device</strong>, enter type + serial +
              location. Serial numbers are unique per tenant; the page
              rejects duplicates up front.</>,
          },
          {
            q: 'A lock didn\'t come back. How do I close out a checkout?',
            a: <>Open the device, hit <strong>Force return</strong> with a
              note. The action is logged as a manual override under your
              account so the audit trail is honest.</>,
          },
          {
            q: 'What\'s "stale checkout" mean?',
            a: <>A device checked out longer than{' '}
              <code>STALE_CHECKOUT_HOURS</code> (configurable per tenant)
              gets a red banner. The intent is to surface devices that
              were probably forgotten on equipment, not in active use.</>,
          },
          {
            q: 'Can a non-admin check out a device?',
            a: <>Currently no — the page is admin-only. Most teams have a
              kit attendant who manages checkouts; if your workflow needs
              self-service, file a request.</>,
          },
          {
            q: 'What happens when I mark a device "lost"?',
            a: <>It drops out of the available inventory but stays in the
              database with the lost flag. If you find it, switch back to{' '}
              <em>available</em> and add a note.</>,
          },
          {
            q: 'Why is the held-time off by a minute?',
            a: <>The page ticks once per minute on a timer to keep CPU low
              on the kit-attendant&apos;s tablet. Reload to refresh
              immediately.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Engrave or label every device with the serial number you enter here. The match is the audit trail.',
            'Set the stale threshold based on your longest legitimate job, not the average.',
            'Audit the inventory monthly — devices walk off and the page can\'t catch what isn\'t entered.',
            'Add the work-order number to checkouts so you can correlate stale checkouts to specific jobs.',
          ]}
          donts={[
            'Don\'t delete a device record because it\'s lost — that breaks the audit trail. Mark it lost instead.',
            'Don\'t reuse a serial number when you replace a device. New device = new row.',
            'Don\'t close a stale checkout without a note explaining why. The note is what the inspector reads.',
            'Don\'t use this page to track non-LOTO assets (signs, hard hats). The schema is purpose-built for LOTO devices.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/loto',   label: 'LOTO module' },
          { href: '/wiki/audit',  label: 'Audit Log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
