'use client'

import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'

/**
 * Tenant owners and admins edit the registers; members read them. The same
 * rule as requireTenantModuleAdmin and the registers' RLS, so a button
 * shown here is a write the API will accept.
 */
export function useCanEditRegisters(): boolean {
  const { role } = useTenant()
  const { profile } = useAuth()
  return role === 'owner' || role === 'admin' || profile?.is_superadmin === true
}
