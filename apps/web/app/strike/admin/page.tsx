'use client'

import { Loader2, ShieldAlert, Zap } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { useStrikeAdminData } from '@/components/strike/admin/useStrikeAdminData'
import { LibraryTab } from '@/components/strike/admin/LibraryTab'
import { CurriculaTab } from '@/components/strike/admin/CurriculaTab'
import { TriggersTab } from '@/components/strike/admin/TriggersTab'
import { ComplianceTab } from '@/components/strike/admin/ComplianceTab'
import { LmsSyncTab } from '@/components/strike/admin/LmsSyncTab'

// STRIKE admin console: assign from the library, schedule curricula, set
// what work requires training, see who is current, and connect an LMS.
export default function StrikeAdminPage() {
  const { tenantId, role } = useTenant()
  const { userId, profile } = useAuth()
  const canManage = role === 'owner' || role === 'admin' || !!profile?.is_superadmin
  const { data, loading, error, reload } = useStrikeAdminData(canManage ? tenantId : null)

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <PageHeader
        icon={Zap}
        eyebrow="STRIKE microlearning"
        title="Training admin"
        description="Assign library modules, schedule curricula, decide what work requires training, track who is current, and sync records to your LMS."
        back="/strike"
      />

      {!canManage ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Only tenant owners and admins can manage training.
        </div>
      ) : loading && data.modules.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label="Loading" /></div>
      ) : error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>
      ) : tenantId && (
        <Tabs defaultSelectedKey="library">
          <TabsList aria-label="Training admin sections">
            <TabsTab id="library">Library</TabsTab>
            <TabsTab id="schedule">Schedule</TabsTab>
            <TabsTab id="triggers">Required for work</TabsTab>
            <TabsTab id="compliance">Compliance</TabsTab>
            <TabsTab id="lms">LMS sync</TabsTab>
          </TabsList>
          <TabsPanel id="library"><LibraryTab tenantId={tenantId} userId={userId} data={data} onChanged={reload} /></TabsPanel>
          <TabsPanel id="schedule"><CurriculaTab tenantId={tenantId} userId={userId} data={data} onChanged={reload} /></TabsPanel>
          <TabsPanel id="triggers"><TriggersTab tenantId={tenantId} userId={userId} data={data} onChanged={reload} /></TabsPanel>
          <TabsPanel id="compliance"><ComplianceTab tenantId={tenantId} data={data} /></TabsPanel>
          <TabsPanel id="lms"><LmsSyncTab tenantId={tenantId} /></TabsPanel>
        </Tabs>
      )}
    </main>
  )
}
