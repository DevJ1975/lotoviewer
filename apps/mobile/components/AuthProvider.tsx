import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import { hydrateActiveTenant, supabase } from '@/lib/supabase'

// Mobile mirror of apps/web/components/AuthProvider.tsx. Same shape,
// platform-specific token + tenant-id storage swapped in via the
// supabase client in @/lib/supabase.
//
// Boot sequence:
//   1. hydrateActiveTenant() — load the cached tenant id from
//      SecureStore into memory so the very first Supabase request
//      can attach the x-active-tenant header.
//   2. supabase.auth.getSession() — surface the persisted session if
//      one exists (this is also what unblocks the AuthGate).
//   3. supabase.auth.onAuthStateChange() — keep userId in sync as
//      sign-in / sign-out / token-refresh events fire.

interface ProfileLite {
  id:             string
  is_admin:       boolean | null
  is_superadmin:  boolean | null
}

interface AuthContextValue {
  userId:    string | null
  session:   Session | null
  profile:   ProfileLite | null
  loading:   boolean
  signIn:    (email: string, password: string) => Promise<{ error: string | null }>
  signOut:   () => Promise<void>
}

const Ctx = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileLite | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadProfile(uid: string) {
      const { data } = await supabase
        .from('profiles')
        .select('id, is_admin, is_superadmin')
        .eq('id', uid)
        .maybeSingle()
      if (!cancelled) setProfile((data as ProfileLite | null) ?? null)
    }

    async function boot() {
      // Hydrate tenant id BEFORE the first Supabase call so the
      // x-active-tenant header is attached from the very first
      // PostgREST request. Otherwise the first /loto_equipment query
      // after a cold boot would go out unscoped.
      await hydrateActiveTenant()
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      setSession(session)
      if (session?.user?.id) await loadProfile(session.user.id)
      setLoading(false)
    }
    void boot()

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, sess: Session | null) => {
        if (cancelled) return
        setSession(sess)
        if (sess?.user?.id) void loadProfile(sess.user.id)
        else setProfile(null)
      },
    )
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email:    email.trim(),
      password,
    })
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    userId: session?.user?.id ?? null,
    session,
    profile,
    loading,
    signIn,
    signOut,
  }), [session, profile, loading, signIn, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be called inside <AuthProvider>')
  return ctx
}
