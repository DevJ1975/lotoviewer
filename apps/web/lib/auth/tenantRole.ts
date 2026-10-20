import type { Profile, TenantRole } from '@soteria/core/types'

// Client-safe answer to "may this user administer the active tenant?"
//
// Tenant administration is a property of the user's MEMBERSHIP in the active
// tenant (owner or admin), never of the profile. `profiles.is_admin` is the
// pre-multi-tenant marker: migration 028 mapped it onto membership roles and
// nothing has written it since, so every owner/admin invited into a tenant
// created after that has it false. The API gates (requireTenantAdmin) already
// decide on membership role; this keeps the UI in agreement with them, so the
// drawer link, the /admin landing, and the route gate cannot drift apart.
//
// Superadmins pass regardless of role so platform operators can reach a
// tenant's admin area without holding a membership in it — the same shortcut
// the server gate takes.

const TENANT_MANAGER_ROLES: ReadonlySet<TenantRole> = new Set<TenantRole>(['owner', 'admin'])

export function isTenantManagerRole(role: TenantRole | null | undefined): boolean {
  return role != null && TENANT_MANAGER_ROLES.has(role)
}

export function canManageTenant(
  role:    TenantRole | null | undefined,
  profile: Pick<Profile, 'is_superadmin'> | null | undefined,
): boolean {
  return profile?.is_superadmin === true || isTenantManagerRole(role)
}
