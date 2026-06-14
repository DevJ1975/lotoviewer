import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function Em385Layout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="em385">
      <ModuleHeaderAccent moduleId="em385" />
      {children}
    </ModuleGuard>
  )
}
