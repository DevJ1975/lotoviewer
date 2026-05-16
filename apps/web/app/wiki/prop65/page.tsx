import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-16'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-05-16',
    changes: [
      'Initial publication for the California Proposition 65 + Cal/OSHA ' +
      'Title 8 §5194 module: OEHHA chemical list, per-tenant chemical ' +
      'links, California sites with public-slug routing, exposure ' +
      'assessments with safe-harbor classification, posted warnings ' +
      'with photo evidence, §5194(h) employee notifications, §25249.5 ' +
      'annual reviews, and a public-facing /prop65/[slug] warning page.',
    ],
  },
]

export default function WikiProp65Page() {
  return (
    <WikiPage
      title="Proposition 65"
      subtitle="California Health & Safety Code §25249.6 + Cal/OSHA Title 8 §5194 — chemicals, sites, exposure assessments, warnings, notifications."
      modulePath="/admin/prop65"
      audience="admin"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',  label: 'What it\'s for' },
        { id: 'list',      label: 'OEHHA list + chemical linking' },
        { id: 'sites',     label: 'California sites' },
        { id: 'assess',    label: 'Exposure assessments + safe harbor' },
        { id: 'warnings',  label: 'Posted warnings + public page' },
        { id: 'notify',    label: '§5194 notifications' },
        { id: 'annual',    label: 'Annual review' },
        { id: 'faq',       label: 'FAQ' },
        { id: 'dodonts',   label: 'Do\'s & Don\'ts' },
        { id: 'related',   label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          California&apos;s Proposition 65 (Safe Drinking Water and
          Toxic Enforcement Act, 1986) requires businesses to warn
          about exposures to chemicals on the OEHHA list. The
          workplace half is enforced by Cal/OSHA via Title 8 §5194,
          the Hazardous Communication Standard&apos;s California
          flavor. Private bounty-hunter enforcement under §25249.7
          makes documentation the entire legal defense.
        </p>
        <p>
          This module is the documentation surface. It does not make
          the legal call for you — the &quot;below safe harbor&quot;
          determination ultimately requires a defensible exposure-
          assessment methodology, which is a human responsibility.
          The system records what was assessed, by whom, with what
          inputs, and surfaces the OEHHA-published safe-harbor numbers
          for comparison.
        </p>
      </Section>

      <Section id="list" title="OEHHA list + chemical linking">
        <p>
          The OEHHA list (~1,000 chemicals) is system-wide, not
          tenant-scoped. It lives in <code>prop65_chemicals</code>,
          seeded with 20 of the most common industrial chemicals
          (lead, benzene, hexavalent chromium, formaldehyde, methylene
          chloride, etc.) with real CAS numbers and OEHHA-published
          NSRL/MADL values where available.
        </p>
        <p>
          Each tenant&apos;s <code>chemicals_inventory</code> rows
          map to OEHHA entries via{' '}
          <Link href="/admin/prop65/chemicals">/admin/prop65/chemicals</Link>.
          The page auto-suggests links by CAS number; admins confirm
          (or clear) per row. Confidence is recorded as{' '}
          <code>auto</code> until explicitly confirmed.
        </p>
        <p>
          Superadmins refresh the OEHHA list via CSV upload at{' '}
          <Link href="/admin/prop65/import">/admin/prop65/import</Link>.
          The list updates a few times per year as OEHHA adds new
          chemicals.
        </p>
      </Section>

      <Section id="sites" title="California sites">
        <p>
          A tenant&apos;s California-resident locations live in
          <code> prop65_sites</code>. Each site carries a
          <code> public_slug</code>, auto-generated on insert via a
          BEFORE-INSERT trigger, used as the path segment of the
          publicly-accessible warning page.
        </p>
        <p>
          The §5194 obligation is per-location: a single tenant with
          three California facilities posts warnings (and tracks
          notifications) per facility, even when the chemical mix
          overlaps.
        </p>
      </Section>

      <Section id="assess" title="Exposure assessments + safe harbor">
        <p>
          The §25249.6 affirmative defense rests on documenting that
          the exposure is below the OEHHA safe-harbor level. Two
          thresholds, per chemical, per endpoint:
        </p>
        <ul>
          <li><strong>NSRL</strong> — No Significant Risk Level (cancer
              endpoint, mg/day). The lifetime 1000x safety factor IS
              the NSRL definition per Cal. Code Regs §25721 —
              don&apos;t multiply again.</li>
          <li><strong>MADL</strong> — Maximum Allowable Dose Level
              (reproductive endpoint, mg/day).</li>
        </ul>
        <p>
          The classifier in <code>@soteria/core/prop65</code> uses
          strict less-than at the boundary: an exposure exactly at
          the safe-harbor level is NOT documented as cleared. OEHHA
          publishes these numbers as upper bounds; sitting on the
          line is not a defense.
        </p>
        <p>
          A missing safe-harbor value returns <code>unknown</code>,
          never <code>below_safe_harbor</code>. The fail-safe is
          load-bearing — a missing repro number cannot be masked by a
          clearing cancer number.
        </p>
      </Section>

      <Section id="warnings" title="Posted warnings + public /prop65/[slug] page">
        <p>
          The physical sign at the workplace cites a reference URL
          (<code>www.P65Warnings.ca.gov</code>) per Cal. Code Regs
          §25602(a)(4). That URL is supposed to redirect to a page
          disclosing the specific chemicals. Each site&apos;s public
          slug gives you that destination at{' '}
          <code>/prop65/&lt;slug&gt;</code>.
        </p>
        <p>
          When an admin records a posted warning at{' '}
          <Link href="/admin/prop65/warnings/new">/admin/prop65/warnings/new</Link>,
          they pick the chemicals + warning type (long-form per
          §25603, or short-form per §25603(b)) + language (EN or ES;
          additional languages aren&apos;t safe-harbor), and the
          system renders the exact text required by the 2018
          regulatory package. They upload a photo of the actual
          posted sign for the audit trail.
        </p>
        <p>
          Removing a warning is a soft-delete: <code>removed_at</code>
          fires, the public page stops showing the warning, but the
          row stays for audit replay.
        </p>
      </Section>

      <Section id="notify" title="§5194 employee notifications">
        <p>
          Title 8 §5194(h) requires the host employer to inform every
          employee of the Prop 65 chemicals they may be exposed to,
          and to document that the information was provided.{' '}
          <code>prop65_notifications</code> records each event with
          notification method (posted sign, training, email, pamphlet)
          and worker reference.
        </p>
        <p>
          A signed Prop 65 training record (<code>metadata.prop65_topic
          = true</code>) auto-fires a notification via DB trigger.
          The trigger picks the tenant&apos;s first declared CA site
          as the default; multi-site tenants re-home the row via the
          admin UI.
        </p>
      </Section>

      <Section id="annual" title="Annual review (§25249.5)">
        <p>
          One review per calendar year per tenant. Reviewer signs off
          on the chemical inventory, exposure assessments, and posted
          warnings, recording any deviations and the corrective
          actions taken. The <code>next_due_at</code> column
          re-anchors to the signed date + 365 days; the dashboard
          surfaces the overdue indicator when the date passes.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'A chemical on our inventory has a CAS that matches an OEHHA entry. Is the link automatic?',
            a: <>The match suggestion is automatic; the confirmation
              is a human step. The /admin/prop65/chemicals page shows
              auto-matches with a Confirm button. We leave the
              confirmation step in because OEHHA&apos;s list
              sometimes covers a CAS-identical substance only at
              specific concentrations or chemical states (e.g.
              hexavalent chromium vs. trivalent chromium — same CAS
              family, different listing).</>,
          },
          {
            q: 'Our exposure is exactly at the NSRL. Is that documented as cleared?',
            a: <>No. The classifier uses strict less-than at the
              boundary. OEHHA publishes the numbers as upper bounds —
              sitting exactly on the line is not a §25249.6
              affirmative defense. Either drive the exposure down or
              post the warning.</>,
          },
          {
            q: 'A chemical has an NSRL but no MADL. What does "both endpoint" return?',
            a: <>Unknown. The fail-safe rule is that a missing repro
              number can&apos;t be masked by a clearing cancer
              number. Either record the assessment against just the
              cancer endpoint, or confirm that the chemical is
              cancer-only on the OEHHA list.</>,
          },
          {
            q: 'I posted a warning, then realized the chemical list was wrong. Edit or replace?',
            a: <>Replace. Mark the old warning removed (preserves the
              audit trail), then record a new one with the correct
              chemicals. The public /prop65/&lt;slug&gt; page
              automatically reflects the active set.</>,
          },
          {
            q: 'Who can see the /prop65/[slug] page?',
            a: <>Anyone — that&apos;s the design. The public sign
              cites the reference URL; the URL must be reachable
              without a login for the regulatory redirect to work.
              The route reads via the Supabase anon-key client; the
              anon-read RLS policies + column-level grants in
              migrations 172, 174, and 178 narrow what&apos;s
              exposed to the public-safe columns (no tenant_id, no
              addresses, no employee count).</>,
          },
          {
            q: 'A bounty-hunter sent a 60-day notice. Does this module help?',
            a: <>It helps by giving you a single place to find the
              relevant assessments, warnings, and notifications for
              the chemical + site at issue. The compliance bundle on
              /admin/compliance-bundle pulls the data into an
              auditable PDF. The module does NOT track the litigation
              itself — that&apos;s your counsel&apos;s job.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Run the chemical-linking step once after every chemical inventory import. Auto-matches surface immediately; left unconfirmed, they don\'t count as established for §25249.6 documentation purposes.',
            'Photograph every posted sign. The compliance bundle relies on the photo URL — a record of "we posted it" without a photo is a 60-day-notice opportunity.',
            'Re-run the annual review on time. The dashboard surfaces the overdue indicator; the underlying §25249.5 cycle resets the year-by-year audit defense.',
            'Use the long-form warning unless your sign genuinely has < 5 in² of label space. Short-form is regulatorily safer for non-products only when the chemical list won\'t fit.',
            'Treat the "below safe harbor" classification as a NUMBER comparison, not a legal conclusion. The defense requires the methodology too — record it in the assessment notes.',
          ]}
          donts={[
            'Don\'t edit a posted warning in place — replace it. Edit history is preserved per the audit log, but the regulatory record needs a clean before/after.',
            'Don\'t treat the OEHHA-published NSRL/MADL as a target to optimize to. Lower-is-better; sitting just below the line is a 60-day-notice trap.',
            'Don\'t enable the public route in a tenant that doesn\'t have California operations. The slug is publicly enumerable; only declare sites you actually have.',
            'Don\'t skip the §5194(h) notification step on the assumption that a posted sign covers it. Cal/OSHA cites the two separately — posted sign satisfies §25249.6; documented notification satisfies §5194(h).',
            'Don\'t multiply the OEHHA NSRL by your own safety factor. The 1000x factor is already in the published number per Cal. Code Regs §25721.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/integrity-compliance', label: 'Integrity & Compliance' },
          { href: '/wiki/compliance-bundle',    label: 'Compliance Bundle' },
          { href: '/wiki/training-records',     label: 'Training records' },
          { href: '/wiki/audit',                label: 'Audit log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
