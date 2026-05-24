import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Cross-platform Supabase client factory.
//
// The browser and React Native both want a Supabase client, but the
// underlying primitives differ:
//   - Browser: auth tokens live in localStorage; tenant id lives in
//     sessionStorage; `fetch` is global.
//   - RN: auth tokens live in expo-secure-store; tenant id lives in
//     expo-secure-store too (no per-tab session); `fetch` is global
//     but needs `react-native-url-polyfill` shimmed first.
//
// Each app supplies the platform-specific bits via the
// SupabaseAdapter passed to createSupabaseClient(). The cross-cutting
// concerns — x-active-tenant header injection, lazy client init,
// malformed-uuid detection — live here once.

export const ACTIVE_TENANT_KEY = 'soteria.activeTenantId'
export const ACTIVE_FACILITY_KEY = 'soteria.activeFacilityId'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Persistent key/value storage for Supabase auth tokens. The browser
 * supplies an adapter backed by localStorage; native supplies one
 * backed by expo-secure-store.
 */
export interface AuthStorageAdapter {
  getItem(key: string): Promise<string | null> | string | null
  setItem(key: string, value: string): Promise<void> | void
  removeItem(key: string): Promise<void> | void
}

/**
 * Synchronous read of the active tenant id, called fresh on every
 * Supabase request so a tenant switch takes effect on the next query
 * without recreating the client.
 *
 * Sync-only because the global fetch wrapper can't await.
 */
export type ActiveTenantReader = () => string | null

/**
 * Synchronous read of the active facility id, called fresh on every
 * Supabase request so a facility switch takes effect on the next query.
 *
 * Returns null for the roll-up view (no x-active-facility header sent =>
 * RLS shows every facility in the active tenant).
 */
export type ActiveFacilityReader = () => string | null

export interface SupabaseAdapter {
  /** NEXT_PUBLIC_SUPABASE_URL or app.json equivalent. */
  url: string
  /** NEXT_PUBLIC_SUPABASE_ANON_KEY or app.json equivalent. */
  anonKey: string
  /** Where Supabase persists the auth session. */
  authStorage: AuthStorageAdapter
  /** Whether to auto-detect the recovery token in URL hash (web only). */
  detectSessionInUrl?: boolean
  /** Reads the active tenant id used for the x-active-tenant header. */
  readActiveTenant: ActiveTenantReader
  /**
   * Reads the active facility id used for the x-active-facility header.
   * Optional: when omitted (or it returns null) no header is sent and RLS
   * falls back to the tenant-wide roll-up view.
   */
  readActiveFacility?: ActiveFacilityReader
  /** One-time hook called when sessionStorage holds a malformed value. */
  onMalformedTenant?: (raw: string) => void
}

export function createSupabaseClient(adapter: SupabaseAdapter): SupabaseClient {
  let warnedAboutMalformed = false

  function readTenantSafely(): string | null {
    const raw = adapter.readActiveTenant()
    if (raw === null || raw === '') return null
    if (!UUID_RE.test(raw)) {
      if (!warnedAboutMalformed) {
        warnedAboutMalformed = true
        adapter.onMalformedTenant?.(raw)
      }
      return null
    }
    return raw
  }

  // Facility id is best-effort: a malformed value is simply ignored
  // (falls back to the roll-up view) rather than warned about, since the
  // facility header is optional and a bad value should never block a query.
  function readFacilitySafely(): string | null {
    const raw = adapter.readActiveFacility?.()
    if (!raw || !UUID_RE.test(raw)) return null
    return raw
  }

  return createClient(adapter.url, adapter.anonKey, {
    auth: {
      storage: adapter.authStorage as never,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: adapter.detectSessionInUrl ?? false,
    },
    global: {
      // Inject x-active-tenant (+ x-active-facility) on every PostgREST +
      // Storage request. Both are read fresh per request so a tenant or
      // facility switch takes effect on the next query without recreating
      // the client.
      fetch: (input, init) => {
        const tenantId   = readTenantSafely()
        const facilityId = readFacilitySafely()
        if (!tenantId && !facilityId) return fetch(input as RequestInfo, init)
        const headers = new Headers(init?.headers ?? {})
        if (tenantId)   headers.set('x-active-tenant', tenantId)
        if (facilityId) headers.set('x-active-facility', facilityId)
        return fetch(input as RequestInfo, { ...init, headers })
      },
    },
  })
}
