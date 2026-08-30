import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function EnvironmentalLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="environmental">
      <ModuleHeaderAccent moduleId="environmental" />
      {children}
    </ModuleGuard>
  )
}
