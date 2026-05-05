'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { getFeature } from '@soteria/core/features'

// Wraps a module's pages so direct URL navigation to a tenant-disabled
// module shows a friendly "not available" screen instead of a half-rendered
// page. RLS prevents data leakage at the DB layer; this guard is the UX
// confirmation that the route shouldn't be reachable at all.
//
// LEARN: This component is a textbook "render-prop wrapper":
//   - Takes children + a small config (moduleId)
//   - Decides whether to render those children OR replacement UI
//   - Owns NO state of its own — it just reads from useTenant()
//
// REACT 101: A component that returns `<>{children}</>` is "transparent"
// — its parent's layout flows through unchanged. That's why this can
// be dropped into any module's layout.tsx without breaking anything.
//
// LOADING BEHAVIOR (worth understanding):
//   While TenantProvider is fetching, we render children optimistically.
//   Why not show a spinner? Two reasons:
//     1. RLS still protects data even if the guard hasn't decided yet
//        — the user can't see another tenant's rows just because the
//        guard hasn't rendered.
//     2. Flashing a spinner on EVERY route load (because the provider
//        always loads briefly) feels janky. The trade-off is: in the
//        rare case where the guard would have blocked, the page
//        renders for ~50ms then swaps to the "not enabled" screen.
//
// RECOMMENDATION TO FUTURE-YOU: if the brief flash becomes a problem
// (e.g. for very expensive child renders), add a `loadingFallback` prop
// that lets the caller choose what to show during the loading window.
// Don't change the default — the optimistic render is the correct
// trade-off for cheap renders.

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
