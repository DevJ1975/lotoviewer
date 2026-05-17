import Link from 'next/link'
import { ArrowLeft, BookOpen } from 'lucide-react'
import type { ReactNode } from 'react'

// /admin/platform/platform-manual — user manual for Module 3: Platform Features.
//
// Update protocol when behavior changes:
//   1. Edit the relevant section below.
//   2. Bump CURRENT_VERSION + add a CHANGELOG row (top is newest).
//   3. Mirror the change in /wiki/platform-features.

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-15'

interface ChangelogEntry {
  version: string
  date:    string
  changes: string[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-05-15',
    changes: [
      'Initial publication for the Platform Features module.',
      'Covers SAML/OIDC SSO config persistence, SCIM 2.0 user ' +
      'provisioning, CMMS bidirectional sync with HMAC-verified ' +
      'webhooks, BBS v2 observations with safe-to-unsafe ratio, ' +
      'vendor / contractor prequalification with tokenized public ' +
      'portal, and multi-language i18n infrastructure for ' +
      'English / Spanish / French.',
    ],
  },
]

export default function PlatformManualPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-8 text-slate-800 dark:text-slate-100">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/people/sso"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to SSO config
        </Link>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          v{CURRENT_VERSION} · updated {LAST_UPDATED}
        </span>
      </div>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow text-xs font-semibold">
          <BookOpen className="h-3.5 w-3.5" /> User manual
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Platform Features module</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Operating guide for the integration + i18n surface: SAML/OIDC
          SSO config, SCIM 2.0 user provisioning, CMMS bidirectional
          sync, BBS v2 observations, vendor / contractor
          prequalification, and multi-language support.
        </p>
      </header>

      <nav className="text-xs text-slate-500 dark:text-slate-400 space-y-1 border border-slate-200 dark:border-slate-800 rounded-md p-3">
        <p className="font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Contents</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li><a className="underline" href="#overview">What this module is for</a></li>
          <li><a className="underline" href="#sso">SAML / OIDC SSO config</a></li>
          <li><a className="underline" href="#scim">SCIM 2.0 user provisioning</a></li>
          <li><a className="underline" href="#cmms">CMMS bidirectional sync</a></li>
          <li><a className="underline" href="#bbs">BBS v2 observations</a></li>
          <li><a className="underline" href="#prequal">Vendor prequalification</a></li>
          <li><a className="underline" href="#i18n">Multi-language (i18n)</a></li>
          <li><a className="underline" href="#changelog">Changelog</a></li>
        </ol>
      </nav>

      <Section id="overview" title="What this module is for">
        <p>
          Module 3 unlocks the procurement gates that mid-market and
          enterprise customers ask about during evaluation: SSO, SCIM,
          CMMS, contractor prequal, and a non-English workforce. None
          of these features is mandatory; each is independent.
        </p>
        <p>
          All admin-only (with one exception:{' '}
          <code>/bbs/observe</code> is accessible to any tenant member
          so shop-floor workers can submit observations). All
          tenant-scoped end-to-end.
        </p>
      </Section>

      <Section id="sso" title="SAML / OIDC SSO config">
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/people/sso">/admin/people/sso</Link>.
        </p>
        <p>
          <strong>What it does.</strong> Persists the tenant&apos;s IdP
          configuration: provider type (SAML or OIDC), IdP metadata URL
          OR raw XML, SP entity ID, SP ACS URL, enabled flag.
        </p>
        <p>
          <strong>What it does NOT do.</strong> Enable SAML on the
          Supabase Auth tenant. That step is irreversible (the
          tenant&apos;s auth flow flips) and requires superadmin
          access to Supabase&apos;s dashboard. The page surfaces a
          callout reminding the admin of the next step.
        </p>
        <p>
          <strong>Workflow.</strong> Admin pastes IdP metadata, saves.
          Admin contacts the platform&apos;s support / superadmin team
          to enable the Supabase-side SAML config. Once flipped, users
          authenticate via the IdP and SCIM provisioning (see below)
          keeps the workforce roster in sync.
        </p>
      </Section>

      <Section id="scim" title="SCIM 2.0 user provisioning">
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/people/scim">/admin/people/scim</Link>.
        </p>
        <p>
          <strong>Issuing a token.</strong> Click <em>Issue new
          token</em>, name it after the IdP / integration (e.g.
          &quot;Okta-prod&quot;). The plaintext token displays ONCE in
          a modal — copy it immediately. After closing the modal, only
          the hashed token row is retained; the plaintext is
          unrecoverable.
        </p>
        <p>
          <strong>Token storage.</strong> 256-bit CSPRNG generation
          (base64url-encoded), SHA-256 hashed at rest in{' '}
          <code>scim_tokens.token_hash</code>. The hash function is the
          same across browser and Node (Web Crypto subtle); a token
          generated in the browser can be verified on the server with
          no special handling.
        </p>
        <p>
          <strong>Revoking a token.</strong> Click <em>Revoke</em> on
          any row. The token&apos;s <code>revoked_at</code> is stamped;
          the SCIM endpoint rejects all future requests with 401.
          Revocation is immediate — there&apos;s no cache TTL.
        </p>
        <p>
          <strong>SCIM endpoints.</strong>
        </p>
        <ul>
          <li><code>POST /api/scim/v2/Users</code> — create a user (RFC 7644)</li>
          <li><code>GET  /api/scim/v2/Users</code> — list, with{' '}
            <code>startIndex</code> / <code>count</code> /{' '}
            <code>filter</code> query params</li>
          <li><code>GET  /api/scim/v2/Users/[id]</code> — single user</li>
          <li><code>PATCH /api/scim/v2/Users/[id]</code> — update (active toggle, name updates)</li>
        </ul>
        <p>
          Authorization is via <code>Authorization: Bearer
          &lt;token&gt;</code>. Filter support is narrow:{' '}
          <code>userName eq &quot;value&quot;</code> and{' '}
          <code>externalId eq &quot;value&quot;</code> are the only
          shapes Okta + Azure send during lookup; anything else returns
          the unfiltered page (RFC 7644 §3.4.2.2 permits this).
        </p>
        <p>
          <strong>What gets created.</strong> SCIM Users land in{' '}
          <code>loto_workers</code> — workforce identities, not auth
          identities. You can have a 500-worker roster sync without
          spinning up 500 Supabase auth users.
        </p>
      </Section>

      <Section id="cmms" title="CMMS bidirectional sync">
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/platform/cmms">/admin/platform/cmms</Link>.
        </p>
        <p>
          <strong>Setup.</strong> Add an integration, pick the system
          (maximo / sap_pm / emaint / generic), set the base URL, and
          generate a webhook secret. The detail page shows the inbound
          webhook URL and the secret (one-time reveal). Drop both into
          the CMMS&apos;s outbound webhook configuration.
        </p>
        <p>
          <strong>HMAC.</strong> The CMMS computes HMAC-SHA256 over the
          raw body using the shared secret, sends it in the{' '}
          <code>X-Soteria-Signature: sha256=&lt;hex&gt;</code> header.
          The endpoint reads the raw bytes BEFORE parsing JSON,
          recomputes the HMAC, and compares constant-time. A
          mismatch returns 401 with no DB writes.
        </p>
        <p>
          <strong>Supported event types.</strong>
        </p>
        <ul>
          <li><code>work_order.opened</code></li>
          <li><code>work_order.updated</code></li>
          <li><code>work_order.closed</code></li>
          <li><code>work_order.cancelled</code></li>
        </ul>
        <p>
          <strong>What happens on success.</strong> A row lands in{' '}
          <code>cmms_sync_events</code> (audit-only) and the
          <code>cmms_work_order_links</code> row for{' '}
          <code>(cmms_system, work_order_id)</code> is upserted with
          the new status.
        </p>
        <p>
          <strong>The equipment-detail callout.</strong> When any open
          CMMS WO is linked to a piece of equipment, the equipment
          detail page renders a yellow banner with a CTA to record a
          periodic inspection. Closing the WO via webhook removes the
          banner automatically.
        </p>
        <p>
          <strong>Outbound (Soteria → CMMS).</strong> Schema in place
          (<code>direction = outbound</code> on the events table); a
          future cron will sign outgoing payloads with{' '}
          <code>signHmac</code> using the same shared secret.
        </p>
      </Section>

      <Section id="bbs" title="BBS v2 observations">
        <p>
          <strong>Where to find them.</strong> Workers capture at{' '}
          <Link href="/bbs/observe">/bbs/observe</Link> (large tap
          targets, mobile-first). Admins review at{' '}
          <Link href="/admin/observations/bbs/dashboard">/admin/observations/bbs/dashboard</Link>.
        </p>
        <p>
          <strong>Why v2 alongside v1?</strong> The existing BBS surface
          predates the category model the EHS community settled on
          (safe_behavior / unsafe_act / unsafe_condition). v2 adds the
          category as a first-class field plus follow-up tracking.
          Same intentional-parallel pattern Module 2 used for
          incident_capas vs incident_actions.
        </p>
        <p>
          <strong>The headline metric.</strong>{' '}
          <code>safe_to_unsafe_ratio = safe_count / (unsafe_act + unsafe_condition)</code>.
          Bands:
        </p>
        <ul>
          <li><strong>Red</strong> — ratio &lt; 2:1 — too few safe observations; coaching not catching up</li>
          <li><strong>Yellow</strong> — 2:1 ≤ ratio &lt; 4:1 — coaching present but not yet leading</li>
          <li><strong>Green</strong> — ratio ≥ 4:1 — healthy program</li>
        </ul>
        <p>
          The ratio is <em>null</em> when there are no unsafe
          observations — the metric is undefined, not infinite. The
          band helper buckets null as red on the principle that
          all-safe with no unsafe is a suspicious pattern (observer
          training is needed, or there&apos;s under-reporting).
        </p>
        <p>
          <strong>Follow-ups.</strong> When an observation is marked
          <code>follow_up_required = true</code>, it appears on the
          dashboard&apos;s &quot;Follow-ups due&quot; list until
          <code>follow_up_completed_at</code> is set. The list is the
          admin&apos;s daily action queue.
        </p>
      </Section>

      <Section id="prequal" title="Vendor / contractor prequalification">
        <p>
          <strong>Where to find it.</strong> Open any contractor row
          in <Link href="/admin/people/contractors">/admin/people/contractors</Link>,
          click <em>Manage prequalification</em>.
        </p>
        <p>
          <strong>The 8 questions.</strong>
        </p>
        <ol>
          <li>Safety management system (free text)</li>
          <li>Experience modification rate (EMR) — free text</li>
          <li>Days away, restricted, transferred (DART) rate</li>
          <li>Total recordable incident rate (TRIR)</li>
          <li>ISO certifications held</li>
          <li>Drug and alcohol program in place — boolean</li>
          <li>Insurance limits (general + auto + WC)</li>
          <li>References (free text)</li>
        </ol>
        <p>
          The schema is deliberately lean — free-text + one boolean.
          The point is to record an answer per question, not enforce a
          particular form structure. Standardize on your industry&apos;s
          questions over time.
        </p>
        <p>
          <strong>Contractor portal.</strong> Admin sends the public
          URL (<code>/contractor-prequal/[token]</code>) to the
          contractor. They fill the form without a login. The token
          regex (<code>^[0-9a-f]{'{'}32{'}'}$</code>) is checked on
          every request; expired or rejected prequals return 410 with
          a friendly message — no leak of underlying answers.
        </p>
        <p>
          <strong>Lifecycle.</strong>{' '}
          <code>invited → in_progress → approved | rejected</code>;
          approval carries an <code>approval_expires_at</code>. The
          classifier returns:
        </p>
        <ul>
          <li><code>pending</code> — invited / in_progress</li>
          <li><code>approved</code> — approved + expiry &gt; 30 days out</li>
          <li><code>expiring</code> — approved + expiry within 30 days</li>
          <li><code>expired</code> — approved + past expiry, OR DB status === expired, OR status === rejected</li>
        </ul>
        <p>
          Approved with null or unparseable expiry → expired (fail-safe;
          we never accept &quot;approved forever&quot;).
        </p>
      </Section>

      <Section id="i18n" title="Multi-language (i18n)">
        <p>
          <strong>Where to set it.</strong> The tenant-level language
          picker is on{' '}
          <Link href="/admin/platform/configuration">/admin/platform/configuration</Link>.
          Options: English, Español, Français.
        </p>
        <p>
          <strong>What&apos;s translated.</strong> ~20 high-impact
          strings: nav labels, placard headers, common form labels
          (Save / Cancel / Submit / Description / Location).
        </p>
        <p>
          <strong>Fallback chain.</strong> target → English → raw key.
          A missing French key surfaces the English value. A missing
          English key surfaces the raw key itself (so missing entries
          are visible, not silently blank).
        </p>
        <p>
          <strong>Adding a string.</strong> Open{' '}
          <code>packages/core/src/i18n/strings.en.json</code> and add
          your key + value. Copy the same key to the{' '}
          <code>strings.es.json</code> and <code>strings.fr.json</code>
          {' '}files with the translated values. The{' '}
          <code>t(key, lang)</code> helper will pick them up
          automatically on the next render.
        </p>
        <p>
          <strong>Known gap.</strong> The placard PDF generator
          currently has hardcoded EN / ES rendering paths. French is
          dictionary-ready but the placard renderer hasn&apos;t been
          generalized to honor the tenant language preference for the
          third language. A follow-up PR will close this.
        </p>
      </Section>

      <Section id="changelog" title="Changelog">
        <ul>
          {CHANGELOG.map(entry => (
            <li key={entry.version}>
              <strong>v{entry.version}</strong>{' '}
              <span className="text-slate-500 dark:text-slate-400">({entry.date})</span>
              <ul className="ml-5 list-disc">
                {entry.changes.map((change, i) => <li key={i}>{change}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 space-y-2">
      <h2 className="text-xl font-semibold border-b border-slate-200 dark:border-slate-800 pb-1">
        {title}
      </h2>
      <div className="prose prose-slate dark:prose-invert text-sm leading-6 [&>p]:my-2 [&>ul]:my-2 [&>ul]:ml-5 [&>ul]:list-disc [&_a]:underline">
        {children}
      </div>
    </section>
  )
}
