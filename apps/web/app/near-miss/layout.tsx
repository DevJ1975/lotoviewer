import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function NearMissLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="near-miss">
      <ModuleHeaderAccent moduleId="near-miss" />
      {children}
    </ModuleGuard>
  )
}
