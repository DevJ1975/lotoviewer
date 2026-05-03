import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'

export default function ConfinedSpacesLayout({ children }: { children: ReactNode }) {
  return <ModuleGuard moduleId="confined-spaces">{children}</ModuleGuard>
}
