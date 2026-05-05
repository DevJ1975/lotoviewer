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
import type { Tenant, TenantRole } from '@soteria/core/types'

// Active tenant state for the signed-in user. Mounted under AuthProvider in
// app/layout.tsx so userId is available; refetches whenever userId changes.
//
// ── React patterns used here (worth understanding) ──────────────────────────
//
// 1. CONTEXT (createContext + Provider)
//    `Ctx` is a Context object. Its <Provider value={...}> wraps the
//    whole app, and `useTenant()` (defined at the bottom) lets ANY
//    descendant read the current value without prop-drilling. Every
//    time `value` is a different object reference, all consumers
//    re-render — that's why we wrap `value` in useMemo below.
//
// 2. CALLBACK STABILITY (useCallback)
//    `fetchAll` and `switchTenant` are wrapped in useCallback so their
//    function identity stays the same across renders unless their deps
//    change. Important because: a) they go into useMemo's value below
//    so consumers don't re-render unnecessarily, and b) any consumer
//    that uses them as a useEffect dep won't fire that effect on
//    every render.
//
// 3. STATE (useState)
//    Three pieces of state: `available` (memberships), `tenantId`
//    (active id), `loading` (bool). Splitting state finely gives you
//    finer re-render control than one big object.
//
// 4. EFFECTS (useEffect)
//    The `useEffect(..., [userId, authLoading, fetchAll])` runs the
//    fetch whenever the user logs in/out OR when fetchAll is rebuilt.
//    Listing the deps honestly is non-negotiable — eslint's
//    `react-hooks/exhaustive-deps` will warn if you miss one.
//
// 5. REFS (useRef) — see UndoToast.tsx for a deeper dive
//    Not used here directly but the pattern is referenced: refs are
//    for non-render data (timer handles, "did this commit fire yet").
//    NEVER read or write a ref's `.current` during render — it bypasses
//    React's update cycle.
//
// ── Tenant selection rules ──────────────────────────────────────────────────
//   1. If sessionStorage has a tenant_id AND the user has membership in it,
//      use it (resumes the user's last active tenant).
//   2. Else, the user's first membership row (most users have only one).
//   3. If the user has zero memberships, tenant is null. AuthGate /
//      first-run flow handles redirecting them.
//   4. SUPERADMIN special case: stored tenant doesn't have to be a
//      membership — header-scoped RLS in migration 032 still lets them
//      see/edit. We lazy-fetch the tenant row via the `externalTenant`
//      cache below.
//
// switchTenant(id) updates sessionStorage and full-reloads the page (B1
// fix — drops in-flight requests carrying the old x-active-tenant
// header so a slow query can't return after the switch and render
// data labelled as the new tenant).

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
//
// LEARN: Reading sessionStorage outside React's state means the value
// can drift from what React thinks it is. We always pair a
// sessionStorage write with a setTenantId state update so React + storage
// stay in sync. If you only updated storage, components wouldn't
// re-render until something else triggered a render.
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

  // LEARN: This useMemo is THE most important hook in the file.
  //
  // Without it, every render creates a new `value` object. React's
  // <Ctx.Provider> uses Object.is() to decide whether the value
  // changed; a new object every time means EVERY consumer re-renders
  // on every render of TenantProvider — including all the tenant-
  // scoped pages which can be expensive.
  //
  // The deps array lists every value referenced in the object literal.
  // If you add a new field (e.g. `currentRole`), you MUST add it here
  // too OR consumers won't see updates to it. The eslint plugin
  // `react-hooks/exhaustive-deps` enforces this.
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

// LEARN: A custom hook is just a function that calls other hooks.
// Convention: name starts with `use`. Wrapping useContext like this
// gives consumers a single import (`useTenant`) instead of two
// (`useContext` + the Context object), and lets us swap the underlying
// implementation later without touching call sites.
export function useTenant() { return useContext(Ctx) }
