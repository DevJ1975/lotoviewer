'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTenant } from '@/components/TenantProvider'
import { resolveLandingPath } from '@/lib/landing'
import OpsSpinner from '@/components/OpsSpinner'
import MultiModuleDashboard from './_components/MultiModuleDashboard'

// Home dispatcher. Visited as `/` after every sign-in.
//
// Decides between:
//   - Redirecting to a tenant-specific landing path (single-module
//     tenants like Snak King → /loto, or any tenant with an
//     explicit settings.default_landing_path override).
//   - Rendering the existing multi-module dashboard.
//
// The resolution is in lib/landing.ts so it's pure-function testable.
// We just call it here and act on the result.
//
// Escape hatch: `?dashboard=1` bypasses the redirect, so an admin on a
// single-module tenant can still see the multi-module view if they
// want it. The drawer's footer can link to /?dashboard=1 in a follow-up.

export default function HomePage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <HomeDispatcher />
    </Suspense>
  )
}

function HomeDispatcher() {
  const { tenant, loading } = useTenant()
  const router   = useRouter()
  const pathname = usePathname()
  const search   = useSearchParams()
  const forceDashboard = search.get('dashboard') === '1'

  // Compute every render — cheap pure function. Memoization would
  // complicate the loop-guard below for marginal benefit.
  const target = forceDashboard ? null : resolveLandingPath(tenant)

  // Loop guard: if a misconfigured override resolves to '/' we'd
  // redirect-to-self forever. Defensive null when target equals the
  // current path.
  const safeTarget = target && target !== pathname ? target : null

  useEffect(() => {
    if (loading) return
    if (!safeTarget) return
    router.replace(safeTarget)
  }, [loading, safeTarget, router])

  if (loading) return <FullPageSpinner />
  // Don't paint the dashboard while a redirect is in flight; renders
  // null so the next module's chrome takes over without a flash.
  if (safeTarget) return null
  return <MultiModuleDashboard />
}

function FullPageSpinner() {
  return <OpsSpinner size="lg" fullPage label="Routing" />
}
