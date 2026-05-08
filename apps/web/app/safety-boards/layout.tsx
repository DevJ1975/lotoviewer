import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function SafetyBoardsLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="safety-boards">
      <ModuleHeaderAccent moduleId="safety-boards" />
      {children}
    </ModuleGuard>
  )
}
