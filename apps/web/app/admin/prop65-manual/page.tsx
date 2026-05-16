import Link from 'next/link'
import { ArrowLeft, BookOpen } from 'lucide-react'
import type { ReactNode } from 'react'

// /admin/prop65-manual — user manual for the California Prop 65 module.
//
// Update protocol when behavior changes:
//   1. Edit the relevant section below.
//   2. Bump CURRENT_VERSION + add a CHANGELOG row (top is newest).
//   3. Mirror the change in /wiki/prop65.

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-16'

interface ChangelogEntry {
  version: string
  date:    string
  changes: string[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-05-16',
    changes: [
      'Initial publication for the California Prop 65 module.',
      'Covers OEHHA chemical list, per-tenant linking, California ' +
      'sites with public-slug routing, exposure assessments with ' +
      'safe-harbor classification, posted warnings (long + short, ' +
      'EN + ES) with photo evidence, §5194(h) employee notifications ' +
      '(with auto-fire trigger on signed Prop 65 training records), ' +
      'and §25249.5 annual reviews.',
    ],
  },
]

export default function Prop65ManualPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-8 text-slate-800 dark:text-slate-100">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/prop65"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Prop 65 dashboard
        </Link>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          v{CURRENT_VERSION} · updated {LAST_UPDATED}
        </span>
      </div>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow text-xs font-semibold">
          <BookOpen className="h-3.5 w-3.5" /> User manual
        </div>
        <h1 className="text-3xl font-bold tracking-tight">California Prop 65 module</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Operating guide for California Health & Safety Code
          §25249.6 (Prop 65) and Cal/OSHA Title 8 §5194 (Hazardous
          Communication, CA flavor): chemicals, sites, exposure
          assessments, posted warnings, notifications, and the
          annual §25249.5 review cycle.
        </p>
      </header>

      <nav className="text-xs text-slate-500 dark:text-slate-400 space-y-1 border border-slate-200 dark:border-slate-800 rounded-md p-3">
        <p className="font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Contents</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li><a className="underline" href="#overview">What this module is for</a></li>
          <li><a className="underline" href="#linking">OEHHA list + chemical linking</a></li>
          <li><a className="underline" href="#sites">California sites + public route</a></li>
          <li><a className="underline" href="#assessments">Exposure assessments + safe harbor</a></li>
          <li><a className="underline" href="#warnings">Posted warnings</a></li>
          <li><a className="underline" href="#notifications">§5194(h) notifications</a></li>
          <li><a className="underline" href="#annual">Annual review</a></li>
          <li><a className="underline" href="#integrations">Integrations with other modules</a></li>
          <li><a className="underline" href="#changelog">Changelog</a></li>
        </ol>
      </nav>

      <Section id="overview" title="What this module is for">
        <p>
          Prop 65 is California&apos;s right-to-know-and-warn regime,
          and Title 8 §5194 is the workplace half. The module records
          everything the §25249.6 affirmative defense and the §5194(h)
          notification obligation both require: which chemicals you
          have, where, at what exposure, how you warned employees and
          the public, and that you reviewed it all annually.
        </p>
        <p>
          The module does NOT make the legal call. &quot;Below safe
          harbor&quot; in the classifier is a number comparison, not
          a legal conclusion. The defense requires a defensible
          exposure methodology — record it in the assessment notes
          field and have it reviewed by counsel.
        </p>
      </Section>

      <Section id="linking" title="OEHHA list + chemical linking">
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/prop65/chemicals">/admin/prop65/chemicals</Link>.
        </p>
        <p>
          The OEHHA list lives in <code>prop65_chemicals</code> as a
          system-wide read-only table (seeded with 20 industrial
          chemicals at install; refreshed via CSV upload). Your
          tenant&apos;s chemical-inventory rows map to OEHHA entries
          via auto-suggested CAS matches that an admin confirms.
        </p>
        <p>
          <strong>Confidence values.</strong> Auto-matches start at
          <code> auto</code>. Confirming flips to{' '}
          <code>confirmed</code>. Only confirmed links count as
          established for downstream workflows (the assessment form,
          the warning generator, the compliance bundle).
        </p>
        <p>
          <strong>Refreshing the OEHHA list.</strong> Superadmin only.{' '}
          <Link href="/admin/prop65/import">/admin/prop65/import</Link>.
          Drop the CSV downloaded from{' '}
          <code>oehha.ca.gov/proposition-65/proposition-65-list</code>;
          existing rows are upserted by CAS, new rows added. The list
          updates a few times per year.
        </p>
      </Section>

      <Section id="sites" title="California sites + public route">
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/prop65/sites">/admin/prop65/sites</Link>.
        </p>
        <p>
          A site is one California-resident location subject to
          §5194. State defaults to <code>CA</code> on insert.
          <code> public_slug</code> is auto-generated by trigger from
          the name; collisions get a random suffix.
        </p>
        <p>
          <strong>The public page.</strong> The slug routes to{' '}
          <code>/prop65/&lt;slug&gt;</code>, which renders the
          currently-posted warnings for the site. No login required —
          this is the destination for the <code>www.P65Warnings.ca.gov</code>{' '}
          reference URL on physical workplace signs. The page reads
          via the Supabase anon-key client; column-level grants
          (migration 178) restrict the visible columns to{' '}
          <code>name</code>, <code>city</code>, <code>state</code>,
          <code> public_slug</code> on the site and the sign-content
          columns on the warning. tenant_id, address, employee count,
          and posted_by user are all unreachable from an anonymous
          PostgREST query.
        </p>
      </Section>

      <Section id="assessments" title="Exposure assessments + safe harbor">
        <p>
          <strong>Where to find it.</strong> From any site detail
          page → <em>New assessment</em>, or directly at{' '}
          <Link href="/admin/prop65/assessments/new">/admin/prop65/assessments/new</Link>.
        </p>
        <p>
          <strong>Workflow.</strong> Pick a confirmed-linked chemical,
          pick the exposure route (inhalation / dermal / ingestion /
          multiple), enter the estimated daily intake in mg, write up
          the methodology that produced the estimate. The right-side
          preview classifies against the OEHHA-published safe-harbor
          number using strict less-than: an exposure exactly at the
          threshold is NOT cleared.
        </p>
        <p>
          <strong>The classifier rules.</strong>
        </p>
        <ul>
          <li><em>cancer</em> endpoint → compare to{' '}
            <code>nsrl_mg_day</code>. The 1000x lifetime safety
            factor is already in the published NSRL (Cal. Code Regs
            §25721) — don&apos;t multiply again.</li>
          <li><em>reproductive</em> endpoint → compare to{' '}
            <code>madl_mg_day</code>.</li>
          <li><em>both</em> endpoint → require both to clear;
            missing either number returns <em>unknown</em>.</li>
          <li>Missing safe-harbor values, NaN, negative, Infinity —
            all return <em>unknown</em>, never{' '}
            <em>below_safe_harbor</em>. Fail-safe.</li>
        </ul>
        <p>
          <strong>Signing freezes the row.</strong> Once signed (typed
          name + timestamp), the assessment is part of the audit
          record. Edits create new rows.
        </p>
      </Section>

      <Section id="warnings" title="Posted warnings">
        <p>
          <strong>Where to find it.</strong> Site detail →{' '}
          <em>Record posted warning</em>, or directly at{' '}
          <Link href="/admin/prop65/warnings/new">/admin/prop65/warnings/new</Link>.
        </p>
        <p>
          <strong>Long-form vs short-form (Cal. Code Regs §25603).</strong>
        </p>
        <ul>
          <li><strong>Long-form</strong> is the default. Includes the
            ⚠ symbol, a clause per active endpoint, the chemical
            names verbatim (including parentheses and Roman numerals —
            DEHP, Cr(VI) render correctly), and the canonical
            <code> www.P65Warnings.ca.gov</code> reference URL.</li>
          <li><strong>Short-form</strong> (§25603(b)) is allowed on
            physical labels ≤ 5 in². Drops the chemical names; uses
            the bucketed heading (&quot;Cancer Risk&quot;,
            &quot;Reproductive Harm&quot;, or &quot;Cancer and
            Reproductive Harm&quot;).</li>
        </ul>
        <p>
          <strong>Language.</strong> EN and ES are safe-harbor under
          the 2018 regs. Additional languages aren&apos;t — if you
          post in Vietnamese or Tagalog, the safe-harbor sign must
          STILL be present in English, with the additional language
          layered on top.
        </p>
        <p>
          <strong>Photo evidence.</strong> Upload a photo of the
          ACTUAL posted sign. The compliance bundle relies on this
          photo URL; a record without a photo is a documentation gap
          a plaintiff will exploit.
        </p>
        <p>
          <strong>Removing a warning.</strong> Soft delete. Set
          <code> removed_at</code> and the public page stops showing
          the warning; the row stays for audit replay. NEVER edit a
          warning in place — replace it.
        </p>
      </Section>

      <Section id="notifications" title="§5194(h) employee notifications">
        <p>
          <strong>Where to find them.</strong> Per-site list at{' '}
          <Link href="/admin/prop65/sites">/admin/prop65/sites/[id]</Link>
          {' '}→ <em>Notifications</em> tab.
        </p>
        <p>
          <strong>What §5194(h) requires.</strong> Every employee
          must be informed of the Prop 65 chemicals they may be
          exposed to AND the information must be documented. A
          posted sign satisfies §25249.6 but does NOT alone satisfy
          §5194(h) — Cal/OSHA cites them separately.
        </p>
        <p>
          <strong>The auto-fire trigger.</strong> When a training
          record (<code>loto_training_records</code>) is signed with
          <code> metadata.prop65_topic = true</code>, a DB trigger
          fires one <code>prop65_notifications</code> row referencing
          it. The trigger picks the tenant&apos;s first declared CA
          site as the default — multi-site tenants re-home the
          notification via the admin UI.
        </p>
        <p>
          <strong>Manual notifications.</strong> For posted-sign,
          email, or pamphlet methods, record directly via the API or
          the site notifications tab.
        </p>
      </Section>

      <Section id="annual" title="Annual review (§25249.5)">
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/prop65/annual-review">/admin/prop65/annual-review</Link>.
        </p>
        <p>
          One review per tenant per calendar year. Reviewer signs
          off on the chemical inventory, exposure assessments, and
          posted warnings; records deviations and corrective actions
          taken. The unique constraint on{' '}
          <code>(tenant_id, review_year)</code> prevents duplicate
          reviews.
        </p>
        <p>
          <strong>Due-date math.</strong> Signing sets{' '}
          <code>next_due_at = signed_at + 365 days</code>. The
          dashboard surfaces the overdue indicator past that date.
        </p>
      </Section>

      <Section id="integrations" title="Integrations with other modules">
        <ul>
          <li><strong>Chemicals inventory.</strong>{' '}
            <Link href="/chemicals/inventory">/chemicals/inventory/[id]</Link>
            {' '}shows a Prop 65 status badge if the chemical is
            linked to an OEHHA entry.</li>
          <li><strong>Incidents.</strong> Incidents whose involved
            chemical is OEHHA-listed show an amber callout linking
            to a new exposure assessment.</li>
          <li><strong>Training records.</strong> A signed training
            with <code>metadata.prop65_topic = true</code> auto-fires
            a §5194(h) notification.</li>
          <li><strong>ISO 45001 clause map.</strong> Clauses 6.1.3
            (legal compliance) and 7.4 (communication) reference the
            <code> prop65_*</code> tables. Run the evidence pack
            export at{' '}
            <Link href="/admin/iso45001/6.1.3">/admin/iso45001/6.1.3</Link>
            {' '}for a clause-mapped audit deliverable.</li>
          <li><strong>Compliance bundle.</strong> The Prop 65 section
            on the next iteration of the bundle PDF pulls warnings,
            assessments, and the annual review.</li>
        </ul>
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
