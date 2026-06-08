import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.3.0'
const LAST_UPDATED    = '2026-06-08'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.3.0',
    date: '2026-06-08',
    changes: [
      'Audit review link — a second tokenized review surface, for the multi-agent LOTO audit (admin → LOTO Program → Multi-agent audit). The audit proposes fixes (per-step confidence grades, watermarked manufacturer/reference placeholders for low-confidence isolation points, and Cal/OSHA Title 8 §3314 findings) and STAGES them. A reviewer opens /review/audit/{token} to see a per-equipment summary plus an old→new diff for every proposed change, then Approves or Rejects each one and signs off. Nothing is written to the live placard data until an admin applies the approved set — snapshot-first, with an emergency rollback. This is a sibling of the floor-walk public link: read-only diffs + per-item approve/reject, not on-site photo capture.',
    ],
  },
  {
    version: '1.2.2',
    date: '2026-06-06',
    changes: [
      'Fixed a mobile crash ("can’t open this page") when opening the public review link for a single machine from a placard’s "Update photo" deep-link. The public link otherwise renders every active placard in the tenant (hundreds of cards, all their photos + energy-step text), a payload large enough to exhaust memory on a phone. The deep-link now passes ?equipment=<id> and the portal loads only that one machine — the batch (no-param) view is unchanged.',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-06-06',
    changes: [
      'Deep-link from the public placard view. Scanning a placard QR (/qr/{qr_token}) now shows an "Update photo" button when the tenant has an active public review link; it opens /review/{token} anchored to that exact equipment card (which scrolls into view and pulses), so a field worker can jump straight from a single machine to its photo-replacement (staging) flow. The /qr view itself stays read-only.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-06-06',
    changes: [
      'Photo replacements are now STAGED, not applied live. When a reviewer replaces an EQUIP or ISO photo it lands in a staging area (status "pending reconcile") and nothing on the equipment record changes. The reviewer can undo a staged photo before they finish. An admin reconciles from /admin/loto/public-review-link → "Photo replacements": side-by-side old-vs-new with per-item Apply / Reject and an "Apply all" shortcut. Applying swaps the photo into the live placard, sets the photo flag, clears the stale placard PDF for re-render, and writes audit + hygiene-log rows. On the legacy per-reviewer flow, sign-off auto-reconciles. Reconcile is idempotent — re-running never double-applies.',
      'Public QR placard route. Scanning a printed placard QR opens /qr/{qr_token} — a read-only, no-login view of that machine\'s isolation photo (with annotation markers), ordered energy-control steps, and verified badge. Reads flow through a SECURITY DEFINER RPC granted to anon, so the service key never reaches the browser and RLS is untouched; each resolved scan is logged.',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-06-05',
    changes: [
      'Fixed: the reviewer page now renders each placard\'s energy-isolation steps. A table-name typo (querying loto_steps instead of loto_energy_steps) had caused the steps list to come back empty for every piece of equipment under review.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-05-19',
    changes: [
      'Supervisor floor-walk flow. New tenant-wide public review link (one active per tenant, 72-hour default expiry, no reviewer identity) lives at /admin/loto/public-review-link. A supervisor on the link can replace EQUIP or ISO photos (placard PDF regenerates inline), and can mark equipment "for review" — admins triage the queue at /admin/loto/review-queue and clear flags as they go. The reviewer types their name once on first action; the name attaches to every photo replacement audit row and every flag. The admin can extend the link by +24h / +72h / +168h or revoke it instantly. The legacy per-reviewer signed-off flow continues to coexist for external auditors.',
    ],
  },
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
            q: 'What is the audit review link vs. the floor-walk link?',
            a: <>Two different tokenized surfaces. The <strong>floor-walk</strong>{' '}
              link is for a supervisor capturing/replacing photos on site. The{' '}
              <strong>audit review</strong> link (<code>/review/audit/{'{'}token{'}'}</code>)
              shows the fixes the multi-agent audit proposed — a summary plus an
              old→new diff per change — and lets a reviewer approve or reject each
              one. No change touches the live placard until it is approved here{' '}
              <em>and</em> an admin applies it (snapshot-first, with rollback).</>,
          },
          {
            q: 'How long is the link valid?',
            a: <>30 days by default. Revoke takes effect immediately. Once
              the reviewer signs off, re-opening the link shows a read-only
              thank-you page.</>,
          },
          {
            q: 'What happens when a reviewer replaces a photo?',
            a: <>It is <strong>staged</strong>, not applied. The new photo
              uploads to a staging area and shows on the reviewer&apos;s tile
              with a &quot;pending reconcile&quot; badge; the live equipment
              record is untouched. An admin then reviews old-vs-new at{' '}
              <Link href="/admin/loto/public-review-link">/admin/loto/public-review-link</Link>{' '}
              and Applies or Rejects each one (sign-off on the per-reviewer
              flow auto-applies). Only on Apply does the placard photo change —
              and the stale placard PDF is cleared so it re-renders.</>,
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
