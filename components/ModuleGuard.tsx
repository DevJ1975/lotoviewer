'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@/lib/moduleVisibility'
import { getFeature } from '@/lib/features'

// Wraps a module's pages so direct URL navigation to a tenant-disabled
// module shows a friendly "not available" screen instead of a half-rendered
// page. RLS prevents data leakage at the DB layer; this guard is the UX
// confirmation that the route shouldn't be reachable at all.
//
// Loading behavior: while TenantProvider is fetching, render children
// optimistically. The page may flash briefly but RLS still protects data,
// and the guard re-renders correctly once tenant resolves. Better than
// flashing a spinner for every route load.

interface Props {
  moduleId: string
  children: ReactNode
}

export default function ModuleGuard({ moduleId, children }: Props) {
  const { tenant, loading } = useTenant()

  // Don't gate while loading — RLS handles data isolation and the guard
  // re-renders with the correct decision once the tenant row arrives.
  if (loading || !tenant) return <>{children}</>

  if (isModuleVisible(moduleId, tenant.modules)) return <>{children}</>

  const feature = getFeature(moduleId)
  const moduleName = feature?.name ?? moduleId

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-4 opacity-30" aria-hidden="true">⊘</div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
          {moduleName} isn&apos;t enabled for {tenant.name}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          This module is part of Soteria Field but isn&apos;t turned on for
          tenant <span className="font-mono">#{tenant.tenant_number}</span>.
          Contact your administrator if you need access.
        </p>
        <Link
          href="/"
          className="inline-flex items-center px-4 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
