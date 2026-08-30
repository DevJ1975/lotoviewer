import {
  requireTenantModuleMember,
  type TenantModuleGate,
} from '@/lib/auth/tenantGate'

// STRIKE's own auth gates.
//
// Why these exist rather than the plain requireTenantMember/requireTenantAdmin
// the routes used before: `/strike/*` pages are wrapped in
// <ModuleGuard moduleId="strike">, but the API routes were not doing the
// equivalent check. A tenant with `modules.strike = false` therefore had a
// hidden page and fully working submit/media/assign endpoints — an
// entitlement bypass, not a cross-tenant leak, but a bypass all the same.
//
// requireTenantModuleMember resolves the tenant's module map and refuses when
// STRIKE is off or the tenant is disabled. 'strike' is the feature id in
// packages/core/src/features.ts.

const STRIKE_MODULE_ID = 'strike'

/** Any member of a tenant that has STRIKE enabled. */
export function requireStrikeMember(req: Request): Promise<TenantModuleGate> {
  return requireTenantModuleMember(req, STRIKE_MODULE_ID)
}

/**
 * Tenant admin/owner (or superadmin) of a tenant that has STRIKE enabled.
 *
 * Composed here rather than added to lib/auth/tenantGate.ts as a
 * `requireTenantModuleAdmin`: STRIKE would be its only caller, and the Rule
 * of Three says wait for the third. Promote it if another module needs it.
 */
export async function requireStrikeAdmin(req: Request): Promise<TenantModuleGate> {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return gate
  if (gate.role !== 'owner' && gate.role !== 'admin' && gate.role !== 'superadmin') {
    return { ok: false, status: 403, message: 'Tenant admin or owner required' }
  }
  return gate
}
