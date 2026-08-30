import Link from 'next/link'
import { ArrowLeft, ArrowRight, ClipboardList, Eye, QrCode, type LucideIcon } from 'lucide-react'

// /admin/observations/bbs — index for the "BBS observations" admin tile.
//
// lib/adminCatalog.ts advertises this exact URL (every tile lives at
// /admin/<section>/<slug>) and promises three things: observation
// locations, QR codes, and the leading-indicator dashboard. Those three
// surfaces shipped; the index that gathers them did not, so both routes
// into it — the "BBS observations" tile on /admin, and the legacy
// /admin/bbs 301 from getAdminRedirects() — hit a Next.js 404.
//
// No auth gate here on purpose: this page holds links, not data.
// AuthGate already keeps non-admins out of /admin/*, and each
// destination enforces its own role check. Same call the other
// link-only admin pages (the module manuals) make.

interface Destination {
  href:  string
  icon:  LucideIcon
  title: string
  desc:  string
}

const DESTINATIONS: Destination[] = [
  {
    href:  '/admin/observations/bbs/dashboard',
    icon:  Eye,
    title: 'Leading indicators',
    desc:  'Safe-to-unsafe ratio, the 30-day mini-funnel, and follow-ups still due.',
  },
  {
    href:  '/bbs/qr',
    icon:  QrCode,
    title: 'Locations & QR codes',
    desc:  'Add observation locations, print their QR signs, rotate or retire a token.',
  },
  {
    href:  '/bbs',
    icon:  ClipboardList,
    title: 'Observation log',
    desc:  'Every unsafe act, unsafe condition, and safe behavior, with triage and close-out.',
  },
]

export default function BbsObservationsAdminPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-xs text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
        >
          <ArrowLeft className="h-3 w-3" /> Administration
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
          <Eye className="h-6 w-6 text-brand-navy" />
          BBS observations
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Behavior-Based Safety administration: where observations come from,
          and what the program is telling you.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DESTINATIONS.map(destination => (
          <li key={destination.href}>
            <DestinationLink destination={destination} />
          </li>
        ))}
      </ul>
    </main>
  )
}

function DestinationLink({ destination }: { destination: Destination }) {
  const Icon = destination.icon
  return (
    <Link
      href={destination.href}
      className="placard-surface placard-surface-interactive group block h-full p-5"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-navy dark:text-brand-yellow" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {destination.title}
            </h2>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-brand-navy dark:text-slate-600 dark:group-hover:text-brand-yellow" />
          </div>
          <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {destination.desc}
          </p>
        </div>
      </div>
    </Link>
  )
}
