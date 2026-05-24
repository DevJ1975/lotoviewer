import { requireTenantModuleMember, type TenantModuleGate } from '@/lib/auth/tenantGate'

// Auth gates for the /api/fleet/* family. Reads require any tenant member
// with the fleet-safety module enabled; writes additionally require an
// owner/admin (or superadmin) role. RLS in migration 199 independently
// enforces tenant isolation.

export const FLEET_MODULE_ID = 'fleet-safety'

export function requireFleetMember(req: Request): Promise<TenantModuleGate> {
  return requireTenantModuleMember(req, FLEET_MODULE_ID)
}

export async function requireFleetAdmin(req: Request): Promise<TenantModuleGate> {
  const gate = await requireTenantModuleMember(req, FLEET_MODULE_ID)
  if (!gate.ok) return gate
  if (!['owner', 'admin', 'superadmin'].includes(gate.role)) {
    return { ok: false, status: 403, message: 'Tenant admin or owner required' }
  }
  return gate
}
