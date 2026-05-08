import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function ChemicalsLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="chemicals">
      <ModuleHeaderAccent moduleId="chemicals" />
      {children}
    </ModuleGuard>
  )
}
