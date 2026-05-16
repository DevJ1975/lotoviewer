import Link from 'next/link'
import { ArrowLeft, BookOpen } from 'lucide-react'
import type { ReactNode } from 'react'

// /admin/integrity-manual — user manual for Module 2: Integrity & Compliance.
//
// Update protocol when behavior changes:
//   1. Edit the relevant section below.
//   2. Bump CURRENT_VERSION + add a CHANGELOG row (top is newest).
//   3. Mirror the change in /wiki/integrity-compliance.

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
      'Initial publication for the Integrity & Compliance module.',
      'Covers sealed PDF artifacts (SHA-256 chain-of-custody), tenant ' +
      'retention policy + legal holds, incident CAPAs with ISO 45001 ' +
      '§10.2 verification-of-effectiveness, hierarchy-of-controls ' +
      'on near-miss → risk escalation, ISO 45001:2018 clause-evidence ' +
      'map with PDF export, and AI-assisted severity escalation.',
    ],
  },
]

export default function IntegrityManualPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-8 text-slate-800 dark:text-slate-100">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/iso45001"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to ISO 45001 map
        </Link>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          v{CURRENT_VERSION} · updated {LAST_UPDATED}
        </span>
      </div>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow text-xs font-semibold">
          <BookOpen className="h-3.5 w-3.5" /> User manual
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Integrity & Compliance module</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Operating guide for the cross-cutting compliance surface:
          chain-of-custody hashes, retention windows + legal holds,
          ISO 45001 §10.2 corrective-action verification, hierarchy-of-
          controls discipline, ISO 45001:2018 evidence-pack exports, and
          AI-assisted severity triage.
        </p>
      </header>

      <nav className="text-xs text-slate-500 dark:text-slate-400 space-y-1 border border-slate-200 dark:border-slate-800 rounded-md p-3">
        <p className="font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Contents</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li><a className="underline" href="#overview">What this module is for</a></li>
          <li><a className="underline" href="#sealed">Sealed PDF artifacts</a></li>
          <li><a className="underline" href="#retention">Retention + legal holds</a></li>
          <li><a className="underline" href="#capas">CAPA → verification of effectiveness</a></li>
          <li><a className="underline" href="#hierarchy">Hierarchy of controls on escalation</a></li>
          <li><a className="underline" href="#iso45001">ISO 45001 clause-evidence map</a></li>
          <li><a className="underline" href="#ai">AI-assisted severity prediction</a></li>
          <li><a className="underline" href="#changelog">Changelog</a></li>
        </ol>
      </nav>

      <Section id="overview" title="What this module is for">
        <p>
          Every other module produces records. This module is what makes
          those records defensible to a regulator. Six surfaces, each
          independent: sealed PDFs, retention + holds, CAPAs with a
          second-verifier rule, hierarchy of controls, ISO 45001 evidence,
          and AI prediction.
        </p>
        <p>
          All admin-only. Tenant-scoped end-to-end.
        </p>
      </Section>

      <Section id="sealed" title="Sealed PDF artifacts (SHA-256 chain-of-custody)">
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/signed-artifacts">/admin/signed-artifacts</Link>.
        </p>
        <p>
          <strong>How it works.</strong> When a reviewer signs off on
          a placard through the client review portal, the rendered PDF
          is hashed in the browser with the Web Crypto API
          (<code>crypto.subtle.digest('SHA-256', ...)</code>) and the
          hex digest is persisted alongside the signoff in{' '}
          <code>loto_signed_pdf_artifacts</code>. The PDF bytes go to
          storage; the hash goes to the table.
        </p>
        <p>
          <strong>How to verify.</strong> Download the PDF and run{' '}
          <code>openssl dgst -sha256 -hex placard.pdf</code> (or the
          equivalent on your platform). The output must match the
          stored hash. A mismatch is evidence of tampering — escalate
          to the audit log immediately.
        </p>
        <p>
          <strong>Where the hash surfaces.</strong> The compliance
          bundle cover sheet (<Link href="/admin/compliance-bundle">/admin/compliance-bundle</Link>)
          lists each sealed PDF&apos;s hash next to its equipment ID.
          Hand the bundle to an inspector; they can recompute against
          the attached PDFs.
        </p>
      </Section>

      <Section id="retention" title="Retention policy + legal holds">
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/retention">/admin/retention</Link>.
        </p>
        <p>
          <strong>Policy values (defaults).</strong>
        </p>
        <ul>
          <li>Incidents — 1825 days (5 years, matches OSHA 1904.33)</li>
          <li>Permits — 1095 days (3 years)</li>
          <li>Training records — 1095 days (3 years)</li>
          <li>LOTO artifacts — 7 years</li>
        </ul>
        <p>
          Edit any field in the form and save. Values are tenant-scoped;
          new tenants get the defaults via seed, existing edits stick.
        </p>
        <p>
          <strong>Legal holds.</strong> Click <em>Place a legal hold</em>,
          pick scope (incident / permit / equipment / chemical / all),
          optionally a scope_id (one specific row) or all of that type,
          enter a reason. The hold prevents the future purge cron from
          touching the matching rows — regardless of how old they are.
        </p>
        <p>
          <strong>Releasing a hold.</strong> Click <em>Release</em>, add
          a release note explaining why. The row freezes with{' '}
          <code>released_at</code> + <code>released_by_user_id</code>.
          The release itself is auditable; you cannot delete a hold row.
        </p>
        <p>
          <strong>This module does NOT delete anything.</strong> The
          actual purge cron is a separate piece of infrastructure on the
          roadmap. The retention surface lets you see what would become
          eligible (the daysUntilEligibleForPurge classifier) and place
          the holds that prevent unwanted deletion later.
        </p>
      </Section>

      <Section id="capas" title="Incident CAPAs with verification of effectiveness">
        <p>
          <strong>Where to find it.</strong> Open any incident detail
          page (<Link href="/incidents">/incidents</Link> → row); the
          <strong> CAPAs</strong> panel is below the main investigation
          section.
        </p>
        <p>
          <strong>Why a second CAPA surface?</strong> The platform
          already has <code>incident_actions</code> for action-item
          tracking. ISO 45001 §10.2 distinguishes between &quot;closing
          the action&quot; and &quot;verifying the action was
          effective.&quot; The new <code>incident_capas</code> table is
          focused on the latter — a structured second-pair-of-eyes
          confirmation that the underlying nonconformity is actually
          eliminated.
        </p>
        <p>
          <strong>Adding a CAPA.</strong> Click <em>Add CAPA</em>, set
          the description, hierarchy_level (eliminate / substitute /
          engineering / administrative / ppe), assignee (a tenant user),
          and due date.
        </p>
        <p>
          <strong>Lifecycle.</strong>{' '}
          <code>open</code> → <code>in_progress</code> →{' '}
          <code>completed</code> → <code>verified</code>.{' '}
          <code>cancelled</code> is a terminal off-ramp.
        </p>
        <p>
          <strong>The different-verifier rule.</strong> The user who
          marks a CAPA <em>completed</em> CANNOT be the same user who
          marks it <em>verified-effective</em>. The API returns a
          403 if you try; the DB trigger backs it up as defense in
          depth. Workflow: complete it, then ask a colleague (typically
          your safety lead or supervisor) to log in and verify.
        </p>
        <p>
          <strong>Insights widget.</strong> The CAPA widget on{' '}
          <Link href="/admin/insights">/admin/insights</Link> shows
          counts: open / overdue / awaiting verification / verified.
          Click any count to drill into the matching incidents.
        </p>
      </Section>

      <Section id="hierarchy" title="Hierarchy of controls on escalation">
        <p>
          <strong>Where to find it.</strong> On any near-miss detail
          page, click <em>Escalate to risk</em>.
        </p>
        <p>
          <strong>The new requirement.</strong> The escalate modal now
          requires you to pick at least one initial mitigating control
          with a hierarchy level. Saving without a control, or with a
          control that has no hierarchy_level, returns a 400.
        </p>
        <p>
          <strong>The hierarchy (highest preference first).</strong>
        </p>
        <ol>
          <li><strong>Eliminate</strong> — remove the hazard entirely</li>
          <li><strong>Substitute</strong> — replace with something less hazardous</li>
          <li><strong>Engineering</strong> — physical guards, ventilation, interlocks</li>
          <li><strong>Administrative</strong> — procedures, training, signage</li>
          <li><strong>PPE</strong> — the last line, not the first</li>
        </ol>
        <p>
          <strong>Where the summary surfaces.</strong> The risk detail
          page renders a <em>ControlsHierarchySummary</em> — a stacked
          breakdown with a &quot;top-of-hierarchy&quot; indicator. If
          any Eliminate control exists on the risk, that&apos;s the top;
          else any Substitute; etc. A risk whose top is PPE is a risk
          your program isn&apos;t actually controlling.
        </p>
        <p>
          <strong>Long-form vs short-form.</strong> The platform&apos;s
          historical <code>risk_controls.hierarchy_level</code> column
          stored long forms (<code>elimination</code>,{' '}
          <code>substitution</code>). New code uses short forms
          (<code>eliminate</code>, <code>substitute</code>). The
          <code>risk_controls_hierarchy</code> view exposes both. The
          <code>normalizeHierarchyLevel</code> helper accepts either.
        </p>
      </Section>

      <Section id="iso45001" title="ISO 45001 clause-evidence map">
        <p>
          <strong>Where to find it.</strong>{' '}
          <Link href="/admin/iso45001">/admin/iso45001</Link>.
        </p>
        <p>
          <strong>What it does.</strong> Each ISO 45001:2018 clause the
          platform satisfies is listed with the source modules that
          contribute. Click a clause to see the actual evidence rows
          for the current tenant, filterable by date.
        </p>
        <p>
          <strong>Evidence-pack export.</strong> On a clause detail
          page, click <em>Export evidence pack</em>. A PDF generates
          with the clause cover sheet (clause code + title + your
          tenant&apos;s name + the date range) and the underlying
          evidence rows. Hand to an external auditor.
        </p>
        <p>
          <strong>Clauses covered.</strong>
        </p>
        <ul>
          <li><strong>6.1.2.1</strong> — Hazard identification (risks, near-misses)</li>
          <li><strong>7.2</strong> — Competence (training records, competency exams)</li>
          <li><strong>7.3</strong> — Awareness (worker roster)</li>
          <li><strong>8.1.2</strong> — Eliminating hazards and reducing risks (risks, incidents, controls)</li>
          <li><strong>9.1</strong> — Monitoring + measurement (incidents, audit log)</li>
          <li><strong>10.2</strong> — Nonconformity + corrective action (incident_capas)</li>
        </ul>
      </Section>

      <Section id="ai" title="AI-assisted severity escalation prediction">
        <p>
          <strong>Where to find it.</strong> On any incident detail
          page, the <em>Run prediction</em> button in the
          EscalationPredictionPanel.
        </p>
        <p>
          <strong>What it does.</strong> Sends the incident description,
          location, type, and the reporter&apos;s severity
          classification to Claude Haiku, which returns a JSON-schema-
          constrained response: predicted severity (one of catastrophic
          / fatality / lost_time / medical / first_aid / none),
          confidence (0–1), and a reasoning paragraph.
        </p>
        <p>
          <strong>When it surfaces a banner.</strong>{' '}
          <code>shouldEscalate(currentSeverity, prediction)</code> is
          true when the predicted severity is STRICTLY higher than the
          current one AND the confidence is at-or-above 0.7. The
          banner is yellow with a <em>Consider reclassifying</em> CTA.
        </p>
        <p>
          <strong>What it does NOT do.</strong> The endpoint never
          mutates <code>severity_actual</code>. The model&apos;s output
          is advisory; the admin makes the call.
        </p>
        <p>
          <strong>Cost + rate limits.</strong> 30 predictions per admin
          per hour, 150 per day. Hits return 429 with a{' '}
          <code>retry-after</code> header. Every invocation is logged
          to the existing AI-usage audit so you can see token spend
          per tenant.
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
