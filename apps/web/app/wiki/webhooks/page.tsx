import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial webhooks wiki page.'] },
]

export default function WikiWebhooksPage() {
  return (
    <WikiPage
      title="Webhooks"
      subtitle="Outbound event subscriptions so external systems stay in sync with permits and tests."
      modulePath="/admin/webhooks"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'events',   label: 'Available events' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Subscribe an external endpoint to events that happen inside Soteria
          FIELD. When a permit is signed, a test fails, or a fire watch ends,
          we POST a JSON payload (signed with your endpoint&apos;s secret)
          so your CMMS, Slack channel, or downstream automation knows.
        </p>
      </Section>

      <Section id="events" title="Available events">
        <ul>
          <li><code>permit.created</code></li>
          <li><code>permit.signed</code></li>
          <li><code>permit.canceled</code></li>
          <li><code>test.recorded</code></li>
          <li><code>test.failed</code></li>
          <li><code>hot_work.created</code></li>
          <li><code>hot_work.signed</code></li>
          <li><code>hot_work.work_complete</code></li>
          <li><code>hot_work.canceled</code></li>
          <li><code>hot_work.fire_observed</code></li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How do I add a webhook?',
            a: <>Click <strong>Add webhook</strong>, paste the receiver URL,
              pick the event(s) to subscribe to, and save. The system
              generates a signing secret you copy into your receiver — same
              pattern as Stripe / GitHub webhooks.</>,
          },
          {
            q: 'How do I rotate the secret?',
            a: <>Delete the webhook and re-create it. There&apos;s no
              in-place secret rotation by design — forces you to update the
              receiver in the same step.</>,
          },
          {
            q: 'How does signature verification work?',
            a: <>Each request includes a header with HMAC-SHA256 of the body
              using the shared secret. The receiver re-computes and compares.
              Reject anything that doesn&apos;t match.</>,
          },
          {
            q: 'What if my receiver is down?',
            a: <>The dispatch retries with exponential backoff for ~24
              hours, then drops. Every attempt is recorded in the dispatch
              log. Plan for at-least-once delivery; deduplicate on the
              event id.</>,
          },
          {
            q: 'Can I subscribe to all events with one webhook?',
            a: <>Yes — leave events unselected to subscribe to all. New
              event types are auto-included; pin specific events if your
              receiver should not see new types automatically.</>,
          },
          {
            q: 'Are webhooks per-tenant?',
            a: <>Yes — a webhook subscribed under tenant A only fires for
              tenant A&apos;s events. Switch the active tenant pill to
              manage another tenant&apos;s webhooks.</>,
          },
          {
            q: 'Can I temporarily disable a webhook?',
            a: <>Toggle the active flag instead of deleting. Disabled
              webhooks stop firing but keep their config and history.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Always verify the signature in the receiver. Anyone who guesses your URL could otherwise post fake events.',
            'Make the receiver idempotent — the same event id can arrive twice on retry.',
            'Subscribe to the smallest set of events your integration needs. New events surprise downstream code.',
            'Monitor the dispatch log weekly to catch silent failures.',
          ]}
          donts={[
            'Don\'t treat webhooks as a guaranteed channel. If a permit must reach your system, also poll for it.',
            'Don\'t put the secret in source control. Use your secret manager.',
            'Don\'t respond slowly — if the receiver takes more than ~10s we treat it as failed and retry.',
            'Don\'t parse the body without validating the signature. The signature is the authentication.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/configuration', label: 'Configuration' },
          { href: '/wiki/audit',         label: 'Audit Log' },
          { href: '/wiki/notifications', label: 'Notifications' },
        ]} />
      </Section>
    </WikiPage>
  )
}
