import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACTIVE_TENANT_KEY,
  createSupabaseClient,
  type AuthStorageAdapter,
} from '@soteria/core/supabase'
import { setActiveSupabaseClient } from '@soteria/core/supabaseClient'

// Browser instantiation of the shared Supabase client factory in
// @soteria/core. The cross-cutting bits (x-active-tenant injection,
// malformed-uuid detection) live in core; this file only supplies
// the browser-specific adapters.
//
// Re-exports ACTIVE_TENANT_KEY so existing call sites that read /
// write sessionStorage directly keep working without code changes.

export { ACTIVE_TENANT_KEY }

// Lazy-initialized: the previous version constructed the client at
// module-load time, which dragged URL validation into Next's static
// prerender pass for pages that never use Supabase. The Proxy below
// defers construction until first property access.
let cached: SupabaseClient | null = null

function browserAuthStorage(): AuthStorageAdapter {
  // Supabase auth wants localStorage so the session survives across
  // tabs and reloads. SSR-safe fallback returns no-ops if window is
  // undefined (hydration phase).
  return {
    getItem(key) {
      if (typeof window === 'undefined') return null
      try { return window.localStorage.getItem(key) } catch { return null }
    },
    setItem(key, value) {
      if (typeof window === 'undefined') return
      try { window.localStorage.setItem(key, value) } catch { /* quota / private mode */ }
    },
    removeItem(key) {
      if (typeof window === 'undefined') return
      try { window.localStorage.removeItem(key) } catch { /* ignore */ }
    },
  }
}

function readActiveTenant(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(ACTIVE_TENANT_KEY)
  } catch { return null }
}

function getClient(): SupabaseClient {
  if (cached) return cached
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error(
      'Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). ' +
      'Set them in .env.local for local dev and in the Vercel project settings for deploys.',
    )
  }
  cached = createSupabaseClient({
    url,
    anonKey: anon,
    authStorage: browserAuthStorage(),
    // Supabase reads the recovery token out of `window.location.hash`
    // when this is true. We rely on it for the /reset-password flow.
    detectSessionInUrl: true,
    readActiveTenant,
    onMalformedTenant: raw => {
      console.warn('[supabase] Malformed active-tenant in sessionStorage, ignoring:', raw)
    },
  })
  return cached
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver)
  },
})

// Register the proxy with @soteria/core so shared business logic
// (queries, metrics) can call getActiveSupabaseClient() at query
// time. Storing the proxy is cheap and preserves lazy init — the
// real createClient() call is still deferred to first property
// access.
setActiveSupabaseClient(supabase)
