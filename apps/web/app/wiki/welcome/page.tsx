import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial welcome / first-login wiki page.'] },
]

export default function WikiWelcomePage() {
  return (
    <WikiPage
      title="Welcome / First Login"
      subtitle="The mandatory first-login flow that sets your full name and a real password."
      modulePath="/welcome"
      audience="live"
      category="Workspace"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          The first time you sign in with the temporary password your admin
          gave you, the system routes you here. Set your full name and a
          real password before doing anything else; the redirect to the
          dashboard happens automatically once you submit.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Why am I forced through this page?',
            a: <>Your account has the <code>must_change_password</code> flag
              set. Until you complete the form, every other route redirects
              back here so the temp password can&apos;t linger as your
              long-term credential.</>,
          },
          {
            q: 'I got bounced here even though I changed my password.',
            a: <>An admin probably reset it. Re-set it on this page; the
              flag clears on submit.</>,
          },
          {
            q: 'What goes in the "full name" field?',
            a: <>Your real name as it should appear on signed permits,
              audit rows, and review signatures. Avoid nicknames — the name
              ends up on records that go to inspectors.</>,
          },
          {
            q: 'What\'s the password policy?',
            a: <>Minimum 12 characters, plus the standard Supabase auth
              rules. The form validates as you type.</>,
          },
          {
            q: 'Can I skip this page?',
            a: <>No. The middleware enforces it; clicking around won&apos;t
              get past it. Set the password and submit.</>,
          },
          {
            q: 'I forgot my password before completing welcome.',
            a: <>Use the &quot;Forgot password&quot; link on the login page.
              You&apos;ll get a reset email; after resetting, you&apos;ll
              still land on welcome to set the long-term password.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Pick a password your password manager will store. The audit log assumes you\'re you.',
            'Use your real legal/work name in the full-name field — signed permits get printed.',
            'Complete the flow from a private browser, not a shared kiosk.',
            'After submitting, sign out and sign back in once to confirm the new password works.',
          ]}
          donts={[
            'Don\'t reuse the temp password — the whole point of the flow is to retire it.',
            'Don\'t use a nickname or first-name-only. Inspectors and auditors won\'t recognize "Big Mike" on a placard.',
            'Don\'t share the new password with your admin; they don\'t need it.',
            'Don\'t complete the flow from someone else\'s account. If admins emailed the temp password to the wrong person, ask for a fresh invite.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/users',         label: 'Users & Roles' },
          { href: '/wiki/notifications', label: 'Notifications' },
          { href: '/wiki/support',       label: 'Support' },
        ]} />
      </Section>
    </WikiPage>
  )
}
