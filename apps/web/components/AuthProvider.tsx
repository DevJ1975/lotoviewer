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
import type { Profile } from '@soteria/core/types'

interface AuthState {
  userId:      string | null
  email:       string | null
  profile:     Profile | null
  loading:     boolean
  signIn:      (email: string, password: string) => Promise<{ error: string | null }>
  signOut:     () => Promise<void>
  refresh:     () => Promise<void>
  setProfile:  (p: Profile) => void
}

const Ctx = createContext<AuthState>({
  userId:     null,
  email:      null,
  profile:    null,
  loading:    true,
  signIn:     async () => ({ error: 'not ready' }),
  signOut:    async () => {},
  refresh:    async () => {},
  setProfile: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId]   = useState<string | null>(null)
  const [email, setEmail]     = useState<string | null>(null)
  const [profile, setProfileState] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle()
    // Log failure modes explicitly — silent profile fetch failures have
    // caused multiple "why is the admin menu hidden?" incidents.
    if (error) {
      console.error('[auth] profile fetch error', error)
    } else if (!data) {
      console.warn('[auth] no profile row for user', uid, '— admin/first-login flows will not fire')
    }
    setProfileState((data ?? null) as Profile | null)
  }, [])

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setUserId(uid)
    setEmail(session?.user?.email ?? null)
    if (uid) await fetchProfile(uid)
    else setProfileState(null)
    setLoading(false)
  }, [fetchProfile])

  useEffect(() => {
    refresh()
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null
      setUserId(uid)
      setEmail(session?.user?.email ?? null)
      if (uid) fetchProfile(uid)
      else setProfileState(null)
    })
    return () => { data.subscription.unsubscribe() }
  }, [refresh, fetchProfile])

  const signIn = useCallback(async (emailArg: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: emailArg, password })
    if (error) return { error: error.message }
    await refresh()
    return { error: null }
  }, [refresh])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUserId(null)
    setEmail(null)
    setProfileState(null)
  }, [])

  const setProfile = useCallback((p: Profile) => setProfileState(p), [])

  const value = useMemo<AuthState>(() => ({
    userId, email, profile, loading, signIn, signOut, refresh, setProfile,
  }), [userId, email, profile, loading, signIn, signOut, refresh, setProfile])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() { return useContext(Ctx) }
