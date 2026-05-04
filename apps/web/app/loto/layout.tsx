import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'

// Module gate for /loto/* routes. If the active tenant has the LOTO module
// disabled in tenants.modules, every /loto/* page renders the "not enabled"
// screen instead. RLS independently blocks any LOTO row reads from a
// tenant that doesn't have the data — this guard is the UX layer.
export default function LotoLayout({ children }: { children: ReactNode }) {
  return <ModuleGuard moduleId="loto">{children}</ModuleGuard>
}
