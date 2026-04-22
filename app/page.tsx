'use client'

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import { reconcileEquipment, type RealtimePayload } from '@/lib/equipmentReconcile'
import DashboardSidebar     from '@/components/dashboard/DashboardSidebar'
import EquipmentListPanel   from '@/components/dashboard/EquipmentListPanel'
import PlacardDetailPanel   from '@/components/dashboard/PlacardDetailPanel'
import BatchPrintModal      from '@/components/BatchPrintModal'
import { useSession } from '@/components/SessionProvider'

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[calc(100vh-6rem)]">
        <div className="w-10 h-10 border-4 border-brand-navy border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <HomeDashboard />
    </Suspense>
  )
}

function HomeDashboard() {
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)

  // Derived from the `decommissioned` column on loto_equipment.
  // Consumed by the sidebar (for per-department totals), the list (to hide retired rows),
  // and the status report / CSV export (to exclude them from counts).
  const decommissioned = useMemo(
    () => new Set(equipment.filter(e => e.decommissioned).map(e => e.equipment_id)),
    [equipment],
  )

  const router        = useRouter()
  const searchParams  = useSearchParams()
  const selectedDept  = searchParams.get('dept')
  const selectedEqId  = searchParams.get('eq')
  const { recordVisit } = useSession()

  const fetchData = useCallback(async () => {
    const { data, error } = await supabase
      .from('loto_equipment')
      .select('*')
      .order('equipment_id', { ascending: true })
    if (error) {
      setLoadError(true)
    } else if (data) {
      setEquipment(data as Equipment[])
      setLoadError(false)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()

    // Reconcile realtime events in-memory instead of refetching the whole
    // table on every change — matters once equipment count grows past a few
    // hundred rows. DELETE/INSERT payloads carry the full row; UPDATE carries
    // the new record. Order is preserved by equipment_id on insert.
    const channel = supabase
      .channel('loto_equipment_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loto_equipment' },
        (payload: RealtimePayload) => {
          setEquipment((prev: Equipment[]) => reconcileEquipment(prev, payload))
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  const selectedEquipment = useMemo(
    () => equipment.find(e => e.equipment_id === selectedEqId) ?? null,
    [equipment, selectedEqId],
  )

  function setUrlState(next: { dept?: string | null; eq?: string | null }) {
    const params = new URLSearchParams(searchParams.toString())
    if (next.dept === null) params.delete('dept')
    else if (next.dept)     params.set('dept', next.dept)
    if (next.eq === null)   params.delete('eq')
    else if (next.eq)       params.set('eq', next.eq)
    const qs = params.toString()
    router.replace(qs ? `/?${qs}` : '/')
  }

  const handleSelectDept  = (dept: string | null) => setUrlState({ dept, eq: null })
  const handleSelectEquip = (id: string) => {
    recordVisit(id)
    setUrlState({ eq: id })
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-6rem)]">
        <div className="text-center px-6 max-w-sm">
          <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center text-2xl mx-auto mb-3">⚠</div>
          <p className="text-sm font-semibold text-slate-700 mb-1">Could not load equipment</p>
          <p className="text-xs text-slate-400 mb-4">Please check your connection and try again.</p>
          <button
            type="button"
            onClick={() => { setLoading(true); setLoadError(false); fetchData() }}
            className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-6rem)]">
        <div className="w-10 h-10 border-4 border-brand-navy border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-6rem)]">
      <DashboardSidebar
        equipment={equipment}
        selectedDept={selectedDept}
        selectedEqId={selectedEqId}
        onSelectDept={handleSelectDept}
        onSelectEquip={handleSelectEquip}
        onBatchPrint={() => setBatchOpen(true)}
        decommissioned={decommissioned}
        onEquipmentAdded={row =>
          setEquipment(prev =>
            [...prev, row].sort((a, b) => a.equipment_id.localeCompare(b.equipment_id)),
          )
        }
      />
      <EquipmentListPanel
        equipment={equipment}
        selectedDept={selectedDept}
        selectedEqId={selectedEqId}
        onSelectEquip={handleSelectEquip}
        decommissioned={decommissioned}
      />
      <PlacardDetailPanel equipment={selectedEquipment} />

      <BatchPrintModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        equipment={equipment}
        initialDepartment={selectedDept}
      />
    </div>
  )
}
