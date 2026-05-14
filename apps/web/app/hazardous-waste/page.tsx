import Link from 'next/link'
import { BookOpen, CalendarClock, ChevronDown, ClipboardCheck, FileText, Smartphone } from 'lucide-react'
import {
  HAZARDOUS_WASTE_CALENDAR,
  HAZARDOUS_WASTE_DOCUMENT_PACKETS,
  HAZARDOUS_WASTE_FIELD_CHECKS,
  nextBiennialDueDate,
} from '@soteria/core/hazardousWaste'

const criticalChecks = HAZARDOUS_WASTE_FIELD_CHECKS.filter(check => check.critical).length

const SUBMISSION_MODE_LABEL: Record<typeof HAZARDOUS_WASTE_DOCUMENT_PACKETS[number]['submissionMode'], string> = {
  api_candidate: 'API submission candidate',
  portal_upload: 'Portal upload',
  pdf_record:    'PDF record',
}

// Format the next Biennial Hazardous Waste Report due date for the
// Federal Biennial row. Server-rendered as UTC "Month D, YYYY" so it
// doesn't hydrate-mismatch between SSR and client zones. Real timestamp
// is in the helper; this is just the surface.
const nextBiennialDue = nextBiennialDueDate(new Date()).toLocaleDateString('en-US', {
  year:     'numeric',
  month:    'long',
  day:      'numeric',
  timeZone: 'UTC',
})

export default function HazardousWastePage() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Hazardous Waste</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            California-forward hazardous waste operations hub for field checks, official-record preparation,
            accumulation calendars, manifest readiness, and inspection binder evidence.
          </p>
        </div>
        <Link
          href="/manuals/hazardous-waste"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90"
        >
          <BookOpen className="h-4 w-4" />
          Open manual
        </Link>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <ClipboardCheck className="h-5 w-5" />
            <h2 className="text-sm font-semibold">Field Checks</h2>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{HAZARDOUS_WASTE_FIELD_CHECKS.length}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{criticalChecks} critical checks bundled for offline use in Expo.</p>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center gap-2 text-sky-700 dark:text-sky-300">
            <FileText className="h-5 w-5" />
            <h2 className="text-sm font-semibold">Document Packets</h2>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{HAZARDOUS_WASTE_DOCUMENT_PACKETS.length}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Manifest, Site ID, Biennial, CERS, and inspection binder preparation.</p>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <CalendarClock className="h-5 w-5" />
            <h2 className="text-sm font-semibold">Calendar Rules</h2>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{HAZARDOUS_WASTE_CALENDAR.length}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Federal, California, CERS/CUPA, manifest, and inspection reminders.</p>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/hazardous-waste/streams"
          className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
        >
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Waste streams →</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Master records for each type of waste generated. Approve determinations and review codes.
          </p>
        </Link>
        <Link
          href="/hazardous-waste/containers"
          className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
        >
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Containers →</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Physical containers with accumulation aging (LQG / SQG / VSQG). Open over-limit drums first.
          </p>
        </Link>
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-md bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <Smartphone className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Expo Field Module</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              The mobile tab is built to open without a network connection. It uses shared bundled checklists,
              lets field users save a local inspection draft, and clearly separates offline field notes from
              official submitted records until a server sync workflow is added.
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            Record Packets
          </h2>
          <div className="space-y-2">
            {HAZARDOUS_WASTE_DOCUMENT_PACKETS.map(packet => (
              <details
                key={packet.id}
                className="group rounded-lg border border-slate-200 dark:border-slate-800 open:border-slate-300 dark:open:border-slate-700"
              >
                <summary className="flex cursor-pointer list-none items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-900/40 rounded-lg">
                  <ChevronDown
                    className="h-4 w-4 mt-1 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">{packet.title}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{packet.systemOutput}</p>
                  </div>
                </summary>
                <dl className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 space-y-2 text-xs">
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Official source</dt>
                    <dd className="text-slate-700 dark:text-slate-300">{packet.officialSource}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Submission mode</dt>
                    <dd className="text-slate-700 dark:text-slate-300">{SUBMISSION_MODE_LABEL[packet.submissionMode]}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Caution</dt>
                    <dd className="text-slate-700 dark:text-slate-300">{packet.caution}</dd>
                  </div>
                </dl>
              </details>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            Calendar Foundation
          </h2>
          <div className="space-y-2">
            {HAZARDOUS_WASTE_CALENDAR.map(item => (
              <details
                key={item.id}
                className="group rounded-lg border border-slate-200 dark:border-slate-800 open:border-slate-300 dark:open:border-slate-700"
              >
                <summary className="flex cursor-pointer list-none items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-900/40 rounded-lg">
                  <ChevronDown
                    className="h-4 w-4 mt-1 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.dueRule}</p>
                  </div>
                </summary>
                <dl className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 space-y-2 text-xs">
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Cadence</dt>
                    <dd className="text-slate-700 dark:text-slate-300">{item.cadence}</dd>
                  </div>
                  {item.id === 'federal-biennial-report' && (
                    <div>
                      <dt className="font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Next due</dt>
                      <dd className="text-slate-700 dark:text-slate-300">{nextBiennialDue}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Owner</dt>
                    <dd className="text-slate-700 dark:text-slate-300">{item.ownerHint}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</dt>
                    <dd className="text-slate-700 dark:text-slate-300">{item.notes}</dd>
                  </div>
                </dl>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
