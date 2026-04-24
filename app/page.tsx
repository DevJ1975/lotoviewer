'use client'

import { Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import { reconcileEquipment, type RealtimePayload } from '@/lib/equipmentReconcile'
import { needsPhoto } from '@/lib/photoStatus'
import DashboardSidebar     from '@/components/dashboard/DashboardSidebar'
import EquipmentListPanel   from '@/components/dashboard/EquipmentListPanel'
import PlacardDetailPanel   from '@/components/dashboard/PlacardDetailPanel'
import BatchPrintModal      from '@/components/BatchPrintModal'
import { DashboardSkeleton } from '@/components/Skeleton'
import { useSession } from '@/components/SessionProvider'

// ── Perf: narrow SELECT for the dashboard list ────────────────────────────
// The sidebar + list + reconciliation only need these columns. `notes`,
// `notes_es`, and `internal_notes` are potentially multi-kB per row; dropping
// them here cuts the initial payload roughly in half at 700+ rows. The detail
// panel re-fetches the full row (with notes) when the user selects an item.
const LIST_COLUMNS = [
  'equipment_id', 'description', 'department', 'prefix',
  'photo_status',
  'has_equip_photo', 'has_iso_photo',
  'equip_photo_url', 'iso_photo_url',
  'placard_url', 'signed_placard_url',
  'needs_equip_photo', 'needs_iso_photo', 'needs_verification',
  'verified', 'verified_date', 'verified_by',
  'decommissioned', 'spanish_reviewed',
  'created_at', 'updated_at',
].join(', ')

// Fill in the columns we didn't fetch so the Equipment type is satisfied.
// Detail views re-fetch the full row — these nulls are placeholders, not
// authoritative data.
function fromListRow(row: Record<string, unknown>): Equipment {
  return {
    ...(row as unknown as Equipment),
    notes:          null,
    notes_es:       null,
    internal_notes: null,
  }
}

// ── Perf: stale-while-revalidate cache ────────────────────────────────────
// iPads reload the PWA often; this lets the dashboard paint instantly from
// the last fresh snapshot while a background fetch reconciles any drift.
const CACHE_KEY = 'loto:equip-list:v1'

function readCache(): Equipment[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: number; rows?: Equipment[] }
    return Array.isArray(parsed.rows) ? parsed.rows : null
  } catch { return null }
}

function writeCache(rows: Equipment[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), rows }))
  } catch { /* quota / private mode — non-fatal */ }
}

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
      .select(LIST_COLUMNS)
      .order('equipment_id', { ascending: true })
    if (error) {
      setLoadError(true)
    } else if (data) {
      const rows = (data as unknown as Record<string, unknown>[]).map(fromListRow)
      setEquipment(rows)
      writeCache(rows)
      setLoadError(false)
    }
    setLoading(false)
  }, [])

  // Hydrate from localStorage synchronously on mount so the first paint
  // shows the last-known data instantly while the network request flies.
  // Running this in useEffect (not useState initializer) avoids SSR
  // hydration mismatches — server renders empty, client hydrates empty,
  // then we swap in the cache.
  useEffect(() => {
    const cached = readCache()
    if (cached && cached.length > 0) {
      setEquipment(cached)
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounce realtime events with requestAnimationFrame. A CSV import or
  // bulk update can fire dozens of postgres_changes events in a burst —
  // running reconcile + re-render per event spikes the UI. Coalescing into
  // one update per frame keeps scroll and input responsive.
  const pendingPayloads = useRef<RealtimePayload[]>([])
  const rafHandle       = useRef<number | null>(null)
  const flushPending    = useCallback(() => {
    rafHandle.current = null
    const pending = pendingPayloads.current
    pendingPayloads.current = []
    if (pending.length === 0) return
    setEquipment((prev: Equipment[]) => pending.reduce(reconcileEquipment, prev))
  }, [])

  useEffect(() => {
    fetchData()

    // Reconcile realtime events in-memory instead of refetching the whole
    // table on every change — matters once equipment count grows past a few
    // hundred rows. DELETE/INSERT payloads carry the full row; UPDATE carries
    // the new record.
    const channel = supabase
      .channel('loto_equipment_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loto_equipment' },
        (payload: RealtimePayload) => {
          pendingPayloads.current.push(payload)
          if (rafHandle.current == null) {
            rafHandle.current = requestAnimationFrame(flushPending)
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (rafHandle.current != null) {
        cancelAnimationFrame(rafHandle.current)
        rafHandle.current = null
      }
      pendingPayloads.current = []
    }
  }, [fetchData, flushPending])

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

    // "Does the current row still need a photo after this save?" Uses URL
    // presence for the slot we didn't just save (to stay consistent with
    // computePhotoStatusFromEquipment) and optimistic `true` for the slot
    // we did (URL hasn't landed from the hook yet).
    const afterHasEquip = type === 'equip' ? true : Boolean(current.equip_photo_url?.trim())
    const afterHasIso   = type === 'iso'   ? true : Boolean(current.iso_photo_url?.trim())
    const stillNeedsEquip = current.needs_equip_photo && !afterHasEquip
    const stillNeedsIso   = current.needs_iso_photo   && !afterHasIso
    if (stillNeedsEquip || stillNeedsIso) return

    // Find the next item in this dept (or globally if none selected) that
    // still needs a photo and isn't decommissioned. URL presence matches
    // the list-panel's "Needs Photo" filter — same invariant.
    const scope = selectedDept
      ? equipment.filter(e => e.department === selectedDept)
      : equipment
    const sorted = [...scope].sort((a, b) => a.equipment_id.localeCompare(b.equipment_id))
    const idx = sorted.findIndex(e => e.equipment_id === selectedEqId)
    const rotated = idx >= 0 ? [...sorted.slice(idx + 1), ...sorted.slice(0, idx)] : sorted
    const nextNeedsPhoto = rotated.find(e =>
      !decommissioned.has(e.equipment_id) && needsPhoto(e),
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
