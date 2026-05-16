import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-15'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-05-15',
    changes: [
      'Initial publication for the Platform Features module: SAML/OIDC ' +
      'SSO config, SCIM 2.0 user provisioning, CMMS bidirectional sync ' +
      'with HMAC-signed webhooks, BBS v2 observations with safe-to-' +
      'unsafe ratio dashboard, vendor / contractor prequalification ' +
      'with tokenized portal, and multi-language i18n infrastructure ' +
      '(English / Español / Français).',
    ],
  },
]

export default function WikiPlatformFeaturesPage() {
  return (
    <WikiPage
      title="Platform Features"
      subtitle="SSO + SCIM, CMMS sync, BBS v2, vendor prequal, i18n."
      modulePath="/admin/sso"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',  label: 'What it\'s for' },
        { id: 'sso',       label: 'SSO config' },
        { id: 'scim',      label: 'SCIM 2.0 provisioning' },
        { id: 'cmms',      label: 'CMMS bidirectional sync' },
        { id: 'bbs',       label: 'BBS v2 observations' },
        { id: 'prequal',   label: 'Vendor prequalification' },
        { id: 'i18n',      label: 'Multi-language (i18n)' },
        { id: 'faq',       label: 'FAQ' },
        { id: 'dodonts',   label: 'Do\'s & Don\'ts' },
        { id: 'related',   label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Modules 1 and 2 closed the regulatory + integrity gaps. Module 3
          is the platform release — the integration and i18n surface
          that lets a mid-market customer drop the SaaS into their
          existing ecosystem: identity provider, CMMS, contractor
          ecosystem, multi-language workforce. None of these features
          is mandatory; each unlocks a procurement gate.
        </p>
      </Section>

      <Section id="sso" title="SAML / OIDC SSO config">
        <p>
          The active-tenant SAML or OIDC configuration is persisted at{' '}
          <Link href="/admin/sso">/admin/sso</Link>. Two paths: paste an
          IdP metadata URL (Azure AD, Okta), or paste the metadata XML
          directly (Ping, ADFS).
        </p>
        <p>
          <strong>Important.</strong> This page persists the tenant-side
          config only. Actually enabling SAML on the Supabase Auth tenant
          is a superadmin action — the page surfaces a callout reminding
          the admin of the next step. The reason: SAML enablement on
          Supabase has irreversible side effects (the tenant&apos;s auth
          flow flips); we want a human gate on that.
        </p>
      </Section>

      <Section id="scim" title="SCIM 2.0 user provisioning">
        <p>
          The system is a SCIM 2.0 service provider per RFC 7643/7644.
          IdPs (Okta, Azure AD, Google Workspace) can create / list /
          update / deactivate user records via the standard SCIM
          endpoints. Provisioned rows land in <code>loto_workers</code>
          — workforce identities, not authentication identities — so a
          tenant can have a 500-worker roster sync nightly without
          spinning up 500 paid Supabase auth users.
        </p>
        <p>
          <strong>Token lifecycle.</strong> Tokens are 256-bit
          CSPRNG-generated, base64url-encoded, SHA-256-hashed at rest.
          The plaintext is shown once at issuance; we never persist it.
          Revocation flips <code>revoked_at</code>; the SCIM endpoint
          rejects with 401 on every subsequent request.
        </p>
        <p>
          <strong>Tenant scope.</strong> The tenant_id is derived from
          the token row at auth time. Every list / get / patch / post is
          scoped to that tenant. A token leaked from tenant A cannot be
          used to query tenant B.
        </p>
      </Section>

      <Section id="cmms" title="CMMS bidirectional sync">
        <p>
          A generic webhook-driven CMMS bridge. Add an integration at{' '}
          <Link href="/admin/cmms">/admin/cmms</Link>, get a signed
          webhook URL, drop it into the CMMS&apos;s outbound webhook
          config. The CMMS posts work-order events; we verify HMAC,
          record the event in <code>cmms_sync_events</code>, upsert
          <code>cmms_work_order_links</code>, and flip the equipment
          detail page&apos;s yellow callout to remind the operator to
          do the §147 paperwork before WO closeout.
        </p>
        <p>
          <strong>Supported events.</strong>{' '}
          <code>work_order.opened</code>,{' '}
          <code>work_order.updated</code>,{' '}
          <code>work_order.closed</code>,{' '}
          <code>work_order.cancelled</code>. Outbound (Soteria →
          CMMS) is a future cron; the schema (<code>direction =
          outbound</code> on the events table) is in place today.
        </p>
        <p>
          <strong>HMAC.</strong> SHA-256 over the raw bytes using the
          integration&apos;s <code>webhook_secret</code>. Sent in the
          <code>X-Soteria-Signature: sha256=&lt;hex&gt;</code> header.
          Verified BEFORE any DB write, with constant-time compare.
        </p>
      </Section>

      <Section id="bbs" title="BBS v2 observations">
        <p>
          A second, leaner BBS surface alongside the existing one (same
          intentional-parallel pattern Module 2 used for CAPAs vs
          incident_actions). The v2 schema captures the safe / unsafe-
          act / unsafe-condition categorization the EHS community has
          converged on, plus follow-up and feedback tracking.
        </p>
        <p>
          <strong>Where to find it.</strong> Workers capture at{' '}
          <Link href="/bbs/observe">/bbs/observe</Link> (mobile-first
          tap targets). Admins review at{' '}
          <Link href="/admin/bbs/dashboard">/admin/bbs/dashboard</Link>.
        </p>
        <p>
          <strong>Headline metric.</strong> safe-to-unsafe ratio,
          banded red (&lt;2:1) / yellow (2–4:1) / green (≥4:1). The
          band is intentionally loud — a sustained red is a culture
          finding, not a data finding.
        </p>
      </Section>

      <Section id="prequal" title="Vendor / contractor prequalification">
        <p>
          Each contractor company can have a current prequalification
          on file: 8 free-text Q&A fields covering safety management,
          EMR, DART, TRIR, ISO certs, insurance limits, references,
          plus a drug-and-alcohol-program toggle. Admins invite the
          contractor via a tokenized public URL; the contractor fills
          the form without a login.
        </p>
        <p>
          <strong>Lifecycle.</strong>{' '}
          <code>invited → in_progress → approved | rejected</code>;
          approval carries an <code>approval_expires_at</code>. The
          classifier buckets approved rows into{' '}
          <em>approved</em> / <em>expiring</em> (≤30 days from
          expiry) / <em>expired</em> automatically.
        </p>
        <p>
          <strong>Token security.</strong> 32-char hex token,
          regex-validated on every request, no-login portal at{' '}
          <code>/contractor-prequal/[token]</code>. Expired or rejected
          rows return 410 with a friendly message — no leak of the
          underlying answers.
        </p>
      </Section>

      <Section id="i18n" title="Multi-language (i18n)">
        <p>
          Tenant-level language preference (en / es / fr). Set at{' '}
          <Link href="/admin/configuration">/admin/configuration</Link>
          {' '}via the language dropdown.
        </p>
        <p>
          <strong>Coverage.</strong> ~20 high-impact strings shipped
          in this release: nav labels, placard headers, common form
          labels. The infrastructure is in place; broader coverage
          follows. Untranslated keys fall back: target → English →
          raw key (so missing translations are visible, not silently
          blank).
        </p>
        <p>
          <strong>Known gap.</strong> The placard PDF generator
          currently does EN / ES. French is dictionary-ready but the
          placard renderer hasn&apos;t wired the third language yet.
          Documented in the smoke checklist.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'I issued a SCIM token and lost the plaintext. Can I recover it?',
            a: <>No. The plaintext is shown once at issuance and never
              persisted. Revoke the lost token (it&apos;s a leak by
              definition) and issue a fresh one. Update your IdP&apos;s
              SCIM config with the new token.</>,
          },
          {
            q: 'Why doesn\'t toggling SSO on in /admin/sso actually enable SAML for my users?',
            a: <>The tenant-side configuration persists, but Supabase
              Auth tenant-level SAML enablement is a superadmin step
              with irreversible side effects on the auth flow. The
              tenant admin sets up the IdP config; the superadmin
              flips the switch. The page surfaces the next step.</>,
          },
          {
            q: 'A CMMS webhook came in with a bad signature. What happens?',
            a: <>401 Unauthorized. The DB writes don&apos;t happen.
              Sentry captures the event for triage. No data leaks
              to the sender — we don&apos;t hint at whether the
              signature was close, just whether it matched.</>,
          },
          {
            q: 'Why are BBS v1 and BBS v2 both shipping?',
            a: <>The v1 surface predates the safe / unsafe-act /
              unsafe-condition categorization the EHS community
              standardized on. We&apos;re running both in parallel
              until v1 customers migrate. Same intentional-parallel
              pattern Module 2 used for incident CAPAs vs incident
              actions.</>,
          },
          {
            q: 'My contractor lost the prequal URL. Can I re-send it?',
            a: <>The token is on the contractor&apos;s row — open
              their prequal management page in{' '}
              <Link href="/admin/contractors">/admin/contractors</Link>,
              copy the URL, re-send. The token doesn&apos;t expire
              until the prequal is submitted or marked expired/
              rejected by an admin.</>,
          },
          {
            q: 'Why are placards still bilingual EN/ES even after I picked fr?',
            a: <>The placard renderer hardcodes EN/ES for now; the i18n
              infrastructure ships the French dictionary but the
              renderer hasn&apos;t been wired to honor French. The
              follow-up generalises the bilingual code path to honor
              the tenant language preference end-to-end.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Issue SCIM tokens with the minimum scope necessary, named after the integration (e.g. "Okta-prod"), and revoke immediately after a vendor changeover.',
            'Verify CMMS HMAC by sending a deliberately-tampered request once a quarter — the test confirms the wire-level posture is still working.',
            'Tag every BBS observation with feedback_given_at as soon as the conversation happens. The dashboard\'s "feedback delivered" metric is the leading indicator that actually drives behavior.',
            'Set vendor prequal approval expiries to match the contractor\'s insurance renewal cadence (typically 12 months) so the expiring-soon notification lands when the renewal is already in the pipeline.',
            'Pick the tenant language at onboarding. Switching mid-cycle creates a brief window where new records render in the new language but old ones don\'t.',
          ]}
          donts={[
            'Don\'t share the CMMS webhook secret over an unencrypted channel. The HMAC is exactly as strong as the shared secret.',
            'Don\'t reuse a SCIM token across multiple IdPs. If one IdP\'s logs get compromised, you want a single token to revoke, not a fleet.',
            'Don\'t treat the safe-to-unsafe ratio as a target to optimize. Observers tilting toward "easy safe behaviors" to boost the ratio is the failure mode the metric is meant to surface, not cause.',
            'Don\'t enable SSO on a tenant without first verifying the SCIM provisioning loop. Auth-without-provisioning means users can sign in but have no profile/role; broken UX on day one.',
            'Don\'t add a new supported language without also shipping at least the nav, placard, and form-action dictionaries. Partial coverage with raw-key fallbacks is a UX regression.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/loto-compliance',     label: 'LOTO Compliance' },
          { href: '/wiki/integrity-compliance', label: 'Integrity & Compliance' },
          { href: '/wiki/users',                label: 'Users & Roles' },
          { href: '/wiki/webhooks',             label: 'Webhooks' },
          { href: '/wiki/audit',                label: 'Audit Log' },
          { href: '/wiki/configuration',        label: 'Configuration' },
        ]} />
      </Section>
    </WikiPage>
  )
}
