import type { ReactNode } from 'react'
import ModuleGuard from '@/components/ModuleGuard'

export default function HotWorkLayout({ children }: { children: ReactNode }) {
  return <ModuleGuard moduleId="hot-work">{children}</ModuleGuard>
}
