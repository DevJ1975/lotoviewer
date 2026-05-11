import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function EquipmentReadinessLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="equipment-readiness">
      <ModuleHeaderAccent moduleId="equipment-readiness" />
      {children}
    </ModuleGuard>
  )
}
