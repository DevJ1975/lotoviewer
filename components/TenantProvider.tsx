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
import { supabase, ACTIVE_TENANT_KEY } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import type { Tenant, TenantRole } from '@/lib/types'

// Active tenant state for the signed-in user. Mounted under AuthProvider in
// app/layout.tsx so userId is available; refetches whenever userId changes.
//
// Tenant selection rules:
//   1. If sessionStorage has a tenant_id AND the user has membership in it,
//      use it.
//   2. Else, the user's first membership row (most users have only one).
//   3. If the user has zero memberships, tenant is null. AuthGate /
//      first-run flow handles redirecting them.
//
// switchTenant(id) updates sessionStorage and refetches the active tenant
// row (so modules / logo / name re-render). The sessionStorage key is
// scoped to userId so different users on the same browser don't pick up
// each other's last-active tenant.

interface TenantState {
  tenantId:       string | null
  tenant:         Tenant | null
  role:           TenantRole | null
  // All tenants the user is a member of, joined onto the membership row's
  // role. Used by the tenant switcher dropdown.
  available:      Array<Tenant & { role: TenantRole }>
  loading:        boolean
  switchTenant:   (id: string) => void
  refresh:        () => Promise<void>
}

const Ctx = createContext<TenantState>({
  tenantId:     null,
  tenant:       null,
  role:         null,
  available:    [],
  loading:      true,
  switchTenant: () => {},
  refresh:      async () => {},
})

// Single sessionStorage key for the active tenant. Also read by the
// fetch wrapper in lib/supabase.ts which forwards it as the
// x-active-tenant header so RLS can scope the result.
function readStoredTenantId(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage.getItem(ACTIVE_TENANT_KEY) } catch { return null }
}

function writeStoredTenantId(tenantId: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (tenantId) window.sessionStorage.setItem(ACTIVE_TENANT_KEY, tenantId)
    else          window.sessionStorage.removeItem(ACTIVE_TENANT_KEY)
  } catch { /* sessionStorage may be blocked — non-fatal */ }
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { userId, profile, loading: authLoading } = useAuth()
  const isSuperadmin = profile?.is_superadmin === true

  const [available,    setAvailable]    = useState<Array<Tenant & { role: TenantRole }>>([])
  const [tenantId,     setTenantId]     = useState<string | null>(null)
  // Cache for superadmin's "switched to a non-member tenant" case. The
  // pill needs the tenant row to render; if the active id isn't in
  // `available`, we lazily fetch and stash it here.
  const [externalTenant, setExternalTenant] = useState<Tenant | null>(null)
  const [loading,      setLoading]      = useState(true)

  const fetchAll = useCallback(async (uid: string) => {
    setLoading(true)
    // RLS limits this to the caller's own memberships + the tenants they
    // belong to. Single round-trip via the embedded join.
    const { data, error } = await supabase
      .from('tenant_memberships')
      .select('role, tenants(*)')
      .eq('user_id', uid)
    if (error) {
      console.error('[tenant] memberships fetch error', error)
      setAvailable([])
      setTenantId(null)
      setLoading(false)
      return
    }
    type Row = { role: TenantRole; tenants: Tenant | null }
    const rows = (data ?? []) as unknown as Row[]
    const list = rows
      .filter(r => r.tenants && !r.tenants.disabled_at)
      .map(r => ({ ...(r.tenants as Tenant), role: r.role }))
    setAvailable(list)

    // Pick the active tenant. Three cases:
    //   - stored is in the user's memberships → use it
    //   - stored is set but NOT in memberships AND user is superadmin →
    //     keep it (the lazy externalTenant fetch will resolve the row)
    //   - stored is set but NOT in memberships AND user is NOT superadmin →
    //     fall back to first membership (or null)
    const stored = readStoredTenantId()
    const inMembership = stored ? list.find(t => t.id === stored) : null
    const keepStoredForSuperadmin = stored && !inMembership && isSuperadmin

    let pick: { id: string } | null
    if (inMembership)               pick = inMembership
    else if (keepStoredForSuperadmin) pick = { id: stored }
    else                            pick = list[0] ?? null

    setTenantId(pick?.id ?? null)
    if (pick && pick.id !== stored) writeStoredTenantId(pick.id)
    setLoading(false)

    // B3: only fires when a NON-superadmin had a previously-active
    // tenant that disappeared from their memberships (disabled or
    // member-removed). Superadmin's cross-tenant view is handled by
    // the keepStoredForSuperadmin branch above.
    if (
      !isSuperadmin
      && stored
      && !inMembership
      && list.length > 0
    ) {
      console.warn('[tenant] previously-active tenant is no longer available — signing out')
      if (typeof window !== 'undefined') {
        // window.alert is intentional — a toast would race with the
        // forced sign-out + redirect. Replace with a proper modal once
        // the app has a global toast surface.
        alert('Your access to that tenant has been changed. Signing you out.')
        await supabase.auth.signOut()
        window.location.href = '/login'
      }
    }
  }, [isSuperadmin])

  useEffect(() => {
    if (authLoading) return
    if (!userId) {
      setAvailable([])
      setTenantId(null)
      setLoading(false)
      return
    }
    fetchAll(userId)
  }, [userId, authLoading, fetchAll])

  const switchTenant = useCallback((id: string) => {
    if (!userId) return
    // Allow superadmin to switch to a tenant they're not a member of —
    // header-scoped RLS in migration 032 grants the cross-tenant view.
    // For non-superadmins this still falls through with a warning since
    // RLS would reject their reads anyway.
    writeStoredTenantId(id)
    // B1: hard reload after writing the new active tenant. This drops
    // any in-flight requests carrying the old x-active-tenant header
    // so a slow query can't return after the switch and render data
    // labelled as the new tenant. Heavy-handed UX (one extra page
    // load) but avoids per-component request-id plumbing across the
    // ~150 .from('loto_*') call sites. Quiet no-op in SSR.
    if (typeof window !== 'undefined') {
      window.location.reload()
    } else {
      setTenantId(id)
    }
  }, [userId])

  const refresh = useCallback(async () => {
    if (userId) await fetchAll(userId)
  }, [userId, fetchAll])

  // Active tenant resolution order:
  //   1. The user's own membership row (preserves their role)
  //   2. The externalTenant cache (superadmin viewing a non-member tenant)
  //   3. null
  const tenant = useMemo(() => {
    const fromMembership = available.find(t => t.id === tenantId)
    if (fromMembership) return fromMembership
    if (externalTenant && externalTenant.id === tenantId) {
      return { ...externalTenant, role: null as unknown as TenantRole }
    }
    return null
  }, [available, tenantId, externalTenant])

  // Lazy-fetch a tenant row when the active id isn't in `available`.
  // Only superadmin can read it (RLS); non-superadmins just stay with
  // tenant=null which the rest of the app treats as signed-out.
  useEffect(() => {
    if (!tenantId) { setExternalTenant(null); return }
    if (available.some(t => t.id === tenantId)) { setExternalTenant(null); return }
    if (externalTenant?.id === tenantId) return
    void supabase
      .from('tenants').select('*').eq('id', tenantId).maybeSingle()
      .then(({ data }) => { if (data) setExternalTenant(data as Tenant) })
  }, [tenantId, available, externalTenant])

  const role = (tenant && 'role' in tenant ? tenant.role : null) as TenantRole | null

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

export function useTenant() { return useContext(Ctx) }
