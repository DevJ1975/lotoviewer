import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial permit-signon wiki page.'] },
]

export default function WikiPermitSignonPage() {
  return (
    <WikiPage
      title="Permit Sign-on"
      subtitle="Tokenized link that lets an entrant or assignee sign a permit from their phone — no Soteria account needed."
      modulePath={null}
      audience="public-token"
      category="Public portals"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'flow',     label: 'How it flows' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          When a confined-space entrant or hot-work assignee needs to sign a
          permit but doesn&apos;t have a Soteria account, the supervisor
          generates a tokenized link and texts/emails it. The recipient
          opens it on their phone, draws their signature, and is signed in.
        </p>
      </Section>

      <Section id="flow" title="How it flows">
        <ul>
          <li>Supervisor opens the permit, hits <strong>Send sign-on link</strong>, picks the recipient and channel (email or copy-and-paste).</li>
          <li>Recipient taps the link, sees the permit summary (who, what, where, when), draws a signature, submits.</li>
          <li>The signed permit row updates immediately on the supervisor&apos;s screen and writes to the audit trail.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How long is a sign-on link valid?',
            a: <>Until the permit closes or expires, whichever comes first.
              The token includes the permit id; once the permit is no longer
              active, the link surfaces a &quot;permit closed&quot; page.</>,
          },
          {
            q: 'Can I issue one link to multiple entrants?',
            a: <>No — generate one per entrant so each signature is
              attributable. The whole point is that the audit log captures
              who signed what.</>,
          },
          {
            q: 'What if the entrant doesn\'t have a smartphone?',
            a: <>The supervisor can sign on the entrant&apos;s behalf
              from the permit page. The supervisor&apos;s identity is
              recorded as the actor; add a note to the permit explaining
              why the proxy was used.</>,
          },
          {
            q: 'The link expired before they signed. Now what?',
            a: <>Generate a fresh link. The original attempt is logged.</>,
          },
          {
            q: 'Does the entrant see other permits or anything else?',
            a: <>No — the page is scoped to the single permit and shows
              nothing else from your tenant.</>,
          },
          {
            q: 'Is the entrant\'s signature legally binding?',
            a: <>It captures intent and identity to the same standard
              as the supervisor signature. We record the typed-name field,
              the drawn signature, IP, user-agent, and timestamp. Whether
              that meets your jurisdiction&apos;s e-signature standard is
              a question for your legal team — but the data is preserved.</>,
          },
          {
            q: 'Can I revoke a sign-on link?',
            a: <>Cancel the underlying permit (if appropriate) — the link
              dies with it. There&apos;s no separate &quot;revoke link&quot;
              action because the link is permit-bound.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Send the link directly to the recipient\'s phone (text > email for speed in the field).',
            'Confirm the recipient\'s identity in person before they sign — the link can\'t do that for you.',
            'Brief the recipient on what they\'re signing; the page is summary-only and assumes prior context.',
            'Generate a fresh link if the recipient says they didn\'t receive yours.',
          ]}
          donts={[
            'Don\'t paste sign-on links into shared group chats. Anyone with the URL can sign.',
            'Don\'t reuse a single link across multiple entrants — that destroys attribution.',
            'Don\'t sign on behalf of the entrant unless absolutely necessary, and always with a note.',
            'Don\'t shorten the URL with public shorteners — those services log destinations.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/confined-spaces', label: 'Confined Spaces' },
          { href: '/wiki/hot-work',        label: 'Hot Work' },
          { href: '/wiki/review-portal',   label: 'Client Review Portal' },
          { href: '/wiki/audit',           label: 'Audit Log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
