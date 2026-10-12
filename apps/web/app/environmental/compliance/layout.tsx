import type { ReactNode } from 'react'
import { EnvironmentalTabs } from '@/components/environmental/context'

// Frames every page of the environmental compliance suite with its navigation.
// The module guard and header accent come from the parent /environmental layout.
export default function ComplianceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <EnvironmentalTabs />
      {children}
    </div>
  )
}
