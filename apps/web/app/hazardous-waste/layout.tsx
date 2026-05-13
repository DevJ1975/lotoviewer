import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'
import ModuleHeaderAccent from '@/components/ModuleHeaderAccent'

export default function HazardousWasteLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="hazardous-waste">
      <ModuleHeaderAccent moduleId="hazardous-waste" />
      {children}
    </ModuleGuard>
  )
}
