import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function HotWorkLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="hot-work">
      <ModuleHeaderAccent moduleId="hot-work" />
      {children}
    </ModuleGuard>
  )
}
