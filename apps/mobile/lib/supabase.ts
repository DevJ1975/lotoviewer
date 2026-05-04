import 'react-native-url-polyfill/auto'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACTIVE_TENANT_KEY,
  createSupabaseClient,
  type AuthStorageAdapter,
} from '@soteria/core/supabase'
import { setActiveSupabaseClient } from '@soteria/core/supabaseClient'

// Native (Expo) instantiation of the shared Supabase client factory.
// The cross-cutting bits (x-active-tenant injection, malformed-uuid
// detection) live in @soteria/core/supabase; this file only supplies
// the platform-specific adapters.
//
// Storage:
// - Auth tokens → expo-secure-store (Keychain on iOS, EncryptedSharedPreferences
//   on Android). NEVER use AsyncStorage for auth — it's plaintext.
// - Active tenant id → also expo-secure-store, since RN has no
//   sessionStorage equivalent and the value is mildly sensitive
//   (a tenant id leaks org membership inference).

export { ACTIVE_TENANT_KEY }

// expo-secure-store keys must be alphanumeric + dot/dash/underscore.
// Our 'soteria.activeTenantId' satisfies that. The Supabase auth key
// is normally 'sb-<project-ref>-auth-token' which also satisfies it.

const secureStoreAdapter: AuthStorageAdapter = {
  getItem:    (key) => SecureStore.getItemAsync(key),
  setItem:    (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
}

let cachedActiveTenant: string | null = null

// Sync read of the active tenant — Supabase's fetch wrapper can't
// await. We hydrate `cachedActiveTenant` once at startup via
// hydrateActiveTenant() (called from the auth gate) and write through
// on every setActiveTenant().
//
// Exported (as `getCachedActiveTenant`) so TenantProvider can resume
// the last-active tenant on app boot without a second SecureStore
// round-trip.
function readActiveTenantSync(): string | null {
  return cachedActiveTenant
}

export function getCachedActiveTenant(): string | null {
  return cachedActiveTenant
}

export async function hydrateActiveTenant(): Promise<void> {
  cachedActiveTenant = await SecureStore.getItemAsync(ACTIVE_TENANT_KEY)
}

export async function setActiveTenant(tenantId: string | null): Promise<void> {
  cachedActiveTenant = tenantId
  if (tenantId) {
    await SecureStore.setItemAsync(ACTIVE_TENANT_KEY, tenantId)
  } else {
    await SecureStore.deleteItemAsync(ACTIVE_TENANT_KEY)
  }
}

function readEnv(): { url: string; anonKey: string } {
  // Expo exposes app.json `extra` and process.env (when using the
  // `expo-constants` shim) — we look in both so this works under
  // EAS Build, Expo Go, and dev. The web app uses NEXT_PUBLIC_*; we
  // accept either name to make it possible to share the same .env.
  const extras = Constants.expoConfig?.extra ?? {}
  const url =
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    (extras as Record<string, string>).supabaseUrl
  const anonKey =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    (extras as Record<string, string>).supabaseAnonKey
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env missing. Set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY (or app.json extras.supabaseUrl/' +
      'supabaseAnonKey) before booting the app.',
    )
  }
  return { url, anonKey }
}

let cached: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (cached) return cached
  const { url, anonKey } = readEnv()
  cached = createSupabaseClient({
    url,
    anonKey,
    authStorage: secureStoreAdapter,
    // No URL-hash recovery flow on native — the password-reset deep
    // link will hand off to /reset-password via expo-linking instead.
    detectSessionInUrl: false,
    readActiveTenant: readActiveTenantSync,
    onMalformedTenant: raw => {
      console.warn('[supabase] Malformed active-tenant in SecureStore, ignoring:', raw)
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
// time. Same pattern as apps/web/lib/supabase.ts.
setActiveSupabaseClient(supabase)
