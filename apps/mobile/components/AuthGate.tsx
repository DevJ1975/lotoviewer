import { useRouter, useSegments } from 'expo-router'
import { useEffect, type ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useAuth } from './AuthProvider'

// Routes that render WITHOUT an authenticated session.
// Mirror of apps/web/components/AuthGate.tsx PUBLIC_PATHS — adding
// to this set is the SINGLE place to mark a route public.
const PUBLIC_SEGMENTS = new Set<string>(['login', 'forgot-password'])

// Client-side auth gate. Expo Router exposes the active path as a
// segment array (e.g. ['(tabs)', 'index'] or ['login']); we look at
// the FIRST segment to decide if the current route is public.
//
// Why useSegments + useEffect instead of a server middleware: same
// reason the web app uses AuthGate — Supabase persists the session
// in SecureStore, which is only available client-side. SSR is not in
// play on native anyway.
export default function AuthGate({ children }: { children: ReactNode }) {
  const router   = useRouter()
  const segments = useSegments()
  const { userId, loading } = useAuth()

  const firstSegment = segments[0] ?? ''
  const isPublic = PUBLIC_SEGMENTS.has(firstSegment)

  useEffect(() => {
    if (loading) return
    if (!userId && !isPublic) {
      router.replace('/login')
      return
    }
    if (userId && isPublic) {
      // Already signed in; bounce away from /login.
      router.replace('/(tabs)')
    }
  }, [loading, userId, isPublic, router])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  // While a redirect is in flight to /login, don't flash protected UI.
  if (!userId && !isPublic) return null

  return <>{children}</>
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
