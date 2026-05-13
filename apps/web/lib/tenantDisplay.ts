import type { Tenant } from '@soteria/core/types'

const TENANT_NUMBER_RE = /^[0-9]{4}$/

export function isSelectableTenant(tenant: Tenant | null | undefined): tenant is Tenant {
  if (!tenant) return false
  if (tenant.disabled_at) return false
  if (tenant.status !== 'active' && tenant.status !== 'trial') return false
  return TENANT_NUMBER_RE.test(tenant.tenant_number)
}
