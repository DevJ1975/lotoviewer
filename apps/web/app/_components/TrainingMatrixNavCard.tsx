'use client'

import Link from 'next/link'
import { ArrowRight, LayoutGrid } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'

// Home-dashboard discoverability card for the Training & Competency Matrix.
//
// Deliberately a pure navigation affordance — it performs NO data read. The
// matrix view (v_training_matrix) only exists once migration 240 is applied,
// so querying it here would surface a raw schema error on the home page for
// any environment that hasn't migrated yet. The card only links to the
// matrix; the page itself owns its loading and error states.
//
// Gated to admins on tenants where the matrix module is visible. A non-admin,
// or a tenant that has switched the module off, sees nothing.

const MATRIX_HREF = '/admin/people/training-competency-matrix'

export default function TrainingMatrixNavCard() {
  const { profile } = useAuth()
  const { tenant, loading: tenantLoading } = useTenant()

  const visible = isModuleVisible('admin-training-competency-matrix', tenant?.modules)
  if (tenantLoading || !profile?.is_admin || !visible) return null

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
      <Link href={MATRIX_HREF} className="group flex items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow">
          <LayoutGrid className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Administration · Compliance
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Training &amp; Competency Matrix
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Required training by worker and course, with expiry status and per-position requirements.
          </p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 dark:text-slate-500" />
      </Link>
    </section>
  )
}
