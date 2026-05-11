import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial users-and-roles wiki page.'] },
]

export default function WikiUsersPage() {
  return (
    <WikiPage
      title="Users & Roles"
      subtitle="Invite users, mark admins, revoke access."
      modulePath="/admin/users"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'roles',    label: 'Roles' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Add and remove people from the active tenant, mark admins, and
          revoke access. Inviting a new user generates a temporary password
          you can hand off in person; the user is forced through the{' '}
          <Link href="/welcome">welcome flow</Link> on first login.
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

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How do I invite a new user?',
            a: <>Click <strong>Invite user</strong>, enter their email + name.
              The system creates the auth account, generates a temp password,
              and shows it on screen so you can copy it. They sign in, hit
              the welcome flow, and pick their own password.</>,
          },
          {
            q: 'The temp password modal closed before I copied it. Now what?',
            a: <>Reset the user&apos;s password (revoke + re-invite, or use
              the per-user reset action). The temp password is shown only
              once and not stored anywhere recoverable — that&apos;s
              intentional.</>,
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
            a: <>Open <Link href="/admin/audit">/admin/audit</Link> and
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
            'Verify the temp-password handoff in person or via a side channel; never paste it into the same email as the username.',
          ]}
          donts={[
            'Don\'t share a single account between people. The audit log is the only thing keeping you compliant.',
            'Don\'t recycle email addresses. Each user gets a fresh auth account; reusing addresses across people corrupts attribution.',
            'Don\'t use the temp password as the long-term password. The welcome flow exists to force a change.',
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
