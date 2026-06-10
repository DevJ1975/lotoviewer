import { describe, expect, it } from 'vitest'
import { isSelectableTenant } from '@/lib/tenantDisplay'
import type { Tenant } from '@soteria/core/types'

// isSelectableTenant gates which tenants appear in the switcher and
// which one a session may activate. These tests pin every branch of
// that gate — a tenant that slips through here lands users inside a
// disabled or malformed tenant context.

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenant_number: '0001',
    slug: 'snak-king',
    name: 'Snak King',
    status: 'active',
    is_demo: false,
    disabled_at: null,
    modules: {},
    logo_url: null,
    custom_domain: null,
    settings: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('isSelectableTenant', () => {
  it('rejects null and undefined', () => {
    expect(isSelectableTenant(null)).toBe(false)
    expect(isSelectableTenant(undefined)).toBe(false)
  })

  it('accepts a healthy active tenant', () => {
    expect(isSelectableTenant(tenant())).toBe(true)
  })

  it('accepts trial but rejects disabled and archived statuses', () => {
    expect(isSelectableTenant(tenant({ status: 'trial' }))).toBe(true)
    expect(isSelectableTenant(tenant({ status: 'disabled' }))).toBe(false)
    expect(isSelectableTenant(tenant({ status: 'archived' }))).toBe(false)
  })

  it('rejects a tenant with disabled_at set even when status still says active', () => {
    expect(isSelectableTenant(tenant({ disabled_at: '2026-06-01T00:00:00Z' }))).toBe(false)
  })

  it('requires exactly four ASCII digits in tenant_number', () => {
    expect(isSelectableTenant(tenant({ tenant_number: '' }))).toBe(false)
    expect(isSelectableTenant(tenant({ tenant_number: '123' }))).toBe(false)
    expect(isSelectableTenant(tenant({ tenant_number: '12345' }))).toBe(false)
    expect(isSelectableTenant(tenant({ tenant_number: '12a4' }))).toBe(false)
    expect(isSelectableTenant(tenant({ tenant_number: ' 0001' }))).toBe(false)
    expect(isSelectableTenant(tenant({ tenant_number: '0001\n' }))).toBe(false)
    // Non-ASCII digits (Arabic-Indic) must not satisfy the [0-9] regex.
    expect(isSelectableTenant(tenant({ tenant_number: '٠٠٠١' }))).toBe(false)
    expect(isSelectableTenant(tenant({ tenant_number: '0000' }))).toBe(true)
    expect(isSelectableTenant(tenant({ tenant_number: '9999' }))).toBe(true)
  })
})
