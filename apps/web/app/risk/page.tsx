// /risk — Risk Assessment landing page placeholder for Slice 1.
//
// The DB schema, audit log, scoring engine, and module-shell route
// are live as of slice 1, but the user-facing heat map view doesn't
// land until slice 2. While that's true, the ModuleGuard wrapper in
// layout.tsx + the comingSoon:true flag on the FEATURES catalog
// prevent this route from being reachable in production — but if
// someone wires it up in a preview env or sets the tenants.modules
// flag explicitly, this is what they see.

import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'

export default function RiskLandingPlaceholder() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center space-y-5">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-navy/10 text-brand-navy text-xs font-semibold">
        <ShieldAlert className="h-3.5 w-3.5" /> Risk Assessment · Coming soon
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
        ISO 45001 6.1 Risk Register
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        The schema and scoring engine for the Risk Assessment module
        are in place. The 5×5 heat map, hazard-identification wizard,
        and Hierarchy of Controls selector are arriving in the next
        slice.
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Standards alignment: ISO 45001:2018 · Cal/OSHA Title 8 §3203 · OSHA 29 CFR 1910
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-brand-navy dark:text-brand-yellow hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to home
      </Link>
    </main>
  )
}
