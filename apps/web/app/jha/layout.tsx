import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function JhaLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="jha">
      <ModuleHeaderAccent moduleId="jha" />
      {children}
    </ModuleGuard>
  )
}
