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
let cached: SupabaseClient | null = null

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
  cached = createClient(url, anon)
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
