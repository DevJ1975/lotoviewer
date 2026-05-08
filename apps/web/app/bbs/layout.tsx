import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function BBSLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="bbs">
      <ModuleHeaderAccent moduleId="bbs" />
      {children}
    </ModuleGuard>
  )
}
