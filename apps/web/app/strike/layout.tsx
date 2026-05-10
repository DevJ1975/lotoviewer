import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function StrikeLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="strike">
      <ModuleHeaderAccent moduleId="strike" />
      {children}
    </ModuleGuard>
  )
}
