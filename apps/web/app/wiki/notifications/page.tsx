import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial notifications wiki page.'] },
]

export default function WikiNotificationsPage() {
  return (
    <WikiPage
      title="Notifications"
      subtitle="Web Push subscription so the device beeps when a permit needs your attention."
      modulePath="/settings/notifications"
      audience="live"
      category="Workspace"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'when',     label: 'When you\'ll get notified' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Opt-in Web Push subscription. Once enabled, your browser
          (or installed PWA) shows a system-level notification when something
          relevant happens — a fire-watch countdown ending, an atmospheric
          test failing, a near-miss assigned to you.
        </p>
      </Section>

      <Section id="when" title="When you'll get notified">
        <ul>
          <li>A permit you signed enters or exits post-watch.</li>
          <li>An atmospheric test on a permit you supervise fails.</li>
          <li>A near-miss is routed to you for triage.</li>
          <li>A client review you sent has been signed off.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Why does iOS say "not supported"?',
            a: <>iOS only supports Web Push when the app is installed to the
              home screen as a PWA. Open Soteria FIELD in Safari, hit
              Share → Add to Home Screen, then re-open from the home-screen
              icon. The notifications toggle works after that.</>,
          },
          {
            q: 'I enabled push but nothing shows up.',
            a: <>Check the browser&apos;s site permission for notifications
              (sometimes the OS blocks them even after the browser allows).
              On macOS, also check System Settings → Notifications → Browser.
              If still silent, hit the &quot;Send test&quot; button on the
              settings page.</>,
          },
          {
            q: 'Will I get notifications across devices?',
            a: <>Each device subscribes separately. Enable on every device
              you want to be reachable on; revoke on devices you no longer use.</>,
          },
          {
            q: 'Can I pick which events trigger a notification?',
            a: <>Not yet — it&apos;s an all-or-nothing toggle. Per-event
              filters are on the roadmap.</>,
          },
          {
            q: 'Do I get notifications for events I didn\'t create?',
            a: <>Only when they&apos;re routed to you (assigned, supervised,
              or your team). Tenant-wide noise is intentionally suppressed.</>,
          },
          {
            q: 'How do I unsubscribe?',
            a: <>Toggle off on the same settings page. Or revoke the
              browser&apos;s notification permission — the next page load
              will reflect the new state.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Install the PWA to the home screen on iOS — it\'s the only path to reliable push there.',
            'Send yourself a test notification right after enabling, while you\'re still on the page.',
            'Disable push on shared devices (kit-attendant tablets) so personal notifications don\'t leak.',
            'Re-check permissions after a browser update; updates sometimes reset granted permissions.',
          ]}
          donts={[
            'Don\'t rely on push as the only signal for time-critical events. The countdown timers in the modules are the source of truth.',
            'Don\'t enable push on a personal device you don\'t carry; you\'ll miss the alert anyway.',
            'Don\'t enable on a kiosk-mode device — the notifications can leak permit details to anyone walking by.',
            'Don\'t open multiple browser profiles signed into the same account; you\'ll get duplicate notifications.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/webhooks',  label: 'Webhooks' },
          { href: '/wiki/hot-work',  label: 'Hot Work' },
          { href: '/wiki/near-miss', label: 'Near-Miss' },
        ]} />
      </Section>
    </WikiPage>
  )
}
