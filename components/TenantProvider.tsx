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
import { supabase } from '@/lib/supabase'
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

const STORAGE_KEY_PREFIX = 'soteria.activeTenantId.'

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

function storageKey(userId: string) { return STORAGE_KEY_PREFIX + userId }

function readStoredTenantId(userId: string): string | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage.getItem(storageKey(userId)) } catch { return null }
}

function writeStoredTenantId(userId: string, tenantId: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (tenantId) window.sessionStorage.setItem(storageKey(userId), tenantId)
    else          window.sessionStorage.removeItem(storageKey(userId))
  } catch { /* sessionStorage may be blocked — non-fatal */ }
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { userId, loading: authLoading } = useAuth()

  const [available, setAvailable]   = useState<Array<Tenant & { role: TenantRole }>>([])
  const [tenantId,  setTenantId]    = useState<string | null>(null)
  const [loading,   setLoading]     = useState(true)

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

    // Pick the active tenant: stored choice if still valid, else first.
    const stored = readStoredTenantId(uid)
    const pick = list.find(t => t.id === stored) ?? list[0] ?? null
    setTenantId(pick?.id ?? null)
    if (pick && pick.id !== stored) writeStoredTenantId(uid, pick.id)
    setLoading(false)
  }, [])

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
    if (!available.some(t => t.id === id)) {
      console.warn('[tenant] switchTenant called with non-member tenant', id)
      return
    }
    writeStoredTenantId(userId, id)
    setTenantId(id)
  }, [userId, available])

  const refresh = useCallback(async () => {
    if (userId) await fetchAll(userId)
  }, [userId, fetchAll])

  const tenant = useMemo(
    () => available.find(t => t.id === tenantId) ?? null,
    [available, tenantId],
  )
  const role = tenant?.role ?? null

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
