import Link from 'next/link'
import { BookOpen, CalendarClock, ClipboardCheck, FileText, Smartphone } from 'lucide-react'
import {
  HAZARDOUS_WASTE_CALENDAR,
  HAZARDOUS_WASTE_DOCUMENT_PACKETS,
  HAZARDOUS_WASTE_FIELD_CHECKS,
} from '@soteria/core/hazardousWaste'

const criticalChecks = HAZARDOUS_WASTE_FIELD_CHECKS.filter(check => check.critical).length

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
        <Link
          href="#expo-field"
          className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 transition hover:border-amber-400 hover:bg-amber-50/40 dark:hover:bg-amber-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <ClipboardCheck className="h-5 w-5" />
            <h2 className="text-sm font-semibold">Field Checks</h2>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{HAZARDOUS_WASTE_FIELD_CHECKS.length}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{criticalChecks} critical checks bundled for offline use in Expo.</p>
        </Link>
        <Link
          href="#record-packets"
          className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 transition hover:border-sky-400 hover:bg-sky-50/40 dark:hover:bg-sky-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <div className="flex items-center gap-2 text-sky-700 dark:text-sky-300">
            <FileText className="h-5 w-5" />
            <h2 className="text-sm font-semibold">Document Packets</h2>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{HAZARDOUS_WASTE_DOCUMENT_PACKETS.length}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Manifest, Site ID, Biennial, CERS, and inspection binder preparation.</p>
        </Link>
        <Link
          href="#calendar-foundation"
          className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 transition hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <CalendarClock className="h-5 w-5" />
            <h2 className="text-sm font-semibold">Calendar Rules</h2>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{HAZARDOUS_WASTE_CALENDAR.length}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Federal, California, CERS/CUPA, manifest, and inspection reminders.</p>
        </Link>
      </section>

      <section id="expo-field" className="scroll-mt-20 rounded-lg border border-slate-200 dark:border-slate-800 p-5">
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
        <div id="record-packets" className="scroll-mt-20">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            Record Packets
          </h2>
          <div className="space-y-2">
            {HAZARDOUS_WASTE_DOCUMENT_PACKETS.map(packet => (
              <Link
                key={packet.id}
                href="/manuals/hazardous-waste"
                className="block rounded-lg border border-slate-200 dark:border-slate-800 p-4 transition hover:border-sky-400 hover:bg-sky-50/40 dark:hover:bg-sky-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{packet.title}</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{packet.systemOutput}</p>
              </Link>
            ))}
          </div>
        </div>
        <div id="calendar-foundation" className="scroll-mt-20">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            Calendar Foundation
          </h2>
          <div className="space-y-2">
            {HAZARDOUS_WASTE_CALENDAR.map(item => (
              <Link
                key={item.id}
                href="/manuals/hazardous-waste"
                className="block rounded-lg border border-slate-200 dark:border-slate-800 p-4 transition hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.dueRule}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
