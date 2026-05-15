'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import OpsSpinner from '@/components/OpsSpinner'

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

// Token-gated public routes. Each entry matches when the pathname
// equals the prefix or starts with `${prefix}/`. Used for QR-scanned
// flows whose authorization is the URL token, not a Supabase session.
const PUBLIC_PREFIXES = [
  '/r/bbs',     // Behavior-Based Safety anonymous QR submission
] as const

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true
  }
  return false
}

// Client-side guard. Supabase stores the session in localStorage, so checking
// here (after the provider hydrates) matches the source of truth. A dedicated
// server middleware would require @supabase/ssr — kept simple for now.
export default function AuthGate({ children }: { children: ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const { userId, profile, loading } = useAuth()
  const { role, loading: tenantLoading } = useTenant()

  const isPublic = isPublicPath(pathname)
  const isTenantAdmin = role === 'owner' || role === 'admin'

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
    // Gate /admin routes to active-tenant admins. The server remains the
    // source of truth; this only prevents obvious client-side navigation.
    if (userId && pathname.startsWith('/admin') && profile && !profile.is_admin && !profile.is_superadmin) {
      if (tenantLoading) return
      if (isTenantAdmin) return
      router.replace('/')
    }
    // Gate /superadmin routes to superadmin users (the DB flag is the
    // client-side gate; the env allowlist is enforced by API routes).
    if (userId && pathname.startsWith('/superadmin') && profile && !profile.is_superadmin) {
      router.replace('/')
    }
  }, [loading, tenantLoading, userId, profile, pathname, isPublic, isTenantAdmin, router])

  if (loading || (userId && pathname.startsWith('/admin') && tenantLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <OpsSpinner size="lg" label="Authorizing" />
      </div>
    )
  }

  // While a redirect is in flight for an unauthenticated visit to a protected
  // route, don't flash the protected UI.
  if (!userId && !isPublic) return null

  return <>{children}</>
}
