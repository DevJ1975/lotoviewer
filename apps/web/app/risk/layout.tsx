import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'

// Module gate for /risk/* routes. Until the heat map ships in Slice 2,
// the risk-assessment feature is comingSoon:true in the FEATURES
// catalog (so the drawer hides it + the per-tenant landing resolver
// doesn't count it). The ModuleGuard renders the "module not enabled"
// screen for any direct URL navigation. Slice 2 flips comingSoon to
// false on `risk-assessment` + `risk-heatmap` and the route becomes
// reachable.
//
// RLS independently blocks any risk-table reads from a tenant that
// doesn't have the data — this guard is the UX layer.
export default function RiskLayout({ children }: { children: ReactNode }) {
  return <ModuleGuard moduleId="risk-assessment">{children}</ModuleGuard>
}
