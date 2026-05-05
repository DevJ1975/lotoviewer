import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial configuration wiki page.'] },
]

export default function WikiConfigurationPage() {
  return (
    <WikiPage
      title="Configuration"
      subtitle="Org-level settings: work-order URL template + push-dispatch webhook."
      modulePath="/admin/configuration"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'sections', label: 'The two sections' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Tenant-wide knobs that don&apos;t belong inside a per-feature
          screen: the URL template for clickable work-order references on
          permits, and the push-dispatch webhook that lets your CMMS
          auto-create a permit from an external system.
        </p>
      </Section>

      <Section id="sections" title="The two sections">
        <ul>
          <li><strong>Work-order URL template.</strong> Pattern with{' '}
            <code>&#123;wo&#125;</code> placeholder. Permits with a work-order
            reference render the value as a hyperlink to your CMMS so
            supervisors can jump straight to the source job.</li>
          <li><strong>Push-dispatch webhook.</strong> Inbound endpoint
            secret. External systems POST a permit payload here; the
            payload is verified against the secret and a draft permit is
            created in the matching module.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'What does the work-order URL template look like?',
            a: <>Something like <code>https://maximo.acme.com/wo/&#123;wo&#125;</code>{' '}
              — the literal <code>&#123;wo&#125;</code> is replaced with the
              work-order id at render time. URL-encoded.</>,
          },
          {
            q: 'Where does the work-order link appear?',
            a: <>On every confined-space and hot-work permit page that has
              a work-order field populated. Without a template, the field
              renders as plain text.</>,
          },
          {
            q: 'How is the push-dispatch secret different from a webhook secret?',
            a: <>Push-dispatch is <em>inbound</em> (someone calls us);
              webhooks under <Link href="/admin/webhooks">/admin/webhooks</Link>{' '}
              are <em>outbound</em> (we call someone). Different secrets,
              different rotation cadences.</>,
          },
          {
            q: 'How do I rotate the push-dispatch secret?',
            a: <>Replace the value in the field and save. Outstanding
              integrations that use the old secret will start failing
              immediately, so coordinate with whoever owns the upstream
              system before clicking save.</>,
          },
          {
            q: 'Can I see what came in via push-dispatch?',
            a: <>Inbound payloads land as draft permits in the appropriate
              module. The audit log shows the row creation; the inbound
              raw payload is logged at the API edge for debugging.</>,
          },
          {
            q: 'Do these settings apply across tenants?',
            a: <>No — both are per-tenant. Switching the active tenant in
              the header changes which configuration you&apos;re editing.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Test the work-order URL template by saving and clicking the link on an existing permit before walking away.',
            'Treat the push-dispatch secret like a password — rotate after personnel changes on the upstream team.',
            'Document the URL template format somewhere your CMMS team can reach (the placeholder is easy to mistype).',
            'Use HTTPS for the work-order URL. The CMMS link will be opened on field tablets over public Wi-Fi.',
          ]}
          donts={[
            'Don\'t hardcode a single work-order id into the template. Use the placeholder.',
            'Don\'t paste the push-dispatch secret into chat. Use a secret-sharing tool.',
            'Don\'t change the work-order template format mid-quarter unless you also update past permits — old links will break.',
            'Don\'t enable push-dispatch without a tested upstream system. A misconfigured upstream will create junk drafts.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/webhooks',          label: 'Webhooks' },
          { href: '/wiki/audit',             label: 'Audit Log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
