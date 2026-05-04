import Link from 'next/link'
import { ArrowLeft, BookOpen } from 'lucide-react'

// /loto/manual — user manual for the LOTO module.
//
// Update protocol when LOTO behavior changes:
//   1. Edit the relevant section below.
//   2. Bump CURRENT_VERSION + add a row to CHANGELOG (top is newest).
//   3. Mention the manual section in the PR description so reviewers
//      sanity-check that the docs match the code.
//
// Why a TSX page instead of a markdown file: avoids adding a
// markdown-rendering dependency, keeps the manual server-rendered
// for instant first paint, and lets us link directly to other app
// routes inline.

const CURRENT_VERSION = '1.1.0'
const LAST_UPDATED   = '2026-05-04'

interface ChangelogEntry {
  version:  string
  date:     string
  /** Bulleted summary of what changed. */
  changes:  string[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.1.0',
    date:    '2026-05-04',
    changes: [
      'Added the Client Review Portal: admins can email a tokenized ' +
      'link to a non-Soteria reviewer (e.g. the customer’s safety ' +
      'officer) who reviews the placards, leaves per-placard notes, ' +
      'and signs off without needing an account. Admin entry point ' +
      'is the new "Send for client review" button on each ' +
      'department detail page.',
      'New /review/[token] public route, /api/admin/review-links + ' +
      '/api/review/[token] APIs, and migration 035 (loto_review_links ' +
      'plus loto_placard_reviews tables).',
    ],
  },
  {
    version: '1.0.0',
    date:    '2026-05-04',
    changes: [
      'Initial publication of the LOTO user manual.',
      'Covers Equipment Dashboard, Equipment Detail, Status Report, ' +
      'Departments, Print Queue, Import, Decommission, and Admin ' +
      '/admin/loto-devices.',
    ],
  },
]

export default function LotoManualPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-8 text-slate-800 dark:text-slate-100">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/loto"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to LOTO
        </Link>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          v{CURRENT_VERSION} · updated {LAST_UPDATED}
        </span>
      </div>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow text-xs font-semibold">
          <BookOpen className="h-3.5 w-3.5" /> User manual
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Lockout / Tagout (LOTO) module</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Day-to-day usage guide for the equipment dashboard, status report,
          departments, print queue, CSV import, decommission tools, and
          device administration. Each section maps to a screen you can open
          right now from the side drawer or via the deep links below.
        </p>
      </header>

      <Section
        id="overview"
        title="What this module is for"
      >
        <p>
          The LOTO module is the equipment-and-placard side of Soteria FIELD.
          Every piece of equipment that needs lockout/tagout has a record
          here, with two photos (the equipment itself and the
          isolation/energy-source point), an energy-source tag, an optional
          ISO callout, and a printable placard. The module is what
          maintenance and EHS teams open every day to capture photos in
          the field and print updated placards.
        </p>
        <p>
          Data is scoped per tenant: when the active tenant pill in the
          header reads <code className="kbd">[SK] Snak King #0001</code>,
          the equipment list, photos, and placards are all that
          tenant&apos;s. Switching the tenant in the header swaps the
          dataset live.
        </p>
      </Section>

      <Section id="equipment-dashboard" title="Equipment dashboard ( /loto )">
        <p>
          The main entry point. Three panels:
        </p>
        <ul>
          <li>
            <strong>Sidebar (left).</strong> Action toolbar (status report,
            CSV export, add equipment, batch print, this manual), photo-completion
            bars per department, recents, and the department list.
          </li>
          <li>
            <strong>Equipment list (middle).</strong> The active department&apos;s
            equipment, with a photo-status pill (complete / partial / missing)
            and the equipment id. Tap a row to open it.
          </li>
          <li>
            <strong>Placard panel (right).</strong> The selected piece of
            equipment&apos;s placard preview — both photos, energy source,
            ISO callout, and a Print Placard button.
          </li>
        </ul>
        <p>
          Tip: the dashboard is realtime — adding a photo from a phone
          updates the desktop view within a second without a refresh.
        </p>
      </Section>

      <Section id="equipment-detail" title="Equipment detail ( /equipment/[id] )">
        <p>
          Opened by tapping any row in the equipment list. From here you can:
        </p>
        <ul>
          <li>Capture or replace the equipment photo and the isolation photo.</li>
          <li>Edit the description, department, and energy source.</li>
          <li>Add or edit annotations (call-outs drawn on top of the ISO photo).</li>
          <li>Mark verification status (a second person confirming the placard).</li>
          <li>View the audit trail for this equipment.</li>
          <li>Generate / re-print the placard PDF.</li>
        </ul>
        <p>
          On a phone, tapping &quot;Add Photo&quot; opens the native camera.
          On a desktop, it opens a file picker.
        </p>
      </Section>

      <Section id="status-report" title="Status report ( /status )">
        <p>
          A read-only roll-up showing percent-complete per department, with a
          drill-down list of items still missing photos or verification.
          Useful for the EHS director&apos;s morning standup. The button in
          the sidebar toolbar opens this.
        </p>
      </Section>

      <Section id="departments" title="Departments ( /departments )">
        <p>
          Lists every department that has at least one piece of LOTO
          equipment, with counts. Tap a department to drill into
          <code className="kbd"> /departments/[name] </code> for its full
          equipment list.
        </p>
      </Section>

      <Section id="print-queue" title="Print queue ( /print )">
        <p>
          Multi-select equipment, then download a single PDF of all
          selected placards. The dashboard&apos;s sidebar toolbar has a
          shortcut for batch-printing an entire department in one click.
        </p>
        <p>
          Tip: PDFs are generated client-side in your browser, so a slow
          network won&apos;t hold up a print run.
        </p>
      </Section>

      <Section id="import" title="CSV import ( /import )">
        <p>
          Bulk-create equipment by uploading a CSV with columns:
          <code className="kbd"> equipment_id, description, department, prefix, energy_source </code>.
          The importer dry-runs first and shows you a diff of new rows
          and conflicts before committing. It&apos;s the right tool for
          seeding a brand-new tenant or rolling out a freshly-tagged area.
        </p>
      </Section>

      <Section id="decommission" title="Decommission ( /decommission )">
        <p>
          Mark a piece of equipment as retired without losing its history.
          Decommissioned items disappear from the main dashboard but stay
          in the audit log so you can show inspectors what was removed
          and when. Each decommission is reversible from the same screen
          via Undo.
        </p>
      </Section>

      <Section id="admin-loto-devices" title="Admin · LOTO devices ( /admin/loto-devices )">
        <p>
          Inventory of physical lock + tag hardware. Tracks current
          checkout (who has which device), serial numbers, location, and
          a &quot;needs attention&quot; banner for devices checked out
          longer than the stale-checkout threshold (designed to flag the
          classic &quot;lock left on a panel after shift change&quot;
          pattern).
        </p>
        <p>
          Admin-only: this screen is hidden from non-admin users.
        </p>
      </Section>

      <Section id="photos" title="How photos work">
        <p>
          Two photos per equipment record:
        </p>
        <ul>
          <li>
            <strong>Equipment photo.</strong> A clear shot of the equipment
            itself. Used as the placard&apos;s top image.
          </li>
          <li>
            <strong>ISO (isolation) photo.</strong> A shot of the
            isolation point (panel, valve, breaker) where the lock will go.
            Annotations drawn on this photo (arrows, circles) appear on
            the placard so a new tech knows exactly where to lock out.
          </li>
        </ul>
        <p>
          Photos are uploaded to Supabase Storage and validated client-side
          for size + orientation. HEIC photos from iPhone get converted to
          JPEG automatically. If you&apos;re offline when you take a photo,
          it&apos;s queued in the browser and uploads when connectivity
          returns.
        </p>
      </Section>

      <Section id="placards" title="Placards (the printable PDF)">
        <p>
          The placard is the laminated card you stick on the equipment.
          It&apos;s rendered client-side with <code className="kbd">pdf-lib</code>
          and includes:
        </p>
        <ul>
          <li>Tenant logo + name (top header).</li>
          <li>Equipment id + description + department.</li>
          <li>Equipment photo (top half) and ISO photo with annotations (bottom half).</li>
          <li>Energy source tag (color-coded: electrical, hydraulic, pneumatic, etc.).</li>
          <li>QR code linking back to the equipment record for quick
              re-prints from the field.</li>
          <li>Last verified date + verifier&apos;s name (if applicable).</li>
        </ul>
      </Section>

      <Section id="client-review" title="Client review portal">
        <p>
          When a department's placards are complete, you can send them out
          for client signoff without giving the reviewer a Soteria account.
          On any <code className="kbd">/departments/&#91;dept&#93;</code> page, scroll to
          <strong> Client review portal</strong> → click <strong>Send for client review</strong>,
          enter the reviewer's name + email + an optional message, and submit.
          The reviewer gets an email with a tokenized link.
        </p>
        <ul>
          <li>
            <strong>Reviewer experience.</strong> Tap the email link, see
            every placard for that department side-by-side, leave per-placard
            notes (Approve / Needs changes), then sign off the whole batch
            with a typed name + drawn signature + overall outcome.
          </li>
          <li>
            <strong>What you see back.</strong> The same panel on
            <code className="kbd"> /departments/&#91;dept&#93; </code>
            shows status badges (Sent / Opened / Approved / Needs changes / Revoked),
            the reviewer's overall comments, and per-placard notes. Revoke any
            outstanding link at any time with the inline <strong>Revoke</strong> button.
          </li>
          <li>
            <strong>Link lifetime.</strong> Default 30 days; revoke takes
            effect immediately. Once a reviewer signs off, re-opening the
            same link shows a read-only thank-you page.
          </li>
          <li>
            <strong>Audit.</strong> The signoff captures the reviewer's
            typed name, drawn signature, IP, and user-agent at submission
            time so the record holds up in front of an inspector.
          </li>
        </ul>
      </Section>

      <Section id="audit" title="Audit trail">
        <p>
          Every create, update, photo capture, and decommission is logged.
          Open <Link className="link" href="/admin/audit">/admin/audit</Link>
          {' '}to see who did what when. Filterable by equipment, user, and
          time range. This is the record an OSHA inspector wants to see.
        </p>
      </Section>

      <Section id="mobile" title="Using the mobile app">
        <p>
          The Soteria FIELD mobile app (iOS + Android) is a focused
          companion to the web dashboard. It mirrors the equipment list,
          equipment detail, and photo capture, with the device&apos;s
          native camera for fastest in-the-field captures. Permits,
          confined-spaces work, and admin tools stay on the web.
        </p>
      </Section>

      <Section id="multi-tenancy" title="Multi-tenancy notes">
        <p>
          The active tenant pill in the header drives every query. If you
          switch tenants while on a LOTO page, the page reloads with the
          new tenant&apos;s data. Equipment ids are per-tenant — two
          tenants can have their own <code className="kbd">EQ-001</code>
          without colliding.
        </p>
        <p>
          The LOTO module can be disabled per-tenant by a superadmin. If
          your tenant doesn&apos;t see /loto in the drawer, the module
          flag is off — contact your administrator.
        </p>
      </Section>

      <Section id="changelog" title="Changelog">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The version + last-updated stamp at the top of this page maps
          to the topmost entry below. Add a new row when you change LOTO
          behavior or update this manual.
        </p>
        <div className="space-y-3 mt-2">
          {CHANGELOG.map(entry => (
            <article
              key={entry.version}
              className="rounded-lg border border-slate-200 dark:border-slate-800 p-3"
            >
              <header className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">v{entry.version}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{entry.date}</span>
              </header>
              <ul className="mt-2 ml-5 list-disc text-sm space-y-1">
                {entry.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <footer className="pt-8 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-400 dark:text-slate-500">
        Source: <code className="kbd">apps/web/app/loto/manual/page.tsx</code>.
        Edits welcome via PR.
      </footer>
    </main>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
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
