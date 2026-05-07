import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'

// Module gate for /toolbox-talks/* routes. The toolbox-talks feature
// in the FEATURES catalog is enabled by default; per-tenant disable
// flips the flag in tenants.modules. RLS independently scopes any
// reads, so this guard is the UX confirmation that direct URL nav
// to a disabled module renders the friendly "not enabled" screen.
export default function ToolboxTalksLayout({ children }: { children: ReactNode }) {
  return <ModuleGuard moduleId="toolbox-talks">{children}</ModuleGuard>
}
