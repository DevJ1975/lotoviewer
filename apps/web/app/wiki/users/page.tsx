import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.3.0'
const LAST_UPDATED    = '2026-07-28'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.3.0',
    date: '2026-07-28',
    changes: [
      'Documented the two new per-person actions for a pending invite: re-send the invite email, and copy the invite link to share yourself when our email lands in a junk folder.',
      'Rewrote the invite steps for the invite-LINK flow that replaced emailed temporary passwords. The temp password is now only a fallback for when email delivery fails.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-05-23',
    changes: [
      'Documented the invite lifecycle: weekly reminder emails for invitees who never sign in, and the reversible soft-cancel after four reminders.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-05-16',
    changes: [
      'Added deprecation banner pointing at /admin/people/members. Role management still lives here; the unified members roster (login users + shop-floor workers) is the new home for invite, deactivate, and per-person detail.',
    ],
  },
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial users-and-roles wiki page.'] },
]

export default function WikiUsersPage() {
  return (
    <WikiPage
      title="Users & Roles"
      subtitle="Invite users, mark admins, revoke access."
      modulePath="/admin/people/users"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'roles',    label: 'Roles' },
        { id: 'resending', label: 'Resending & sharing links' },
        { id: 'invite-lifecycle', label: 'Invite lifecycle' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Add and remove people from the active tenant, mark admins, and
          revoke access. Inviting someone emails them a{' '}
          <strong>single-use invite link</strong> where they choose their own
          password and land signed in. No password is ever sent by email.
        </p>
      </Section>

      <Section id="roles" title="Roles">
        <ul>
          <li><strong>Member</strong> — default. Can use safety modules.</li>
          <li><strong>Admin</strong> — adds access to <code>/admin/*</code>{' '}
            screens (users, devices, audit, training, configuration, etc.).</li>
          <li><strong>Superadmin</strong> — cross-tenant access; granted by
            another superadmin from <Link href="/superadmin">/superadmin</Link>.
            Not visible on this page.</li>
        </ul>
      </Section>

      <Section id="resending" title="Resending an invite & sharing the link yourself">
        <p>
          Invite emails sometimes land in a junk or quarantine folder. Anyone
          still showing <strong>Invite pending</strong> in the Users list has
          two actions on their row:
        </p>
        <ul>
          <li><strong>Resend invite email</strong> (paper-plane icon) — sends
            the invitation again to the same address.</li>
          <li><strong>Copy invite link</strong> (link icon) — creates the link
            and hands it to you <em>without</em> emailing anything, so you can
            paste it into your own email, Teams, or a text message. A
            ready-to-send message is provided alongside the bare link.</li>
        </ul>
        <p>
          <strong>Each action creates a brand-new link and retires the
          previous one.</strong> If you copy a link, send it, and then click
          Resend, the link you already sent stops working — so pick one route
          per person. Links are single-use and expire in about two weeks; the
          exact date is shown next to the link and included in the
          ready-to-send message.
        </p>
        <p>
          These actions only appear before someone&apos;s first sign-in. Once
          they have signed in they own a password, and an invite link would
          overwrite it — send them to <strong>Forgot password</strong> instead.
        </p>
      </Section>

      <Section id="invite-lifecycle" title="Invite lifecycle & reminders">
        <p>
          An invitee who never signs in is nudged automatically. A daily job
          sends a reminder email <strong>once a week, up to four times</strong>.
          If they still haven&apos;t signed in about a week after the fourth
          reminder, the invite is <strong>soft-cancelled</strong>.
        </p>
        <ul>
          <li><strong>Reversible by design.</strong> Soft-cancel deletes
            nothing — the person&apos;s row is kept. Resending the invite (or
            copying a fresh link) reactivates them and restarts the
            lifecycle, so a cancelled invite never leaves you with a link
            that dead-ends.</li>
          <li><strong>Access stops while cancelled.</strong> A cancelled invite
            no longer grants access to the tenant, even if the person later
            tries the original temporary password.</li>
          <li><strong>Only applies before first sign-in.</strong> Once someone
            signs in, reminders stop for good — existing accounts added to a
            new tenant are never affected.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How do I invite a new user?',
            a: <>Enter their email + name and click <strong>Invite</strong>.
              They get an email with a single-use link, choose their own
              password (at least 8 characters), and land signed in.</>,
          },
          {
            q: 'They say the invite never arrived — it\'s probably in their junk folder.',
            a: <>Two options on their row in the Users list: <strong>Resend
              invite email</strong> to try again, or <strong>Copy invite
              link</strong> to get the link and send it yourself through a
              channel they actually read. Sending it yourself usually wins,
              because it arrives from an address they already correspond
              with.</>,
          },
          {
            q: 'I closed the window before copying the link. Now what?',
            a: <>Click <strong>Copy invite link</strong> on their row again.
              Links are stored hashed and can never be re-displayed, so this
              issues a fresh one — and the earlier link stops working.</>,
          },
          {
            q: 'How do I remove someone?',
            a: <>Use <strong>Revoke access</strong>. The auth user is kept
              (so the audit history references resolve to a name) but
              membership in the active tenant is removed and they can no
              longer sign in to your tenant.</>,
          },
          {
            q: 'Can a user belong to multiple tenants?',
            a: <>Yes — only superadmins can assign cross-tenant memberships
              via <Link href="/superadmin">/superadmin</Link>. Once assigned,
              the tenant pill in the header lets the user switch between them.</>,
          },
          {
            q: 'What does marking someone as admin do?',
            a: <>Sets <code>is_admin=true</code> on their tenant membership,
              which RLS uses to gate every <code>/admin/*</code> route. The
              flag toggles immediately on next page load.</>,
          },
          {
            q: 'Where can I see what a user has done?',
            a: <>Open <Link href="/admin/evidence/audit">/admin/evidence/audit</Link> and
              filter by user. The audit log records every insert / update /
              delete with old + new values.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Use the user\'s real work email — password resets and audit attribution depend on it.',
            'Mark admins sparingly. The audit log is more useful when only the people who should be making changes can.',
            'Revoke access the same day someone leaves. The audit history is preserved either way.',
            'Send an invite link to the person it was issued for, and only them. It sets the password on their account, so treat it like a password reset link.',
          ]}
          donts={[
            'Don\'t share a single account between people. The audit log is the only thing keeping you compliant.',
            'Don\'t recycle email addresses. Each user gets a fresh auth account; reusing addresses across people corrupts attribution.',
            'Don\'t post an invite link in a shared channel or group chat. Anyone who sees it can claim the account.',
            'Don\'t toggle admin on/off as a workaround for missing per-feature permissions. Open a feature request instead.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/welcome',   label: 'Welcome / First Login' },
          { href: '/wiki/audit',     label: 'Audit Log' },
          { href: '/wiki/training-records', label: 'Training Records' },
        ]} />
      </Section>
    </WikiPage>
  )
}
