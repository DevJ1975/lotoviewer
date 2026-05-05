// /risk/new — Hazard-ID wizard host. Mounts the client-side
// RiskWizard component which holds all form state internally.

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import RiskWizard from '../_components/RiskWizard'

export default function NewRiskPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <header>
        <Link
          href="/risk"
          className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
        >
          <ArrowLeft className="h-3 w-3" /> Heat map
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
          New risk
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          ISO 45001 6.1 hazard identification → risk evaluation → control selection.
          The wizard captures inherent + residual scoring and applies the Hierarchy of Controls.
        </p>
      </header>

      <RiskWizard />
    </main>
  )
}
