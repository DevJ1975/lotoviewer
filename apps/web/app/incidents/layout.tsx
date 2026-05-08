import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function IncidentsLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="incidents">
      <ModuleHeaderAccent moduleId="incidents" />
      {children}
    </ModuleGuard>
  )
}
