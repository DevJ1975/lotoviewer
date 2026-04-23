'use client'

import { Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import { reconcileEquipment, type RealtimePayload } from '@/lib/equipmentReconcile'
import DashboardSidebar     from '@/components/dashboard/DashboardSidebar'
import EquipmentListPanel   from '@/components/dashboard/EquipmentListPanel'
import PlacardDetailPanel   from '@/components/dashboard/PlacardDetailPanel'
import BatchPrintModal      from '@/components/BatchPrintModal'
import { DashboardSkeleton } from '@/components/Skeleton'
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

  // iPads suspend backgrounded tabs aggressively — when the user comes back,
  // the realtime channel may have missed events. A single refetch on
  // visibility return guarantees the dashboard is up to date.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') fetchData()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchData])

  const selectedEquipment = useMemo(
    () => equipment.find(e => e.equipment_id === selectedEqId) ?? null,
    [equipment, selectedEqId],
  )

  // Hold searchParams in a ref so setUrlState can be useCallback-stable
  // across renders. Without this, selection callbacks allocated a new
  // reference on every realtime tick (which updates `equipment` and re-runs
  // HomeDashboard) — blowing up the memoization inside EquipmentListPanel
  // and forcing every row to re-render on every DB change.
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams

  const setUrlState = useCallback((next: { dept?: string | null; eq?: string | null }) => {
    const params = new URLSearchParams(searchParamsRef.current.toString())
    if (next.dept === null) params.delete('dept')
    else if (next.dept)     params.set('dept', next.dept)
    if (next.eq === null)   params.delete('eq')
    else if (next.eq)       params.set('eq', next.eq)
    const qs = params.toString()
    router.replace(qs ? `/?${qs}` : '/')
  }, [router])

  // Pending auto-advance timer — held in a ref so we can cancel it whenever
  // the user takes a manual action (selecting a different item, switching
  // departments, or unmounting). Without this, an in-flight timer would
  // bump the user away from a screen they just chose.
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPendingAdvance = useCallback(() => {
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); advanceTimer.current = null }
  }, [])
  useEffect(() => () => cancelPendingAdvance(), [cancelPendingAdvance])

  const handleSelectDept = useCallback((dept: string | null) => {
    cancelPendingAdvance()
    setUrlState({ dept, eq: null })
  }, [cancelPendingAdvance, setUrlState])

  const handleSelectEquip = useCallback((id: string) => {
    cancelPendingAdvance()
    recordVisit(id)
    setUrlState({ eq: id })
  }, [cancelPendingAdvance, recordVisit, setUrlState])

  const handleEquipmentAdded = useCallback((row: Equipment) => {
    setEquipment(prev =>
      [...prev, row].sort((a, b) => a.equipment_id.localeCompare(b.equipment_id)),
    )
  }, [])

  const openBatch = useCallback(() => setBatchOpen(true), [])

  // After a photo save, if the currently selected equipment no longer needs
  // a photo (both required slots filled), auto-advance to the next needs-
  // photo item in the active view after a brief pause so the user sees the
  // success indicator. Cancels itself if the user navigates manually.
  const handlePhotoSaved = useCallback((type: 'equip' | 'iso') => {
    if (!selectedEqId) return
    const current = equipment.find(e => e.equipment_id === selectedEqId)
    if (!current) return

    // Optimistically mark the photo as present so the "still needs photo"
    // check below is accurate before realtime catches up.
    const after = {
      ...current,
      has_equip_photo: type === 'equip' ? true : current.has_equip_photo,
      has_iso_photo:   type === 'iso'   ? true : current.has_iso_photo,
    }
    const stillNeedsEquip = after.needs_equip_photo && !after.has_equip_photo
    const stillNeedsIso   = after.needs_iso_photo   && !after.has_iso_photo
    if (stillNeedsEquip || stillNeedsIso) return

    // Find the next item in this dept (or globally if none selected) that
    // still needs a photo and isn't decommissioned.
    const scope = selectedDept
      ? equipment.filter(e => e.department === selectedDept)
      : equipment
    const sorted = [...scope].sort((a, b) => a.equipment_id.localeCompare(b.equipment_id))
    const idx = sorted.findIndex(e => e.equipment_id === selectedEqId)
    const rotated = idx >= 0 ? [...sorted.slice(idx + 1), ...sorted.slice(0, idx)] : sorted
    const nextNeedsPhoto = rotated.find(e =>
      !decommissioned.has(e.equipment_id)
      && ((e.needs_equip_photo && !e.has_equip_photo) || (e.needs_iso_photo && !e.has_iso_photo)),
    )
    if (!nextNeedsPhoto) return

    cancelPendingAdvance()
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null
      handleSelectEquip(nextNeedsPhoto.equipment_id)
    }, 1200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEqId, selectedDept, equipment, decommissioned, cancelPendingAdvance])

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

  if (loading) return <DashboardSkeleton />

  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-6rem)]">
      <DashboardSidebar
        equipment={equipment}
        selectedDept={selectedDept}
        selectedEqId={selectedEqId}
        onSelectDept={handleSelectDept}
        onSelectEquip={handleSelectEquip}
        onBatchPrint={openBatch}
        decommissioned={decommissioned}
        onEquipmentAdded={handleEquipmentAdded}
      />
      <EquipmentListPanel
        equipment={equipment}
        selectedDept={selectedDept}
        selectedEqId={selectedEqId}
        onSelectEquip={handleSelectEquip}
        decommissioned={decommissioned}
      />
      <PlacardDetailPanel equipment={selectedEquipment} onPhotoSaved={handlePhotoSaved} />

      <BatchPrintModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        equipment={equipment}
        initialDepartment={selectedDept}
      />
    </div>
  )
}
