import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase, setActiveTenant, getCachedActiveTenant } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import type { Tenant, TenantRole } from '@soteria/core/types'

// Mobile mirror of apps/web/components/TenantProvider.tsx, simplified
// for the v1 MVP:
//   - No superadmin "external tenant" cache (superadmin tools stay
//     web-only per the plan).
//   - No B3 forced sign-out (the membership-disappeared edge case is
//     rare enough that v1 just falls back to the first available
//     membership and lets the user keep working).
//   - SecureStore replaces sessionStorage for the active id; same
//     ACTIVE_TENANT_KEY string so future cross-app tooling (deep
//     link from web to mobile, etc.) can rely on a single key name.

interface TenantState {
  tenantId:     string | null
  tenant:       Tenant | null
  role:         TenantRole | null
  available:    Array<Tenant & { role: TenantRole }>
  loading:      boolean
  switchTenant: (id: string) => Promise<void>
  refresh:      () => Promise<void>
}

const Ctx = createContext<TenantState>({
  tenantId:     null,
  tenant:       null,
  role:         null,
  available:    [],
  loading:      true,
  switchTenant: async () => {},
  refresh:      async () => {},
})

export function TenantProvider({ children }: { children: ReactNode }) {
  const { userId, loading: authLoading } = useAuth()

  const [available, setAvailable] = useState<Array<Tenant & { role: TenantRole }>>([])
  const [tenantId,  setTenantIdState] = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)

  const fetchAll = useCallback(async (uid: string) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tenant_memberships')
      .select('role, tenants(*)')
      .eq('user_id', uid)
    if (error) {
      console.error('[tenant] memberships fetch error', error)
      setAvailable([])
      setTenantIdState(null)
      await setActiveTenant(null)
      setLoading(false)
      return
    }
    type Row = { role: TenantRole; tenants: Tenant | null }
    const rows = (data ?? []) as unknown as Row[]
    const list = rows
      .filter(r => r.tenants && !r.tenants.disabled_at)
      .map(r => ({ ...(r.tenants as Tenant), role: r.role }))
    setAvailable(list)

    // Pick the active tenant. The cached id was hydrated into memory
    // by AuthProvider's boot path (hydrateActiveTenant) before this
    // fetch ran, so the synchronous read in supabase.ts already had
    // the right header for the memberships query above.
    const stored      = readStoredTenantId()
    const inMember    = stored ? list.find(t => t.id === stored) : null
    const pick        = inMember ?? list[0] ?? null

    setTenantIdState(pick?.id ?? null)
    if (pick && pick.id !== stored) await setActiveTenant(pick.id)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!userId) {
      setAvailable([])
      setTenantIdState(null)
      setLoading(false)
      return
    }
    void fetchAll(userId)
  }, [userId, authLoading, fetchAll])

  const switchTenant = useCallback(async (id: string) => {
    await setActiveTenant(id)
    setTenantIdState(id)
    // No page reload on native — the supabase fetch wrapper reads the
    // tenant id fresh on every request, so the next query already
    // carries the new x-active-tenant header. Consumers re-fetch via
    // their own useEffect deps (keyed on tenantId).
  }, [])

  const refresh = useCallback(async () => {
    if (userId) await fetchAll(userId)
  }, [userId, fetchAll])

  const tenant = useMemo(() => available.find(t => t.id === tenantId) ?? null, [available, tenantId])
  const role   = tenant?.role ?? null

  const value = useMemo<TenantState>(() => ({
    tenantId,
    tenant,
    role,
    available,
    loading,
    switchTenant,
    refresh,
  }), [tenantId, tenant, role, available, loading, switchTenant, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTenant(): TenantState {
  return useContext(Ctx)
}

function readStoredTenantId(): string | null {
  return getCachedActiveTenant()
}
