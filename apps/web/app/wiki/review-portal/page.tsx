import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial review-portal wiki page.'] },
]

export default function WikiReviewPortalPage() {
  return (
    <WikiPage
      title="Client Review Portal"
      subtitle="Tokenized link that lets a non-Soteria reviewer sign off LOTO placards without creating an account."
      modulePath={null}
      audience="public-token"
      category="Public portals"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',  label: 'What it\'s for' },
        { id: 'workflow',  label: 'The two-side workflow' },
        { id: 'faq',       label: 'FAQ' },
        { id: 'dodonts',   label: 'Do\'s & Don\'ts' },
        { id: 'related',   label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          When a department&apos;s placards are ready for the customer&apos;s
          safety officer to sign off, you don&apos;t want to provision them a
          Soteria account. Generate a tokenized link instead — they review,
          comment per-placard, and sign once at the bottom.
        </p>
      </Section>

      <Section id="workflow" title="The two-side workflow">
        <ul>
          <li><strong>Admin side.</strong> Open any{' '}
            <Link href="/departments">department</Link>, click{' '}
            <strong>Send for client review</strong>, fill in the
            reviewer&apos;s name, email, and an optional message. The system
            emails them a link.</li>
          <li><strong>Reviewer side.</strong> They tap the email link, see
            every placard for that department side-by-side, leave per-placard
            notes (Approve / Needs changes), then sign off the whole batch
            with a typed name + drawn signature + overall outcome.</li>
          <li><strong>Admin side, again.</strong> Status badges (Sent /
            Opened / Approved / Needs changes / Revoked) appear back on the
            same department page; the reviewer&apos;s comments and per-placard
            notes are inline.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How long is the link valid?',
            a: <>30 days by default. Revoke takes effect immediately. Once
              the reviewer signs off, re-opening the link shows a read-only
              thank-you page.</>,
          },
          {
            q: 'What can the reviewer NOT do?',
            a: <>Edit any placard, see any other department, see other
              tenants, or do anything outside the placards bundled into the
              link. The page is server-rendered with the token verified on
              each load.</>,
          },
          {
            q: 'Does the reviewer need an account?',
            a: <>No — that&apos;s the entire point. They reach the portal
              via the emailed token; their typed name + drawn signature are
              the audit record.</>,
          },
          {
            q: 'What gets captured at signoff?',
            a: <>Typed name, drawn signature, IP address, user agent, and
              timestamp. All written to the <code>loto_placard_reviews</code>{' '}
              table. The record is built to hold up in front of an inspector.</>,
          },
          {
            q: 'Can I revoke after they\'ve started?',
            a: <>Yes — clicking <strong>Revoke</strong> invalidates the
              link immediately. If they&apos;re mid-review, their browser
              shows the link-expired page on the next request.</>,
          },
          {
            q: 'Can two reviewers share one link?',
            a: <>Technically yes (it&apos;s a bearer URL), but you&apos;ll
              lose attribution in the signoff record. Issue separate links
              per reviewer.</>,
          },
          {
            q: 'What if the reviewer never opens the link?',
            a: <>The status stays at <em>Sent</em>. Resend by revoking and
              issuing a fresh link. The original is left in the audit log.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Send to the reviewer\'s real corporate email — that\'s the audit-trail anchor.',
            'Add a short message explaining what you\'re asking them to approve, in their language not yours.',
            'Revoke any outstanding link the moment a reviewer leaves their company.',
            'Save the merged signoff PDF to your customer-facing project folder once the link is signed.',
          ]}
          donts={[
            'Don\'t paste the link into a shared chat. Email-only.',
            'Don\'t include placards from a different tenant in one link — switch tenant first.',
            'Don\'t set the expiry beyond what your customer engagement requires.',
            'Don\'t edit a placard while the link is open. Issue a fresh link after edits so the reviewer sees the latest version.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/loto',          label: 'LOTO' },
          { href: '/wiki/permit-signon', label: 'Permit Sign-on' },
          { href: '/wiki/audit',         label: 'Audit Log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
