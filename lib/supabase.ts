import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy-initialized client. The previous version called createClient() at
// module-load time, which dragged Supabase's URL validation into every
// client page's first-paint cost AND into Next's static-prerender pass
// for pages that never actually talk to Supabase (e.g. /_not-found) —
// causing the build to fail the moment env vars were missing.
//
// With the Proxy, module load just defines the handle. The real client
// is constructed on the first property access, and cached. Real usage
// paths (supabase.from(), supabase.auth.getSession(), etc.) look and
// behave identically.
//
// TODO: once `npm run db:types` has been run and lib/database.types.ts
// has the generated schema, swap the client to:
//
//   import type { Database } from '@/lib/database.types'
//   ...
//   cached = createClient<Database>(url, anon)
//
// This narrows every supabase.from(...) result so the inline `as Foo[]`
// casts in app pages can be deleted. We don't do it preemptively
// because the placeholder Database = empty interface gives no narrowing
// and would make the types feel "broken" without delivering value.
let cached: SupabaseClient | null = null

// Single, browser-readable key for the active tenant. Written by
// TenantProvider on mount + on switch; read by the fetch wrapper below
// on every PostgREST/Storage call.
//
// PostgREST forwards request headers into Postgres via current_setting
// ('request.headers'), where RLS policies can read them. Migration 032
// adds active_tenant_id() that reads x-active-tenant and an updated set
// of policies that scope by it (when set) on top of the existing
// "is member or superadmin" check. Net effect: superadmin's "active
// tenant" filters reads/writes server-side, without us touching every
// .from('loto_*') call site.
export const ACTIVE_TENANT_KEY = 'soteria.activeTenantId'

function readActiveTenant(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage.getItem(ACTIVE_TENANT_KEY) } catch { return null }
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
  cached = createClient(url, anon, {
    global: {
      // Inject x-active-tenant on every PostgREST + Storage request from
      // the browser. The header is read fresh per request from
      // sessionStorage, so a tenant switch takes effect on the next
      // query without needing to recreate the client.
      fetch: (input, init) => {
        const tenantId = readActiveTenant()
        if (!tenantId) return fetch(input as RequestInfo, init)
        const headers = new Headers(init?.headers ?? {})
        headers.set('x-active-tenant', tenantId)
        return fetch(input as RequestInfo, { ...init, headers })
      },
    },
  })
  return cached
}

// Proxy that forwards every property access to the real client.
// `supabase.from(...)` works exactly as before; the only behavior change
// is that missing env vars throw at first use instead of at module load.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver)
  },
})
