import { describe, it, expect } from 'vitest'
import { canManageTenant, isTenantManagerRole } from '@/lib/auth/tenantRole'

// The UI must agree with requireTenantAdmin: administration follows the
// membership role in the active tenant, not the legacy profiles.is_admin
// flag that nothing writes any more.

describe('isTenantManagerRole', () => {
  it('accepts owner and admin', () => {
    expect(isTenantManagerRole('owner')).toBe(true)
    expect(isTenantManagerRole('admin')).toBe(true)
  })

  it('rejects member, viewer and an unresolved role', () => {
    expect(isTenantManagerRole('member')).toBe(false)
    expect(isTenantManagerRole('viewer')).toBe(false)
    expect(isTenantManagerRole(null)).toBe(false)
    expect(isTenantManagerRole(undefined)).toBe(false)
  })
})

describe('canManageTenant', () => {
  it('lets a tenant owner or admin manage even when the legacy is_admin flag is false', () => {
    expect(canManageTenant('owner', { is_superadmin: false })).toBe(true)
    expect(canManageTenant('admin', { is_superadmin: false })).toBe(true)
  })

  it('lets a superadmin manage any tenant, membership or not', () => {
    expect(canManageTenant(null, { is_superadmin: true })).toBe(true)
    expect(canManageTenant('viewer', { is_superadmin: true })).toBe(true)
  })

  it('denies member and viewer', () => {
    expect(canManageTenant('member', { is_superadmin: false })).toBe(false)
    expect(canManageTenant('viewer', { is_superadmin: false })).toBe(false)
  })

  it('denies while the profile or role is still unresolved', () => {
    expect(canManageTenant(null, null)).toBe(false)
    expect(canManageTenant(undefined, undefined)).toBe(false)
    expect(canManageTenant(null, { is_superadmin: false })).toBe(false)
  })

  it('ignores the legacy profiles.is_admin flag entirely', () => {
    // A pre-multi-tenant admin who is now only a member must not see admin UI.
    const legacyAdminProfile = { is_superadmin: false, is_admin: true }
    expect(canManageTenant('member', legacyAdminProfile)).toBe(false)
  })
})
