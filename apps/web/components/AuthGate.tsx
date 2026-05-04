'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'

// Routes that should render WITHOUT requiring an authenticated session.
//
// LEARN: Adding to this set is the SINGLE place to allow a route to be
// reachable when signed-out. /forgot-password lets the user request a
// reset link without logging in; /reset-password handles the magic
// link from that email and the user technically becomes authenticated
// momentarily (Supabase exchanges the token for a recovery session)
// — but we still allow it as "public" so the redirect below doesn't
// fight the recovery flow.
const PUBLIC_PATHS = new Set(['/login', '/welcome', '/forgot-password', '/reset-password'])

// Client-side guard. Supabase stores the session in localStorage, so checking
// here (after the provider hydrates) matches the source of truth. A dedicated
// server middleware would require @supabase/ssr — kept simple for now.
export default function AuthGate({ children }: { children: ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const { userId, profile, loading } = useAuth()

  const isPublic = PUBLIC_PATHS.has(pathname)

  useEffect(() => {
    if (loading) return
    if (!userId && !isPublic) {
      const next = encodeURIComponent(pathname)
      router.replace(`/login?next=${next}`)
      return
    }
    // Force first-time setup before anything else.
    if (userId && profile?.must_change_password && pathname !== '/welcome') {
      router.replace('/welcome')
      return
    }
    // Gate /admin routes to admin users.
    if (userId && pathname.startsWith('/admin') && profile && !profile.is_admin) {
      router.replace('/')
    }
    // Gate /superadmin routes to superadmin users (the DB flag is the
    // client-side gate; the env allowlist is enforced by API routes).
    if (userId && pathname.startsWith('/superadmin') && profile && !profile.is_superadmin) {
      router.replace('/')
    }
  }, [loading, userId, profile, pathname, isPublic, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }

  // While a redirect is in flight for an unauthenticated visit to a protected
  // route, don't flash the protected UI.
  if (!userId && !isPublic) return null

  return <>{children}</>
}
