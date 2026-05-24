'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase, ACTIVE_FACILITY_KEY } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import type { Facility } from '@soteria/core/types'

// Active facility for the signed-in user, WITHIN the active tenant. Mounted
// under TenantProvider (app/layout.tsx) so the active tenant is known.
//
// The active facility is injected as the x-active-facility header by the
// Supabase fetch wrapper (lib/supabase.ts); migration 201's RLS scopes domain
// rows by it. A NULL active facility = the roll-up view (all of the tenant's
// facilities). See FacilityProvider's sibling TenantProvider.tsx for a deeper
// walk-through of the Context / useCallback / useMemo patterns reused here.
//
// switchFacility(id | null) writes sessionStorage and full-reloads the page —
// the same B1 fix TenantProvider uses for tenant switches: a hard reload drops
// in-flight requests carrying the old x-active-facility header so a slow query
// can't return after the switch and render data labelled as the new facility.

interface FacilityState {
  // null = "All facilities" (the tenant-wide roll-up view).
  facilityId:     string | null
  // The active facility row, or null in roll-up mode.
  facility:       Facility | null
  // Every facility in the active tenant (for the picker).
  available:      Facility[]
  loading:        boolean
  switchFacility: (id: string | null) => void
  refresh:        () => Promise<void>
}

const Ctx = createContext<FacilityState>({
  facilityId:     null,
  facility:       null,
  available:      [],
  loading:        true,
  switchFacility: () => {},
  refresh:        async () => {},
})

function readStoredFacilityId(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage.getItem(ACTIVE_FACILITY_KEY) } catch { return null }
}

function writeStoredFacilityId(facilityId: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (facilityId) window.sessionStorage.setItem(ACTIVE_FACILITY_KEY, facilityId)
    else            window.sessionStorage.removeItem(ACTIVE_FACILITY_KEY)
  } catch { /* sessionStorage may be blocked — non-fatal */ }
}

export function FacilityProvider({ children }: { children: ReactNode }) {
  const { tenantId, loading: tenantLoading } = useTenant()

  const [available,  setAvailable]  = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)

  const fetchAll = useCallback(async (activeTenantId: string) => {
    setLoading(true)
    // RLS scopes facilities to the active tenant (migration 199). The
    // explicit tenant filter is belt-and-suspenders, matching the rest of
    // the app's query style.
    const { data, error } = await supabase
      .from('facilities')
      .select('*')
      .eq('tenant_id', activeTenantId)
      .order('is_primary', { ascending: false })
      .order('name',       { ascending: true })

    if (error) {
      console.error('[facility] fetch error', error)
      setAvailable([])
      setFacilityId(null)
      setLoading(false)
      return
    }

    const list = (data ?? []) as Facility[]
    setAvailable(list)

    // Pick the active facility:
    //   1. stored id, if it belongs to THIS tenant's facilities (resumes
    //      the user's last choice; also rejects a facility left over from a
    //      previously-active tenant)
    //   2. else the single facility, if the tenant has exactly one (so
    //      single-facility tenants never sit in roll-up and record creation
    //      is never blocked)
    //   3. else null = roll-up (the combined view is a sensible default for
    //      a multi-facility tenant)
    const stored      = readStoredFacilityId()
    const storedValid = stored ? list.find(f => f.id === stored) : null

    let pick: string | null
    if (storedValid)            pick = storedValid.id
    else if (list.length === 1) pick = list[0]!.id
    else                        pick = null

    setFacilityId(pick)
    if (pick !== stored) writeStoredFacilityId(pick)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (tenantLoading) return
    if (!tenantId) {
      setAvailable([])
      setFacilityId(null)
      setLoading(false)
      return
    }
    void fetchAll(tenantId)
  }, [tenantId, tenantLoading, fetchAll])

  const switchFacility = useCallback((id: string | null) => {
    // Reject anything not in the current tenant's facilities (a stray
    // sessionStorage write or programmatic call can't pin the user to a
    // facility outside their tenant). null (roll-up) is always allowed.
    if (id !== null && !available.some(f => f.id === id)) {
      console.warn('[facility] refusing to switch — not a facility of the active tenant', id)
      return
    }
    writeStoredFacilityId(id)
    if (typeof window !== 'undefined') {
      window.location.reload()
    } else {
      setFacilityId(id)
    }
  }, [available])

  const refresh = useCallback(async () => {
    if (tenantId) await fetchAll(tenantId)
  }, [tenantId, fetchAll])

  const facility = useMemo(
    () => available.find(f => f.id === facilityId) ?? null,
    [available, facilityId],
  )

  const value = useMemo<FacilityState>(() => ({
    facilityId,
    facility,
    available,
    loading,
    switchFacility,
    refresh,
  }), [facilityId, facility, available, loading, switchFacility, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFacility() { return useContext(Ctx) }
