'use client'

import Link from 'next/link'
import { ArrowRight, LayoutGrid } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { PanelEyebrow } from '@/components/DashboardPanel'
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

  // Not a DashboardPanel: the whole card is one link, so it takes the
  // system's interactive-placard treatment rather than a panel header.
  return (
    <section className="placard-surface placard-surface-interactive p-5">
      <Link href={MATRIX_HREF} className="group flex items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow">
          <LayoutGrid className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <PanelEyebrow>Administration · Compliance</PanelEyebrow>
          <h2 className="stencil-title mt-1 text-base text-slate-950 dark:text-slate-50">
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
