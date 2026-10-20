import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { canManageTenant } from '@/lib/auth/tenantRole'

// "May this user administer the active tenant?" as a hook, so a page asks
// the same question the route gate and the drawer do. It reads the
// membership role from TenantProvider and the superadmin flag from
// AuthProvider; it never reads profiles.is_admin, the pre-multi-tenant flag
// that nothing writes any more.
//
// `resolving` is true until both providers have answered. Under /admin the
// AuthGate already holds pages until then; elsewhere a page that hides a
// control or shows "Admins only." should wait on it rather than flash a
// denial at a legitimate admin whose membership is still loading.
export interface TenantManagerAccess {
  canManage: boolean
  resolving: boolean
}

export function useCanManageTenant(): TenantManagerAccess {
  const { profile, loading: authLoading } = useAuth()
  const { role, loading: tenantLoading } = useTenant()
  return {
    canManage: canManageTenant(role, profile),
    resolving: authLoading || tenantLoading,
  }
}
