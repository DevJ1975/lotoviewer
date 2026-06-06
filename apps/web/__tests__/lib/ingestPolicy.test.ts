import { describe, it, expect } from 'vitest'
import { isWithinTenantStaging, tenantStagingPrefix } from '@/lib/ai/ingestPolicy'

// The tenant self-service ingest route trusts isWithinTenantStaging to prove a
// staged object belongs to the calling tenant before the service-role client
// (which bypasses storage RLS) downloads and ingests it. A false negative is
// an annoyance; a false POSITIVE is a cross-tenant read. Test the boundary.

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

describe('tenantStagingPrefix', () => {
  it('namespaces by tenant id', () => {
    expect(tenantStagingPrefix(A)).toBe(`tenant/${A}/`)
  })
})

describe('isWithinTenantStaging', () => {
  it('accepts a single safe filename under the tenant prefix', () => {
    expect(isWithinTenantStaging(`tenant/${A}/abc-123.pdf`, A)).toBe(true)
    expect(isWithinTenantStaging(`tenant/${A}/${A}.md`, A)).toBe(true)
  })

  it('matches the tenant id case-insensitively', () => {
    expect(isWithinTenantStaging(`tenant/${A.toLowerCase()}/x.txt`, A.toUpperCase())).toBe(true)
  })

  it('rejects a path scoped to a different tenant', () => {
    expect(isWithinTenantStaging(`tenant/${B}/x.pdf`, A)).toBe(false)
  })

  it('rejects sub-paths and traversal (extra slashes)', () => {
    expect(isWithinTenantStaging(`tenant/${A}/sub/x.pdf`, A)).toBe(false)
    expect(isWithinTenantStaging(`tenant/${A}/../${B}/x.pdf`, A)).toBe(false)
  })

  it('rejects a missing or unsafe filename', () => {
    expect(isWithinTenantStaging(`tenant/${A}/`, A)).toBe(false)
    expect(isWithinTenantStaging(`tenant/${A}/a b.pdf`, A)).toBe(false) // space
    expect(isWithinTenantStaging(`tenant/${A}/wpåth.pdf`, A)).toBe(false) // non-ascii
  })

  it('rejects flat (superadmin-style) and empty paths', () => {
    expect(isWithinTenantStaging(`${A}.pdf`, A)).toBe(false)
    expect(isWithinTenantStaging('', A)).toBe(false)
    expect(isWithinTenantStaging(`tenant/x.pdf`, A)).toBe(false)
  })
})
