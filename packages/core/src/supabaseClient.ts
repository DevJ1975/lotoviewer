import type { SupabaseClient } from '@supabase/supabase-js'

// Active-client registry. Each app calls setActiveSupabaseClient()
// once at boot (typically inside its own apps/{web,mobile}/lib/
// supabase.ts module-load) to register the platform-instantiated
// client. Shared business logic in @soteria/core then calls
// getActiveSupabaseClient() at query time.
//
// Why a registry rather than dependency injection: the existing
// callers (`loadEquipment()`, `fetchHomeMetrics()`, …) are zero-arg
// functions invoked from 22+ web app pages. Threading a
// SupabaseClient parameter through every call site to keep the
// modules side-effect-free isn't worth the churn for the immediate
// goal (one mobile app + one web app, both with a single client
// per process).
//
// Why this is safe even though the client is a Proxy with lazy
// init: setActiveSupabaseClient(supabase) just stores the Proxy
// reference. The Proxy still defers actual createClient() to first
// property access, so SSR / static-prerender paths that import
// the registry but never query stay zero-cost.

let _client: SupabaseClient | null = null

export function setActiveSupabaseClient(client: SupabaseClient): void {
  _client = client
}

export function getActiveSupabaseClient(): SupabaseClient {
  if (!_client) {
    throw new Error(
      '@soteria/core: no Supabase client registered. ' +
      'Each app must import its own apps/<app>/lib/supabase.ts ' +
      'before calling any function that touches the database — ' +
      'that import calls setActiveSupabaseClient() as a side effect.',
    )
  }
  return _client
}

// Test-only escape hatch. Exposed for test setup files that want
// to install a mock client; not intended for production use.
export function _resetActiveSupabaseClient(): void {
  _client = null
}

// Convenience Proxy so shared modules can keep writing
// `supabase.from(...)` instead of `getActiveSupabaseClient().from(...)`
// at every call site. The Proxy resolves the active client on each
// property access, so a hot-swap (e.g. a test installing a mock
// mid-suite) takes effect on the next call.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getActiveSupabaseClient(), prop, receiver)
  },
})
